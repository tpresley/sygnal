// @vitest-environment jsdom
// PLAN-4.6 R1: the core's own contracts, through run() with the internal options (hooks, the
// runtime API) and public drivers (R1-R4 ran them on the new core only; one core since R5). The
// public behaviour is in test/parity/.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { run, createElement as h, makeDOMDriver, xs } from '../src/index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ticks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }

let apps = []
afterEach(() => { apps.forEach((a) => a.dispose()); apps = []; document.body.innerHTML = ''; vi.restoreAllMocks() })
function mount(App, drivers = {}, options = {}) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  const app = run(App, drivers, { mountPoint: '#root', ...options })
  apps.push(app)
  return { app, el, rt: app.__runtime, text: (s) => el.querySelector(s)?.textContent, $: (s) => el.querySelector(s) }
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('PLAN-4.6 R1 next core: hooks (04-hooks-contract §2.2)', () => {
  it('lifetime, action and render hooks fire in the contract order, with InstanceViews', async () => {
    const log = []
    function Kid({ state }) { return h('i', { className: 'k' }, String(state.v)) }
    Kid.intent = ({ DOM }) => ({ K: DOM.click('.k') })
    Kid.model = { K: { STATE: (s) => ({ ...s, v: s.v + 1 }), EVENTS: (s) => ({ type: 'KID', data: s.v }), EFFECT: (s, d, next) => next('LATER', 1, 5) }, LATER: (s) => s }
    function App({ state }) { return h('div', null, h('b', null, String(state.n)), state.show ? h(Kid, { state: 'kid' }) : null) }
    App.initialState = { n: 0, show: true, kid: { v: 1 } }
    App.intent = ({ DOM }) => ({ HIDE: DOM.click('b') })
    App.model = { HIDE: (s) => ({ ...s, show: false }) }
    const hooks = {
      onCreate: (i) => log.push(['create', i.name, i.kind, JSON.stringify(i.state)]),
      wrapSources: (i, s) => (log.push(['sources', i.name]), s),
      onIntent: (i, names) => log.push(['intent', i.name, names.join()]),
      onAction: (i, a) => log.push(['action', i.name, a.type, a.cause]),
      wrapHandler: (i, type, sink, fn) => (log.push(['wrap', type, sink]), fn),
      onReducer: (i, type, prev, next) => log.push(['reducer', type, prev.v ?? prev.n, next.v ?? next.n]),
      onSink: (i, type, sink, v) => log.push(['sink', type, sink, v.data]),
      onNext: (i, type, d, ms) => log.push(['next', type, ms]),
      onRender: (i) => log.push(['render', i.name]),
      onPatch: () => log.push(['patch']),
      onDispose: (i) => log.push(['dispose', i.name, i.disposed]),
    }
    const m = mount(App, {}, { __hooks: hooks })
    expect(log.slice(0, 3)).toEqual([['create', 'App', 'root', '{"n":0,"show":true,"kid":{"v":1}}'], ['sources', 'App'], ['intent', 'App', 'HIDE']])
    await ticks()
    expect(log.slice(3)).toEqual([
      ['create', 'Kid', 'child', '{"v":1}'], ['sources', 'Kid'], ['intent', 'Kid', 'K'],
      ['render', 'Kid'], ['render', 'App'], ['patch'],
    ])
    log.length = 0
    click(m.$('.k'))
    expect(log).toEqual([
      ['action', 'Kid', 'K', 'intent'],
      ['wrap', 'K', 'STATE'], ['reducer', 'K', 1, 2],
      ['wrap', 'K', 'EVENTS'], ['sink', 'K', 'EVENTS', 1],
      ['wrap', 'K', 'EFFECT'], ['next', 'LATER', 5],
    ])
    await sleep(20)
    expect(log.filter((x) => x[0] == 'action').map((x) => x.slice(2))).toEqual([['K', 'intent'], ['LATER', 'next']])
    log.length = 0
    click(m.$('b'))
    await ticks()
    expect(log.filter((x) => x[0] == 'dispose')).toEqual([['dispose', 'Kid', true]])
  })

  it('the runtime API: getState, setState (queued, one patch), dispatch, flushed, a late addHooks', async () => {
    let patches = 0
    function App({ state }) { return h('p', { className: 'p' }, String(state.n)) }
    App.initialState = { n: 0 }
    App.model = { ADD: (s, d) => ({ ...s, n: s.n + d }) }
    const m = mount(App, {}, { __hooks: { onPatch: () => patches++ } })
    await m.rt.flushed()
    expect(m.text('.p')).toBe('0')
    expect(m.rt.getState()).toEqual({ n: 0 })
    m.rt.setState('root', (s) => ({ ...s, n: 5 }))
    m.rt.dispatch('root', 'ADD', 2)
    expect(m.rt.getState()).toEqual({ n: 7 })
    await m.rt.flushed()
    expect(m.text('.p')).toBe('7')
    expect(patches).toBe(2)
    const seen = []
    const off = m.rt.addHooks({ onAction: (i, a) => seen.push(a.type + ':' + a.cause) })
    m.rt.dispatch(m.rt.root, 'ADD', 1)
    off()
    m.rt.dispatch(m.rt.root.id, 'ADD', 1)
    expect(seen).toEqual(['ADD:simulateAction'])
    expect(m.rt.get(m.rt.root.id).state).toEqual({ n: 9 })
  })

  it('onError gets the phase; the view boundary renders onError; a reducer error leaves the state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errs = []
    function Bad({ state }) { if (state.boom) throw new Error('view'); return h('i', { className: 'bad' }, 'ok') }
    Bad.onError = (e, { componentName }) => h('i', { className: 'fallback' }, componentName)
    function App({ state }) { return h('div', null, h('p', { className: 'p' }, String(state.n)), h(Bad, { state: 'bad' })) }
    App.initialState = { n: 0, bad: { boom: false } }
    App.model = { BOOM: (s) => ({ ...s, bad: { boom: true } }), THROW: () => { throw new Error('reducer') } }
    const m = mount(App, {}, { onError: (e, info) => errs.push([e.message, info.phase, info.componentName, info.action]) })
    await m.rt.flushed()
    m.rt.dispatch('root', 'THROW')
    expect(m.rt.getState().n).toBe(0)
    m.rt.dispatch('root', 'BOOM')
    await m.rt.flushed()
    expect(m.text('.fallback')).toBe('Bad')
    expect(errs).toEqual([['reducer', 'reducer', 'App', 'THROW'], ['view', 'view', 'Bad', undefined]])
  })
})

describe('PLAN-4.6 R1 next core: tag children and cells', () => {
  it('state="key", a lens, isolatedState (local; with a key: a default while the slice is missing)', async () => {
    function Show({ state }) { return h('i', { className: 'v' }, JSON.stringify(state)) }
    Show.intent = ({ DOM }) => ({ BUMP: DOM.click('.v') })
    Show.model = { BUMP: (s) => ({ ...s, n: (s.n || 0) + 1 }) }
    function Local(p) { return Show(p) }
    Local.isolatedState = true
    Local.initialState = { n: 10 }
    Local.intent = Show.intent
    Local.model = Show.model
    function App() {
      return h('div', null,
        h('section', { className: 'key' }, h(Show, { state: 'a' })),
        h('section', { className: 'lens' }, h(Show, { state: { get: (s) => s.b.inner, set: (s, v) => ({ ...s, b: { inner: v } }) } })),
        h('section', { className: 'local' }, h(Local)),
        h('section', { className: 'dflt' }, h(Local, { state: 'c' })))
    }
    App.initialState = { a: { n: 1 }, b: { inner: { n: 2 } } }
    const m = mount(App)
    await m.rt.flushed()
    expect(m.rt.getState()).toEqual({ a: { n: 1 }, b: { inner: { n: 2 } }, c: { n: 10 } })
    for (const s of ['key', 'lens', 'local', 'dflt']) click(m.$(`.${s} .v`))
    await m.rt.flushed()
    expect(m.rt.getState()).toEqual({ a: { n: 2 }, b: { inner: { n: 3 } }, c: { n: 11 } })
    expect(m.text('.local .v')).toBe('{"n":11}')
  })

  it('SYG405: a child with initialState and no isolatedState renders its parent\'s error fallback (SYG408)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Kid() { return h('i', null, 'kid') }
    Kid.initialState = { x: 1 }
    function App() { return h('div', null, h(Kid)) }
    App.initialState = {}
    App.onError = () => h('b', { className: 'fb' }, 'fallback')
    const m = mount(App)
    await m.rt.flushed()
    expect(m.text('.fb')).toBe('fallback')
    expect(err.mock.calls.some((c) => /SYG405/.test(String(c[0])))).toBe(true)
  })

  it('PARENT reaches CHILD.select(Fn); a root PARENT goes to the PARENT sink; a child without state is left out', async () => {
    function Kid({ state }) { return h('button', { className: 'kid' }, String(state.n)) }
    Kid.intent = ({ DOM }) => ({ UP: DOM.click('.kid') })
    Kid.model = { UP: { PARENT: (s) => s.n } }
    function Ghost({ state }) { return h('i', { className: 'ghost' }, String(state)) }
    function App({ state }) { return h('div', null, h('p', { className: 'got' }, String(state.got)), h(Kid, { state: 'kid' }), h(Ghost, { state: 'missing' })) }
    App.initialState = { got: '-', kid: { n: 4 } }
    App.intent = ({ CHILD }) => ({ GOT: CHILD.select(Kid) })
    App.model = { GOT: { STATE: (s, n) => ({ ...s, got: n }), PARENT: (s, n) => n * 10 } }
    const m = mount(App)
    const up = []
    m.app.sinks.PARENT.addListener({ next: (e) => up.push(e.value) })
    await m.rt.flushed()
    expect(m.$('.ghost')).toBe(null)
    click(m.$('.kid'))
    await m.rt.flushed()
    expect(m.text('.got')).toBe('4')
    expect(up).toEqual([40])
  })
})

describe('PLAN-4.6 R1 next core: sink scoping, context tracking', () => {
  const driver = (withValue) => (sink$) => {
    const got = []
    sink$.addListener({ next: (v) => got.push(v) })
    const src = {
      got,
      isolateSource: (s, scope) => s,
      isolateSink: (s$, scope) => s$.map((v) => ({ ...v, path: [scope, ...(v.path || [])] })),
      select: () => xs.never(),
    }
    if (withValue) src.isolateValue = (v, scope) => ({ ...v, path: [scope, ...(v.path || [])] })
    return src
  }
  it.each([['isolateSink (one stream per instance and sink)', false], ['isolateValue (no stream)', true]])('a child\'s driver value is scoped through every ancestor: %s', async (_, withValue) => {
    function Leaf() { return h('i', { className: 'leaf' }, 'x') }
    Leaf.intent = ({ DOM }) => ({ GO: DOM.click('.leaf') })
    Leaf.model = { GO: { API: () => ({ q: 1 }) } }
    function Mid() { return h('div', null, h(Leaf)) }
    function App() { return h('div', null, h(Mid)) }
    App.initialState = {}
    const m = mount(App, { API: driver(withValue) })
    await m.rt.flushed()
    click(m.$('.leaf'))
    const got = m.app.sources.API.got
    expect(got).toHaveLength(1)
    expect(got[0].q).toBe(1)
    expect(got[0].path).toHaveLength(2)
    expect(got[0].path.every((s) => typeof s == 'string')).toBe(true)
  })

  it('a context change skips views that did not read the changed key; onContextChanged names the keys', async () => {
    const views = { a: 0, b: 0 }, changed = []
    function A({ context }) { views.a++; return h('i', null, String(context.a)) }
    function B({ context }) { views.b++; return h('i', null, String(context.b)) }
    function App() { return h('div', null, h(A, { state: 'sa' }), h(B, { state: 'sb' })) }
    App.initialState = { a: 1, b: 1, sa: {}, sb: {} }
    App.context = { a: (s) => s.a, b: (s) => s.b }
    App.model = { B: (s) => ({ ...s, b: s.b + 1 }) }
    const m = mount(App, {}, { __hooks: { onContextChanged: (i, ctx, keys) => changed.push(keys) } })
    await m.rt.flushed()
    m.rt.dispatch('root', 'B')
    await m.rt.flushed()
    expect(views).toEqual({ a: 1, b: 2 })
    expect(changed).toEqual([['b']])
  })
})
