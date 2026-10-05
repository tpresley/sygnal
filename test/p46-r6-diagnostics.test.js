// @vitest-environment jsdom
// PLAN-4.6 R6 (G-342a): diagnostics 'error' mode keeps the app alive when a check reports (throws)
// from onReducer / onRender; the DiagnosticError is rethrown asynchronously, not into the pipeline.
import { it, expect, vi, afterEach } from 'vitest'
import '../src/extra/diagnostics/checks/index.js'
import { run, createElement as h, defineComponent } from '../src/index.js'
import { resetChecks } from '../src/extra/diagnostics/checks/index.js'
import { configureDiagnostics, registerCheck, report, _setAsyncThrow, _resetDiagnostics, DiagnosticError, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let app, unregister
afterEach(() => {
  app?.dispose(); app = null
  unregister?.(); unregister = null
  _setAsyncThrow()
  configureDiagnostics({ mode: undefined })
  _resetDiagnostics()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

it('G-343: a positional view wrapped by defineComponent is still SYG612 (positional-views)', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  clearDiagnostics(); resetChecks()
  const App = defineComponent({ name: 'Pos', view: (props, state) => h('div', null, String(state && state.n)), initialState: { n: 1 } })
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
  await sleep(20)
  const forms = getDiagnostics().filter((d) => d.code === 'SYG612').map((d) => d.data.form)
  expect(forms).toContain('positional-views')
})

for (const hook of ['onReducer', 'onRender']) {
  it(`'error' mode: a check that reports from ${hook} does not stop the app`, async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const thrown = []
    _setAsyncThrow((e) => thrown.push(e))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    function Counter({ state }) { return h('div', null, h('button', { className: 'inc' }, 'x'), h('span', { className: 'n' }, String(state.count))) }
    Counter.initialState = { count: 0 }
    Counter.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
    Counter.model = { INC: (s) => ({ count: s.count + 1 }) }
    unregister = registerCheck({
      id: `r6-${hook}`,
      [hook]: (c, a, prev, next) => {
        if (hook === 'onReducer' && next && next.count === 1) report('SYG202', { component: c, message: 'count 1' })
        if (hook === 'onRender' && JSON.stringify(a).includes('"text":"1"')) report('SYG301', { component: c, message: 'rendered 1' })
      },
    })
    app = run(Counter, {}, { mountPoint: '#root', diagnostics: 'error' })
    configureDiagnostics({ mode: 'error' })
    await sleep(20)
    const click = () => document.querySelector('.inc').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 3; i++) { click(); await sleep(20) }
    expect(document.querySelector('.n').textContent).toBe('3')
    expect(thrown.length).toBeGreaterThan(0)
    expect(thrown[0]).toBeInstanceOf(DiagnosticError)
  })
}
