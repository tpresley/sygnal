// @vitest-environment jsdom
// PLAN-4 2-A GS-11: the app-level error hook, run(App, drivers, { onError }).
// Reporting only (the component's onError boundary still picks the fallback, and the hook is
// called after it), per app, each phase once per error, in production (diagnostics off).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { createElement as h } from '../src/pragma/index.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 2000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}

let apps = []
let consoleError
beforeEach(() => {
  document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  for (const a of apps) try { a.dispose() } catch (_) {}
  apps = []
  vi.restoreAllMocks()
})
const start = (App, drivers, options) => {
  const app = run(App, drivers, { diagnostics: 'off', ...options })
  apps.push(app)
  return app
}
const info = (calls) => calls.map(([err, i]) => [err.message, { ...i }])

describe('GS-11: run(App, drivers, { onError })', () => {
  it("'view': after the component's onError boundary chose the fallback, once", async () => {
    const order = []
    const onError = vi.fn((err) => order.push('app:' + err.message))
    function Boom({ state }) {
      if (state.boom) throw new Error('view broke')
      return h('button', { className: 'go' }, 'go')
    }
    Boom.initialState = { boom: false }
    Boom.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Boom.model = { GO: (s) => ({ ...s, boom: true }) }
    Boom.onError = (err) => { order.push('boundary:' + err.message); return h('p', { className: 'fallback' }, 'sorry') }
    start(Boom, {}, { mountPoint: '#a', onError })
    await until(() => document.querySelector('.go'), 'render')
    document.querySelector('.go').click()
    await until(() => document.querySelector('.fallback'), 'fallback')
    await sleep(30)
    expect(order).toEqual(['boundary:view broke', 'app:view broke'])
    expect(info(onError.mock.calls)).toEqual([['view broke', { componentName: 'Boom', action: undefined, phase: 'view' }]])
  })

  it("'view' without a boundary: still reported once (the default error <div> renders)", async () => {
    const onError = vi.fn()
    function Bad() { throw new Error('no boundary') }
    start(Bad, {}, { mountPoint: '#a', onError })
    await until(() => document.querySelector('[data-sygnal-error]'), 'error div')
    await sleep(30)
    expect(info(onError.mock.calls)).toEqual([['no boundary', { componentName: 'Bad', action: undefined, phase: 'view' }]])
  })

  it("'reducer' (STATE and other sinks) and 'effect' (sync and async), with the action name", async () => {
    const onError = vi.fn()
    function App() { return h('div', null, 'x') }
    App.initialState = { n: 0 }
    App.intent = () => ({ R: xs.of(1), S: xs.of(1), E: xs.of(1), A: xs.of(1) })
    App.model = {
      R: () => { throw new Error('state reducer') },
      S: { LOG: () => { throw new Error('sink reducer') } },
      E: { EFFECT: () => { throw new Error('effect sync') } },
      A: { EFFECT: async () => { throw new Error('effect async') } },
    }
    start(App, {}, { mountPoint: '#a', onError })
    await until(() => onError.mock.calls.length >= 4, 'four reports')
    await sleep(30)
    expect(info(onError.mock.calls).sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ['effect async', { componentName: 'App', action: 'A', phase: 'effect' }],
      ['effect sync', { componentName: 'App', action: 'E', phase: 'effect' }],
      ['sink reducer', { componentName: 'App', action: 'S', phase: 'reducer' }],
      ['state reducer', { componentName: 'App', action: 'R', phase: 'reducer' }],
    ])
  })

  it("'instantiate': a sub-component that throws while it is created, after the parent's boundary", async () => {
    const order = []
    const onError = vi.fn((err, i) => order.push('app:' + i.phase))
    function Child() { return h('span', null, 'child') }
    Child.initialState = { mine: 1 } // SYG405: thrown while instantiating (no isolatedState)
    function Parent() { return h('div', null, h(Child)) }
    Parent.initialState = {}
    Parent.onError = () => { order.push('boundary'); return h('p', { className: 'fallback' }, 'x') }
    start(Parent, {}, { mountPoint: '#a', onError })
    await until(() => onError.mock.calls.length > 0, 'report')
    await sleep(30)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toEqual({ componentName: 'Parent', action: undefined, phase: 'instantiate' })
    expect(order).toEqual(['boundary', 'app:instantiate'])
  })

  it("'driver': a driver that throws while handling a sink value (the throw is kept)", async () => {
    const onError = vi.fn()
    const rethrown = []
    const queue = globalThis.queueMicrotask
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((cb) => queue(() => { try { cb() } catch (e) { rethrown.push(e.message) } }))
    const badDriver = (sink$) => {
      sink$.addListener({ next: (v) => { throw new Error('driver choked on ' + v) }, error: () => {}, complete: () => {} })
      return xs.never()
    }
    function App() { return h('div', null, 'x') }
    App.initialState = {}
    App.intent = () => ({ SEND: xs.of(7) })
    App.model = { SEND: { BAD: (s, n) => n } }
    start(App, { BAD: badDriver }, { mountPoint: '#a', onError })
    await until(() => onError.mock.calls.length > 0, 'report')
    await sleep(30)
    expect(info(onError.mock.calls)).toEqual([['driver choked on 7', { phase: 'driver', driver: 'BAD' }]])
    expect(rethrown).toEqual(['driver choked on 7'])
  })

  it('is per app: two apps on one page report to their own hooks', async () => {
    const hookA = vi.fn(), hookB = vi.fn()
    const make = (label) => {
      function C() { return h('div', null, label) }
      C.initialState = {}
      C.intent = () => ({ GO: xs.of(1) })
      C.model = { GO: () => { throw new Error(label) } }
      return C
    }
    start(make('A'), {}, { mountPoint: '#a', onError: hookA })
    start(make('B'), {}, { mountPoint: '#b', onError: hookB })
    await until(() => hookA.mock.calls.length && hookB.mock.calls.length, 'both')
    await sleep(30)
    expect(hookA.mock.calls.map(c => c[0].message)).toEqual(['A'])
    expect(hookB.mock.calls.map(c => c[0].message)).toEqual(['B'])
  })

  it('an exception inside the hook is swallowed with one console.error; the app keeps running', async () => {
    const hookError = new Error('hook broke')
    const onError = vi.fn(() => { throw hookError })
    function App({ state }) { return h('button', { className: 'go' }, String(state.n)) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ BAD: xs.of(1), GO: DOM.click('.go') })
    App.model = { BAD: () => { throw new Error('reducer') }, GO: (s) => ({ ...s, n: s.n + 1 }) }
    start(App, {}, { mountPoint: '#a', onError })
    await until(() => onError.mock.calls.length > 0, 'report')
    await until(() => document.querySelector('.go'), 'render')
    expect(consoleError.mock.calls.filter(c => c.includes(hookError))).toHaveLength(1)
    document.querySelector('.go').click()
    await until(() => document.querySelector('.go').textContent === '1', 'the app still runs')
  })

  it('without onError nothing changes (no extra console output)', async () => {
    function App() { return h('div', null, 'x') }
    App.initialState = {}
    App.intent = () => ({ GO: xs.of(1) })
    App.model = { GO: () => { throw new Error('plain') } }
    start(App, {}, { mountPoint: '#a' })
    await sleep(60)
    // the SYG216 line only, as before
    expect(consoleError).toHaveBeenCalledTimes(1)
  })
})

describe('GS-11: renderComponent and renderToString', () => {
  it('renderComponent(C, { onError }) reports like run()', async () => {
    const onError = vi.fn()
    function App() { return h('div', null, 'x') }
    App.initialState = {}
    App.model = { GO: () => { throw new Error('in test') } }
    const t = renderComponent(App, { onError })
    await t.ready()
    t.simulateAction('GO')
    await t.settle()
    t.dispose()
    expect(info(onError.mock.calls)).toEqual([['in test', { componentName: 'App', action: 'GO', phase: 'reducer' }]])
  })

  it("renderToString(C, { onError }): 'view', after the boundary, for the root and nested components", () => {
    const order = []
    const onError = vi.fn((err, i) => order.push(`app:${i.componentName}`))
    function Inner() { throw new Error('inner') }
    Inner.onError = () => { order.push('boundary:Inner'); return h('em', null, 'fallback') }
    function Outer() { return h('div', null, h(Inner)) }
    const html = renderToString(Outer, { onError })
    expect(html).toBe('<div><em>fallback</em></div>')
    expect(order).toEqual(['boundary:Inner', 'app:Inner'])
    expect(info(onError.mock.calls)).toEqual([['inner', { componentName: 'Inner', action: undefined, phase: 'view' }]])

    function Root() { throw new Error('root') }
    const hook = vi.fn()
    expect(renderToString(Root, { onError: hook })).toContain('data-sygnal-error')
    expect(info(hook.mock.calls)).toEqual([['root', { componentName: 'Root', action: undefined, phase: 'view' }]])
    // a throwing hook doesn't break the render
    expect(renderToString(Root, { onError: () => { throw new Error('x') } })).toContain('data-sygnal-error')
  })
})
