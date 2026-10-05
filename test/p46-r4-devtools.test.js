// @vitest-environment jsdom
// PLAN-4.6 R4: the DevTools bridge on both cores through its public messages (06 §2: the time
// travel tests of devtools-timetravel.test.js pin the current core's sink internals; these are
// their behaviour, which the next core reaches through the runtime API's setState / setDebug).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run, createElement as h } from '../src/index.js'
import { installDevTools } from '../src/extra/devtools.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = (fn, timeout = 2000) => vi.waitFor(fn, { timeout, interval: 2 })
let apps = []
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; vi.restoreAllMocks() })

const dt = installDevTools()
const ext = (type, payload) => dt._handleExtensionMessage({ type, payload })

function Kid({ state }) { return h('span', { className: 'kid' }, String(state.k)) }
Kid.isolatedState = true
Kid.initialState = { k: 1 }
Kid.intent = ({ DOM }) => ({ K: DOM.click('.kid') })
Kid.model = { K: (s) => ({ ...s, k: s.k + 1 }) }

function App({ state }) { return h('div', null, h('b', { className: 'n' }, String(state.count)), h('button', { className: 'inc' }, '+'), h(Kid)) }
App.initialState = { count: 0 }
App.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
App.model = { INC: (s) => ({ ...s, count: s.count + 1 }) }

function mount() {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(App, {}, { mountPoint: '#root' })
  apps.push(app)
  return app
}
const idOf = (name) => [...dt._components.values()].filter((m) => m.name === name && !m.disposed).pop()?.id

describe('DevTools bridge (both cores)', () => {
  it('builds the tree and time-travels the root and an isolatedState child', async () => {
    mount()
    await until(() => expect(document.querySelector('.kid')?.textContent).toBe('1'))
    ext('CONNECT')
    const root = idOf('App'), kid = idOf('Kid')
    expect(root).toBeTypeOf('number')
    expect(dt._components.get(kid).parentId).toBe(root)
    ext('TIME_TRAVEL', { componentId: root, componentName: 'App', state: { count: 42 } })
    await until(() => expect(document.querySelector('.n').textContent).toBe('42'))
    ext('TIME_TRAVEL', { componentId: kid, componentName: 'Kid', state: { k: 7 } })
    await until(() => expect(document.querySelector('.kid').textContent).toBe('7'))
    expect(document.querySelector('.n').textContent).toBe('42')
    ext('DISCONNECT')
  })

  it('SET_DEBUG logs one component\'s actions', async () => {
    mount()
    await until(() => expect(document.querySelector('.kid')).toBeTruthy())
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    ext('SET_DEBUG', { componentId: idOf('Kid'), enabled: true })
    document.querySelector('.inc').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    document.querySelector('.kid').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await sleep(30)
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => /Kid\] <K> Action triggered/.test(l))).toBe(true)
    expect(lines.some((l) => /App\]/.test(l))).toBe(false)
  })
})
