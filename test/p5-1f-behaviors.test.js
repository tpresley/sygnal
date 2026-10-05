// PLAN-5 1-F item 4 (D197): defineBehavior extensions, all in the helper (0 B core):
// - timers: (slice, options, key) => ({ name: spec }), namespaced and merged into the host's
//   `timers` static without changing the host's own value
// - model handlers get (slice, data, next, props, options, key); intent gets (sources, options, key)
// - HOST: a reducer on the host's whole state (sortable's "reorder the host array")
// The existing behaviors (pager, selection, undoable, undo, persist) are covered by their own
// suites (p4-2b, p4-3d, p4-3b...), unchanged.
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { renderComponent, defineBehavior, ABORT, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
})

// a tooltip-like behavior: SHOW after a delay (options.delay) once it is pending
const delayed = defineBehavior({
  initialState: { pending: false, open: false },
  timers: (slice, options, key) => ({
    show: slice.pending && { after: options.delay, action: 'SHOW' },
    // a spec action that isn't the behavior's goes to the host as written
    ping: slice.open && options.ping && { every: 1000, action: options.ping },
    key: false && key,
  }),
  intent: ({ DOM }, options) => ({ HOVER: DOM.mouseenter(options.target) }),
  model: {
    HOVER: (s) => ({ ...s, pending: true }),
    SHOW: (s) => ({ ...s, pending: false, open: true }),
  },
})

describe('D197: timers in a behavior', () => {
  function Tip({ state }) { return h('div', null, h('span', { className: 'anchor' }, 'a'), h('p', { className: 'out' }, String(state.tip.open))) }
  Tip.uses = { tip: delayed({ delay: 300, target: '.anchor' }) }
  Tip.model = { PINGED: (s) => ({ ...s, pings: (s.pings || 0) + 1 }) }

  it('declares namespaced timers that fire the behavior action', async () => {
    vi.useFakeTimers()
    t = renderComponent(Tip)
    await t.ready()
    expect(t.timers()).toEqual([])
    t.simulateAction('tip.HOVER')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.timers()).toEqual([{ name: 'tip.show', after: 300, action: 'tip.SHOW', component: 'Tip' }])
    await vi.advanceTimersByTimeAsync(299)
    expect(t.state.tip.open).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.state.tip).toEqual({ pending: false, open: true })
    expect(t.timers()).toEqual([])
  })

  it("merges with the host's own timers; the host's static keeps its value and can be reassigned", async () => {
    function Host({ state }) { return h('div', null, h('span', { className: 'anchor' }, 'a')) }
    const own = (state) => ({ tick: state.running && { every: 100, action: 'TICK' } })
    Host.timers = own
    Host.uses = { tip: delayed({ delay: 50, target: '.anchor', ping: 'PINGED' }) }
    Host.initialState = { running: true, ticks: 0, pings: 0 }
    Host.model = { TICK: (s) => ({ ...s, ticks: s.ticks + 1 }), PINGED: (s) => ({ ...s, pings: s.pings + 1 }) }
    vi.useFakeTimers()
    t = renderComponent(Host)
    await t.ready()
    expect(t.timers().map(x => x.name)).toEqual(['tick'])
    t.simulateAction('tip.HOVER')
    await vi.advanceTimersByTimeAsync(50)
    expect(t.state.tip.open).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    // the ping timer names a host action: not namespaced
    expect(t.timers().map(x => x.name + ':' + x.action).sort()).toEqual(['tick:TICK', 'tip.ping:PINGED'])
    expect(t.state.pings).toBe(1)
    expect(t.state.ticks).toBeGreaterThan(9)
    // the host's own declaration is still what it assigned (the static is an accessor over it)
    const reassigned = () => ({})
    Host.timers = reassigned
    expect(typeof Host.timers).toBe('function')
    expect(Host.timers({ tip: { pending: false, open: false } })).toEqual({ 'tip.show': false, 'tip.ping': false, 'tip.key': false })
    Host.timers = own
    expect(Host.timers({ running: true, tip: { open: false } }).tick).toEqual({ every: 100, action: 'TICK' })
  })

  it('a host with two uses of the same behavior gets both, each under its key', async () => {
    function Two() { return h('div', null, h('span', { className: 'a' }), h('span', { className: 'b' })) }
    Two.uses = { a: delayed({ delay: 10, target: '.a' }), b: delayed({ delay: 20, target: '.b' }) }
    vi.useFakeTimers()
    t = renderComponent(Two)
    await t.ready()
    t.simulateAction('a.HOVER'); t.simulateAction('b.HOVER')
    await vi.advanceTimersByTimeAsync(0)
    expect(t.timers().map(x => x.name + ':' + x.action + ':' + x.after)).toEqual(['a.show:a.SHOW:10', 'b.show:b.SHOW:20'])
    await vi.advanceTimersByTimeAsync(20)
    expect([t.state.a.open, t.state.b.open]).toEqual([true, true])
  })

  it('works on Collection items (each item its own timers)', async () => {
    function Row({ state }) { return h('li', null, h('span', { className: 'anchor' }, state.id)) }
    Row.uses = { tip: delayed({ delay: 100, target: '.anchor' }) }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 'x' }, { id: 'y' }] }
    vi.useFakeTimers()
    t = renderComponent(List)
    await t.ready()
    t.simulateEvent('.anchor', 'mouseenter')
    await vi.advanceTimersByTimeAsync(100)
    expect(t.state.rows.map(r => r.tip?.open)).toEqual([true, undefined])
  })
})

describe('D197: options and key reach the model handlers and the intent', () => {
  const seen = []
  const probe = defineBehavior({
    initialState: { n: 0 },
    intent: ({ DOM }, options, key) => { seen.push(['intent', options.step, key]); return { BUMP: DOM.click(options.button) } },
    model: {
      BUMP: {
        STATE: (s, _d, _next, props, options, key) => { seen.push(['STATE', options.step, key, typeof props.uid]); return { ...s, n: s.n + options.step } },
        EFFECT: (_s, _d, _next, props, options, key) => { seen.push(['EFFECT', options.step, key, !!props.signal]) },
        EVENTS: (_s, _d, _next, _props, options, key) => ({ type: key + '.BUMPED', data: options.step }),
      },
    },
  })
  function Counter() { return h('div', null, h('button', { className: 'up' }, '+')) }
  Counter.uses = { count: probe({ step: 5, button: '.up' }) }

  it('(slice, data, next, props, options, key) and (sources, options, key)', async () => {
    t = renderComponent(Counter)
    await t.ready()
    t.simulateEvent('.up', 'click')
    await t.settle()
    expect(t.state.count.n).toBe(5)
    expect(seen).toEqual([['intent', 5, 'count'], ['STATE', 5, 'count', 'function'], ['EFFECT', 5, 'count', true]])
    expect(t.sinkValues('EVENTS')).toEqual([{ type: 'count.BUMPED', data: 5 }])
  })
})

describe('D197: HOST reducers edit the host state', () => {
  const reorder = defineBehavior({
    initialState: { moves: 0 },
    calculated: { moved: (s) => s.moves > 0 },
    model: {
      // the host's array named by options.from; the slice is written in the same state
      UP: { HOST: (state, id, next, _props, { from }, key) => {
        const a = state[from], i = a.findIndex(x => x.id === id)
        if (i <= 0) return ABORT
        const out = [...a]; [out[i - 1], out[i]] = [out[i], out[i - 1]]
        next('MOVED', id)
        return { ...state, [from]: out, [key]: { ...state[key], moves: state[key].moves + 1 } }
      } },
      MOVED: { EVENTS: (_s, id) => ({ type: 'MOVED', data: id }) },
      // HOST returning the same state: no change
      NOOP: { HOST: (state) => state },
    },
  })
  function List({ state }) { return h('ul', null, ...state.items.map(x => h('li', { key: x.id }, x.id))) }
  List.initialState = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
  List.uses = { order: reorder({ from: 'items' }) }

  it('the reducer gets and returns the whole state; the slice is recomputed; next() is namespaced', async () => {
    vi.useFakeTimers()
    t = renderComponent(List)
    await t.ready()
    t.simulateAction('order.UP', 'c')
    await vi.advanceTimersByTimeAsync(20)
    expect(t.state.items.map(x => x.id)).toEqual(['a', 'c', 'b'])
    expect(t.state.order).toEqual({ moves: 1, moved: true })
    expect(t.sinkValues('EVENTS')).toEqual([{ type: 'MOVED', data: 'c' }])
    t.simulateAction('order.UP', 'a')
    t.simulateAction('order.NOOP')
    await vi.advanceTimersByTimeAsync(20)
    expect(t.state.items.map(x => x.id)).toEqual(['a', 'c', 'b'])
  })

  it('a host entry for the same action runs after it, on its result', async () => {
    function L2({ state }) { return h('ul', null, ...state.items.map(x => h('li', { key: x.id }, x.id))) }
    L2.initialState = { items: [{ id: 'a' }, { id: 'b' }], log: [] }
    L2.uses = { order: reorder({ from: 'items' }) }
    L2.model = { 'order.UP': (s, id) => ({ ...s, log: [...s.log, s.items.map(x => x.id).join('') + ':' + id] }) }
    t = renderComponent(L2)
    await t.ready()
    t.simulateAction('order.UP', 'b')
    await t.settle()
    expect(t.state.log).toEqual(['ba:b'])
    expect(t.state.order.moves).toBe(1)
  })
})

describe('D197: additive (no options/key/timers used: as before)', () => {
  it('a behavior without the new keys behaves as in PLAN-4', async () => {
    const toggle = defineBehavior({ initialState: { on: false }, model: { FLIP: (s) => ({ ...s, on: !s.on }) } })
    function T() { return h('div', null) }
    T.uses = { t: toggle() }
    t = renderComponent(T)
    await t.ready()
    expect('timers' in T).toBe(false)
    t.simulateAction('t.FLIP')
    await t.settle()
    expect(t.state.t.on).toBe(true)
  })
})

describe('the behaviors guide sample (hoverDelay)', () => {
  const hoverDelay = defineBehavior({
    initialState: { pending: false, open: false },
    intent: ({ DOM }, { target }) => ({ ENTER: DOM.mouseenter(target), LEAVE: DOM.mouseleave(target) }),
    timers: (slice, { delay = 300 }) => ({ show: slice.pending && { after: delay, action: 'SHOW' } }),
    model: {
      ENTER: (slice) => ({ ...slice, pending: true }),
      LEAVE: (slice) => ({ ...slice, pending: false, open: false }),
      SHOW: (slice) => ({ ...slice, pending: false, open: true }),
    },
  })
  it('opens state.tip.open half a second after the pointer enters; leaving cancels', async () => {
    function Card() { return h('div', null, h('button', { className: 'help' }, '?')) }
    Card.uses = { tip: hoverDelay({ target: '.help', delay: 500 }) }
    vi.useFakeTimers()
    t = renderComponent(Card)
    await t.ready()
    t.simulateEvent('.help', 'mouseenter')
    await vi.advanceTimersByTimeAsync(400)
    t.simulateEvent('.help', 'mouseleave')
    await vi.advanceTimersByTimeAsync(400)
    expect(t.state.tip.open).toBe(false)
    t.simulateEvent('.help', 'mouseenter')
    await vi.advanceTimersByTimeAsync(500)
    expect(t.state.tip.open).toBe(true)
  })
})

// PLAN-5 1-S G-378: STATE and HOST in one behavior model entry compose: STATE (on the slice)
// first, then HOST on the whole state with that update applied (before: one silently replaced
// the other, by key order)
describe('1-S G-378: STATE and HOST in one entry', () => {
  for (const order of ['STATE first', 'HOST first']) it(`both apply (${order} in the entry)`, async () => {
    const STATE = (s) => ({ ...s, n: s.n + 1 })
    const HOST = (st, d, next, props, opts, key) => ({ ...st, hostN: st.hostN + 1, seen: st[key].n })
    const b = defineBehavior({ initialState: { n: 0 }, model: { GO: order == 'STATE first' ? { STATE, HOST } : { HOST, STATE } } })
    function C({ state }) { return h('div', null, String(state.hostN)) }
    C.uses = { b: b() }
    C.initialState = { hostN: 0 }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('b.GO'); await t.settle()
    expect(t.state.b.n).toBe(1)
    expect(t.state.hostN).toBe(1)
    // HOST sees the slice STATE wrote
    expect(t.state.seen).toBe(1)
  })
  it('ABORT from either keeps the other', async () => {
    const b = defineBehavior({ initialState: { n: 0 }, model: {
      S_ONLY: { STATE: (s) => ({ ...s, n: s.n + 1 }), HOST: () => ABORT },
      H_ONLY: { STATE: () => ABORT, HOST: (st) => ({ ...st, hostN: st.hostN + 1 }) },
    } })
    function C() { return h('div') }
    C.uses = { b: b() }
    C.initialState = { hostN: 0 }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('b.S_ONLY'); await t.settle()
    t.simulateAction('b.H_ONLY'); await t.settle()
    expect(t.state.b.n).toBe(1)
    expect(t.state.hostN).toBe(1)
  })
})
