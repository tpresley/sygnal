// @vitest-environment jsdom
// PLAN-4.6 R5: fixes of the R4 review in the dev entry's checks for the core (checks/next.ts) and
// the runtime (G-327, G-329, G-330, G-332, G-333), each pinned here (failing first).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { run, createElement as h } from '../src/index.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'
import { resetChecks } from '../src/extra/diagnostics/checks/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let apps = []
beforeEach(() => { clearDiagnostics(); resetChecks() })
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; configureDiagnostics({ mode: undefined }) })
const start = (App, o = {}) => {
  document.body.innerHTML = '<div id="root"></div>'
  const a = run(App, {}, { mountPoint: '#root', diagnostics: 'collect', ...o })
  apps.push(a)
  return a
}
const codes = (c) => getDiagnostics().filter((x) => x.code === c)
const click = (sel) => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('G-327: SYG423 does not report a view whose output differs between two calls with the same context', () => {
  it('an impure view (a render counter) that reads no context', async () => {
    let n = 0
    function Child() { return h('i', { className: 'c' }, 'render ' + (n++)) }
    Child.isolatedState = true
    Child.initialState = { mine: 1 }
    function App() { return h('div', null, h('button', null, 'x'), h(Child)) }
    App.initialState = { theme: 'light' }
    App.context = { theme: (s) => s.theme }
    App.intent = ({ DOM }) => ({ T: DOM.click('button') })
    App.model = { T: (s) => ({ ...s, theme: s.theme + '!' }) }
    start(App)
    await sleep(20)
    click('button'); await sleep(30)
    click('button'); await sleep(30)
    expect(codes('SYG423')).toEqual([])
  })
})
