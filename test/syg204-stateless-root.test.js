// @vitest-environment jsdom
// SYG204 (sandbox research §6, maintainer-approved): a root component with no state after it
// started never has its view called. The dev entry reports it once per app; the core is unchanged.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { run, createElement as h, xs } from '../src/index.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'
import { resetChecks } from '../src/extra/diagnostics/checks/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let apps = []
beforeEach(() => { clearDiagnostics(); resetChecks() })
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; configureDiagnostics({ mode: undefined }) })
const start = (App, drivers = {}, opts = {}) => {
  document.body.innerHTML = '<div id="root"></div>'
  const a = run(App, drivers, { mountPoint: '#root', diagnostics: 'collect', ...opts })
  apps.push(a)
  return a
}
const codes = () => getDiagnostics().filter((x) => x.code === 'SYG204')

describe('SYG204: a root component without state never renders its view', () => {
  it('a root with a model and no initialState is reported once, as a warning, naming its reducers', async () => {
    function App({ state }) { return h('div', { className: 'app' }, String(state.n)) }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.app') })
    App.model = { INC: (s) => ({ n: (s?.n || 0) + 1 }) }
    start(App)
    await sleep(20)
    expect(document.querySelector('.app')).toBe(null)
    const found = codes()
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('warn')
    expect(found[0].message).toContain('App is the root component')
    expect(found[0].message).toContain('(INC)')
    expect(found[0].fix).toContain('App.initialState')
    expect(found[0].data.reducers).toEqual(['INC'])
  })

  it('not reported: initialState, a model-less root, or an INITIALIZE / BOOTSTRAP reducer', async () => {
    function A() { return h('i', null, 'a') }
    A.initialState = {}
    A.model = { X: (s) => s }
    function B() { return h('i', null, 'b') }
    function D() { return h('i', null, 'd') }
    D.model = { INITIALIZE: () => ({ ok: true }) }
    function E() { return h('i', null, 'e') }
    E.model = { BOOTSTRAP: () => ({ ok: true }) }
    start(A); start(B); start(D); start(E)
    await sleep(20)
    expect(codes()).toEqual([])
  })

  it('a root that gets its state from BOOTSTRAP renders and is not reported', async () => {
    function App({ state }) { return h('p', { className: 'boot' }, state.msg) }
    App.model = { BOOTSTRAP: () => ({ msg: 'hi' }) }
    start(App)
    await sleep(20)
    expect(document.querySelector('.boot')?.textContent).toBe('hi')
    expect(codes()).toEqual([])
  })

  it('a root with no model nor reducers that set state after start: reported without a reducer list', async () => {
    function App() { return h('p', null, 'x') }
    App.model = { LOG: { EFFECT: () => {} } }
    App.intent = () => ({ LOG: xs.never() })
    start(App)
    await sleep(20)
    const [x] = codes()
    expect(x).toBeTruthy()
    expect(x.message).not.toContain('until one of its reducers')
    expect(x.data.reducers).toEqual([])
  })

  it('a root disposed before it settles is not reported', async () => {
    function App() { return h('p', null, 'x') }
    App.model = { X: (s) => s }
    const a = start(App)
    a.dispose()
    await sleep(20)
    expect(codes()).toEqual([])
  })
})
