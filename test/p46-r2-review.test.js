// @vitest-environment jsdom
// PLAN-4.6 R2: fixes of the R1 review (G-294 ... G-305) on the next core. Next core only
// (SYGNAL_CORE=next, npm run test:next); a few cases run on both cores where the behaviour is shared.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { run, createElement as h, xs, Slot, renderComponent, mockDOMSource } from '../src/index.js'

const NEXT = globalThis.__SYGNAL_CORE__ === 'next'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ticks = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }

let apps = []
afterEach(() => { apps.forEach((a) => { try { a.dispose() } catch (_) {} }); apps = []; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers() })
function mount(App, drivers = {}, options = {}) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  const app = run(App, drivers, { mountPoint: '#root', ...options })
  apps.push(app)
  return { app, el, rt: app.__runtime, text: (s) => el.querySelector(s)?.textContent, $: (s) => el.querySelector(s) }
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('G-294: a change inside a named slot re-renders the child (both cores)', () => {
  it('<Card><Slot name="header">{"T" + n}</Slot></Card>', async () => {
    function Card({ slots }) { return h('section', { className: 'card' }, h('h1', null, ...(slots.header || []))) }
    function App({ state }) { return h('div', null, h('b', { className: 'inc' }, '+'), h(Card, { state: 'sub' }, h(Slot, { name: 'header' }, 'T' + state.n))) }
    App.initialState = { n: 0, sub: {} }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
    App.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(App)
    await vi.waitFor(() => expect(m.text('h1')).toBe('T0'))
    click(m.$('.inc'))
    await vi.waitFor(() => expect(m.text('h1')).toBe('T1'))
  })
})

describe.skipIf(!NEXT)('PLAN-4.6 R2 review fixes (next core)', () => {
  it('G-295: a child whose intent throws leaves no trace (no slice written, no watcher, onCreate paired with onDispose)', async () => {
    const created = [], disposed = []
    function Bad({ state }) { return h('i', null, String(state.k)) }
    Bad.isolatedState = true
    Bad.initialState = { k: 1 }
    Bad.intent = ({ STATE }) => { STATE.stream; throw new Error('intent boom') }
    Bad.model = { X: (s) => s }
    function App({ state }) { return h('div', null, h('b', null, JSON.stringify(state)), h(Bad, { state: 'bad' })) }
    App.initialState = { n: 0 }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const m = mount(App, {}, { __hooks: { onCreate: (i) => created.push(i.name), onDispose: (i) => disposed.push(i.name) } })
    await vi.waitFor(() => expect(m.$('[data-sygnal-error]')).toBeTruthy())
    await sleep(10)
    expect(m.rt.getState()).toEqual({ n: 0 })
    expect(created.filter((n) => n == 'Bad')).toEqual(disposed.filter((n) => n == 'Bad'))
    expect(m.app.__runtime.root.children().map((c) => c.name)).toEqual([])
  })

  it('G-296: sink values sent while the app starts reach a listener added right after run() / renderComponent', async () => {
    function App({ state }) { return h('div', null, String(state.n)) }
    App.initialState = { n: 0 }
    App.intent = () => ({ HELLO: xs.of(1) })
    App.model = { INITIALIZE: (s) => s, HELLO: { EVENTS: (s, d) => ({ type: 'HELLO', data: d }), LOG: () => 'hello' } }
    const m = mount(App)
    const got = []
    m.app.sinks.EVENTS.addListener({ next: (v) => got.push(v.type) })
    await ticks()
    expect(got).toEqual(['HELLO'])
    const t = renderComponent(App)
    await t.ready()
    expect(t.sinkValues('EVENTS').map((e) => e.type)).toEqual(['HELLO'])
    t.dispose()
  })

  it('G-297: removing one hook layer keeps the layers added after it', async () => {
    function App() { return h('div', null, 'x') }
    App.initialState = {}
    App.intent = () => ({ A: xs.never() })
    App.model = { A: (s) => s }
    const m = mount(App)
    const log = []
    const offA = m.rt.addHooks({ onAction: () => log.push('A') })
    const offB = m.rt.addHooks({ onAction: () => log.push('B') })
    offA()
    m.rt.dispatch('root', 'A')
    expect(log).toEqual(['B'])
    offB()
    m.rt.dispatch('root', 'A')
    expect(log).toEqual(['B'])
  })

  it('G-298: an error escaping the render (a throwing lens get) goes to onError; the app keeps flushing', async () => {
    const errors = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let boom = false
    const lens = { get: (s) => { if (boom) throw new Error('lens boom'); return s.sub }, set: (s, v) => ({ ...s, sub: v }) }
    function Kid({ state }) { return h('i', { className: 'kid' }, String(state.v)) }
    function App({ state }) { return h('div', null, h('b', { className: 'n' }, String(state.n)), h(Kid, { state: lens })) }
    App.initialState = { n: 0, sub: { v: 1 } }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.n') })
    App.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(App, {}, { onError: (e, info) => errors.push([e.message, info.phase]) })
    await vi.waitFor(() => expect(m.text('.kid')).toBe('1'))
    boom = true
    click(m.$('.n'))
    await sleep(10)
    expect(m.text('.n')).toBe('1')
    expect(m.text('.kid')).toBe('1') // the lens keeps its last value
    expect(errors.some(([msg]) => msg == 'lens boom')).toBe(true)
    boom = false
    click(m.$('.n'))
    await vi.waitFor(() => expect(m.text('.n')).toBe('2'))
    await m.rt.flushed()
  })

  it('G-299: renderComponent that throws while starting leaves no TDZ error behind', async () => {
    const errs = []
    const onErr = (e) => errs.push(e)
    process.on('uncaughtException', onErr)
    try {
      function App() { return h('div', null, h('button', { className: 'b' })) }
      App.initialState = {}
      // the first stream subscribes (renderComponent's listener bookkeeping), then SYG603 throws
      App.intent = ({ DOM }) => ({ A: DOM.click('.b'), B: 5 })
      App.model = { X: (s) => s }
      expect(() => renderComponent(App)).toThrow()
      await sleep(10)
    } finally { process.off('uncaughtException', onErr) }
    expect(errs.filter((e) => e instanceof ReferenceError)).toEqual([])
  })

  it('G-300: a disposed instance keeps no next() timer', async () => {
    vi.useFakeTimers()
    const actions = []
    function Kid() { return h('i', null, 'k') }
    Kid.intent = () => ({ GO: xs.of(1) })
    Kid.model = { GO: { EFFECT: (s, d, next) => next('LATER', 1, 1000) }, LATER: (s) => s }
    function App({ state }) { return h('div', null, state.show ? h(Kid) : null) }
    App.initialState = { show: true }
    App.intent = () => ({})
    const m = mount(App, {}, { __hooks: { onAction: (i, a) => actions.push(a.type) } })
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    await vi.advanceTimersByTimeAsync(0)
    expect(actions).toContain('GO')
    const before = vi.getTimerCount()
    m.rt.setState('root', { show: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(clear).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(before - 1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(actions).not.toContain('LATER')
  })

  it('G-301: flushed() resolves after dispose and after a throwing flush', async () => {
    function App() { return h('div', null, 'x') }
    App.initialState = { n: 0 }
    App.intent = () => ({})
    const m = mount(App)
    m.rt.setState('root', { n: 1 })
    const p = m.rt.flushed()
    m.app.dispose()
    await expect(Promise.race([p.then(() => 'ok'), sleep(50).then(() => 'stuck')])).resolves.toBe('ok')
  })

  it('G-302: a shared stream unmounted in one flush and mounted in the next keeps going (stops at the next macrotask, as xstream)', async () => {
    let starts = 0, stops = 0
    const shared = xs.create({ start: (l) => { starts++; l.next(1) }, stop: () => { stops++ } }).remember()
    function Kid() { return h('i', { className: 'kid' }, 'k') }
    Kid.intent = () => ({ S: shared })
    Kid.model = { S: (s) => s }
    function App({ state }) { return h('div', null, state.show ? h(Kid, { id: 'k' + state.v }) : null) }
    App.initialState = { show: true, v: 0 }
    App.intent = () => ({})
    const m = mount(App)
    await ticks()
    expect(starts).toBe(1)
    m.rt.setState('root', { show: false, v: 0 })
    await ticks()
    m.rt.setState('root', { show: true, v: 1 })
    await ticks()
    expect(starts).toBe(1)
    expect(stops).toBe(0)
    m.rt.setState('root', { show: false, v: 1 })
    await sleep(5)
    expect(stops).toBe(1)
  })

  it('G-303: a driver that throws on a sink value reaches the app hooks onError too', async () => {
    const seen = []
    function App() { return h('div', null, 'x') }
    App.initialState = {}
    App.intent = () => ({ GO: xs.of(1) })
    App.model = { GO: { BAD: () => 1 } }
    const BAD = (s$) => { s$.addListener({ next: () => { throw new Error('driver boom') } }); return xs.never() }
    const qm = globalThis.queueMicrotask
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((f) => qm(() => { try { f() } catch (e) { if (e.message != 'driver boom') throw e } }))
    mount(App, { BAD }, { __hooks: { onError: (e, info) => seen.push([e.message, info.phase]) } })
    await ticks()
    expect(seen).toEqual([['driver boom', 'driver']])
  })

  it('G-305: the mock DOM isolateValue tells scope s1 from s14', () => {
    const src = mockDOMSource({})
    expect(src.isolateValue({ sel: 'b.___s14', data: {} }, 's1').sel).toBe('b.___s14.___s1')
    expect(src.isolateValue({ sel: 'b.___s1', data: {} }, 's1').sel).toBe('b.___s1')
  })

  it('G-305: a click through nested scopes s1 / s16 in renderComponent', async () => {
    function Inner({ state }) { return h('button', { className: 'btn' }, String(state.n)) }
    Inner.intent = ({ DOM }) => ({ INC: DOM.click('.btn') })
    Inner.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    function Wrap() { return h(Inner) }
    function Leaf() { return h('i', null, 'x') }
    function App() { return h('div', null, h(Wrap), ...Array.from({ length: 14 }, (_, i) => h(Leaf, { id: 'l' + i }))) }
    App.initialState = { n: 0 }
    const t = renderComponent(App)
    await t.ready()
    await t.simulateEvent('.btn', 'click')
    await t.waitForState((s) => s.n === 1, 500)
    t.dispose()
  })
})
