// @vitest-environment jsdom
// PLAN-4.6 parity: reentrancy and startup races (spike 0-S §9, PLAN-4.5 G-257 / G-260 / G-266 /
// G-283), ported to the public API. Run-to-completion, FIFO, no nested flush, one patch.
import { it, expect, vi } from 'vitest'
import { parity, itNext, needs, mount, forget, h, click, until, sleep, microtasks, xs, Collection } from './harness.js'

/** a bus driver that delivers every sink value synchronously, during sink delivery */
const syncBus = () => (sink$) => {
  const ls = new Set()
  sink$.addListener({ next: (v) => ls.forEach((l) => l.next(v)) })
  return { select: (t) => xs.create({ start: (l) => { ls.add({ next: (v) => v.type === t && l.next(v.data) }) }, stop: () => {} }) }
}

parity('parity: reentrancy (FIFO, run to completion, one patch)', () => {
  function A({ state }) { return h('button', { className: 'a' }, `a${state.n}`) }
  function B({ state }) { return h('i', { className: 'b' }, `b${state.n}`) }
  const make = (order) => {
    A.intent = ({ DOM }) => ({ GO: DOM.click('.a') })
    A.model = { GO: { STATE: (s) => { order.push('A.STATE'); return { ...s, n: s.n + 1 } }, BUS: (s) => { order.push('A.BUS'); return { type: 'PING', data: s.n + 1 } }, EFFECT: () => order.push('A.EFFECT') } }
    B.intent = ({ BUS }) => ({ PING: BUS.select('PING') })
    B.model = { PING: (s, n) => { order.push('B.PING'); return { ...s, n: s.n + n } } }
    function P() { return h('div', null, h(A, { state: 'a' }), h(B, { state: 'b' })) }
    P.initialState = { a: { n: 0 }, b: { n: 0 } }
    return P
  }

  it('a driver emitting synchronously into a source during sink delivery: both actions apply, one patch', async () => {
    const order = []
    const m = mount(make(order), { BUS: syncBus() })
    await until(() => expect(m.text('.b')).toBe('b0'))
    await sleep(20)
    const before = m.patches()
    click(m.$('.a'))
    await until(() => expect(m.text('.a') + m.text('.b')).toBe('a1b1'))
    await sleep(20)
    expect(m.state()).toEqual({ a: { n: 1 }, b: { n: 1 } })
    expect(m.patches() - before).toBe(1)
    expect([...order].sort()).toEqual(['A.BUS', 'A.EFFECT', 'A.STATE', 'B.PING']) // each handler once
  })

  itNext('D165 synchronous reducers', "the reentrant action runs after all of the current action's handlers (FIFO), and the state is applied synchronously", async () => {
    const order = []
    const m = mount(make(order), { BUS: syncBus() })
    await until(() => expect(m.text('.b')).toBe('b0'))
    await sleep(20)
    click(m.$('.a'))
    expect(order).toEqual(['A.STATE', 'A.BUS', 'A.EFFECT', 'B.PING'])
    expect(m.state()).toEqual({ a: { n: 1 }, b: { n: 1 } })
  })

  it('an EFFECT that dispatches synchronously into another component: each action sees the state after the one before', async () => {
    const trace = []
    const cmd$ = xs.create()
    function Child({ state }) { return h('i', { className: 'c' }, String(state.v)) }
    Child.intent = () => ({ CMD: cmd$ })
    Child.model = { CMD: (s, d) => { trace.push(['CMD', d]); return { ...s, v: d } } }
    function P({ state }) { return h('div', null, h('button', { className: 'go' }, String(state.n)), h(Child, { state: 'child' })) }
    P.initialState = { n: 0, child: { v: 0 } }
    P.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    P.model = { GO: { STATE: (s) => ({ ...s, n: s.n + 1 }), EFFECT: (s) => { cmd$.shamefullySendNext(s.n + 1); trace.push(['EFFECT returned', s.n]) } } }
    const m = mount(P)
    await until(() => expect(m.text('.c')).toBe('0'))
    await sleep(20)
    click(m.$('.go')); click(m.$('.go'))
    await until(() => expect(m.text('.go') + m.text('.c')).toBe('22'))
    expect(trace.filter((t) => t[0] == 'CMD')).toEqual([['CMD', 1], ['CMD', 2]])
    expect(trace.filter((t) => t[0] != 'CMD')).toEqual([['EFFECT returned', 0], ['EFFECT returned', 1]])
  })

  itNext('D165 synchronous reducers', 'an EFFECT dispatching synchronously: the dispatched action runs right after the current one, before the next event; one patch', async () => {
    const trace = []
    const cmd$ = xs.create()
    function Child({ state }) { return h('i', { className: 'c' }, String(state.v)) }
    Child.intent = () => ({ CMD: cmd$ })
    Child.model = { CMD: (s, d) => { trace.push(['CMD', d]); return { ...s, v: d } } }
    function P({ state }) { return h('div', null, h('button', { className: 'go' }, String(state.n)), h(Child, { state: 'child' })) }
    P.initialState = { n: 0, child: { v: 0 } }
    P.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    P.model = { GO: { STATE: (s) => ({ ...s, n: s.n + 1 }), EFFECT: (s) => { cmd$.shamefullySendNext(s.n + 1); trace.push(['EFFECT returned', s.n]) } } }
    const m = mount(P)
    await until(() => expect(m.text('.c')).toBe('0'))
    await sleep(20)
    const before = m.patches()
    click(m.$('.go')); click(m.$('.go'))
    expect(trace).toEqual([['EFFECT returned', 0], ['CMD', 1], ['EFFECT returned', 1], ['CMD', 2]])
    await until(() => expect(m.text('.go') + m.text('.c')).toBe('22'))
    await sleep(10)
    expect(m.patches() - before).toBe(1)
  })

  needs('R3').it('an action arriving during the render flush (a driver replying synchronously to a static) is applied in the same patch', async () => {
    // a minimal static driver: answers each declaration synchronously, inside the flush
    const echo = () => (sink$) => {
      const to = new Map()
      sink$.addListener({ next: (v) => to.get(v.__emitterId)?.next({ type: 'ECHO', data: v.echo }) })
      return { __sygnalStatic: 'echo', __sygnalReplies: true, replies: (id) => xs.create({ start: (l) => to.set(id, l), stop: () => to.delete(id) }) }
    }
    function Item({ state }) { return h('li', { className: 'e' }, `${state.id}:${state.seen ?? '-'}`) }
    Item.echo = (s) => s.id * 10
    Item.model = { ECHO: (s, v) => ({ ...s, seen: v }) }
    function L() { return h('ul', null, h('button', { className: 'add' }), h(Collection, { of: Item, from: 'items' })) }
    L.initialState = { items: [{ id: 1 }] }
    L.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
    L.model = { ADD: (s) => ({ ...s, items: [...s.items, { id: s.items.length + 1 }] }) }
    const m = mount(L, { ECHO: echo() })
    await until(() => expect(m.$$('.e').map((e) => e.textContent)).toEqual(['1:10']))
    await sleep(20)
    const before = m.patches()
    click(m.$('.add'))
    await until(() => expect(m.$$('.e').map((e) => e.textContent)).toEqual(['1:10', '2:20']))
    await sleep(20)
    expect(m.patches() - before).toBe(1)
  })

  needs('R3').it("the first render, a static's declaration and its synchronous reply are one patch", async () => {
    const echo = () => (sink$) => {
      const to = new Map()
      sink$.addListener({ next: (v) => to.get(v.__emitterId)?.next({ type: 'ECHO', data: v.echo }) })
      return { __sygnalStatic: 'echo', __sygnalReplies: true, replies: (id) => xs.create({ start: (l) => to.set(id, l), stop: () => to.delete(id) }) }
    }
    function Item({ state }) { return h('li', { className: 'e' }, `${state.id}:${state.seen ?? '-'}`) }
    Item.echo = (s) => s.id * 10
    Item.model = { ECHO: (s, v) => ({ ...s, seen: v }) }
    function L() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    L.initialState = { items: [{ id: 1 }] }
    const m = mount(L, { ECHO: echo() })
    await until(() => expect(m.$$('.e').map((e) => e.textContent)).toEqual(['1:10']))
    await sleep(20)
    expect(m.patches()).toBe(1)
  })
})

parity('parity: startup races (G-266, G-257 grow) and teardown', () => {
  it("G-266: a child created in the root's first render: an intent that emits at once reduces the initial state", async () => {
    const seen = []
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 1 }
    Child.intent = () => ({ INC: xs.of(1) })
    Child.model = { INC: (s) => { seen.push(s.n); return { ...s, n: s.n + 1 } } }
    function Root() { return h('div', null, h(Child)) }
    Root.initialState = { x: 0 }
    const m = mount(Root)
    await until(() => expect(m.text('.c')).toBe('2'))
    await sleep(30)
    expect(seen).toEqual([1])
  })

  it("G-266: the startup is one patch: the child's pre-intent state '1' is never shown", async () => {
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 1 }
    Child.intent = () => ({ INC: xs.of(1) })
    Child.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    function Root() { return h('div', null, h(Child)) }
    Root.initialState = { x: 0 }
    const m = mount(Root)
    await until(() => expect(m.text('.c')).toBe('2'))
    await sleep(30)
    expect(m.patches()).toBe(1)
  })

  it("G-266: BOOTSTRAP in a child created in the root's first render sees the initial state", async () => {
    const seen = []
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 1 }
    Child.model = { BOOTSTRAP: (s) => { seen.push(s?.n); return { ...s, n: s.n * 10 } } }
    function Root() { return h('div', null, h(Child)) }
    Root.initialState = { x: 0 }
    Root.model = { BOOTSTRAP: (s) => s }
    const m = mount(Root)
    await until(() => expect(m.text('.c')).toBe('10'))
    expect(seen).toEqual([1])
  })

  it('BOOTSTRAP runs once, after the first render is in the DOM', async () => {
    const seen = []
    function C({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    C.initialState = { n: 1 }
    C.model = { BOOTSTRAP: { EFFECT: () => seen.push(document.querySelector('.c')?.textContent ?? null) } }
    mount(C)
    await until(() => expect(seen.length).toBe(1))
    await sleep(30)
    expect(seen).toEqual(['1'])
  })

  needs('R2').it('G-257 / D153 grow: every render adds an item with intent (a chain of new components) and it completes', async () => {
    function Leaf({ state }) { return h('i', { className: 'leaf' }, String(state.n)) }
    Leaf.intent = ({ DOM }) => ({ C: DOM.click('.leaf') })
    Leaf.model = { C: (s) => s }
    function Grow({ state }) { return h('div', null, h('b', { className: 'g' }, String(state.items.length)), h(Collection, { of: Leaf, from: 'items' })) }
    Grow.initialState = { items: [] }
    Grow.intent = ({ DOM }) => ({ ADD: DOM.select('.g').elements() })
    Grow.model = { ADD: (s) => (s.items.length < 30 ? { items: [...s.items, { id: s.items.length + 1, n: s.items.length }] } : s) }
    const m = mount(Grow)
    await until(() => expect(m.$$('.leaf').length).toBe(30))
  })

  needs('R2').it('teardown: removed items stop their intent streams', async () => {
    const stopped = []
    function It({ state }) { return h('li', { className: 'it' }, String(state.id)) }
    It.intent = ({ DOM }) => ({ C: DOM.click('.it').map(() => 1), T: xs.create({ start: () => {}, stop: () => stopped.push('own') }).map((x) => x) })
    It.model = { C: (s) => s, T: (s) => s }
    function L() { return h('ul', null, h('button', { className: 'clear' }), h(Collection, { of: It, from: 'items' })) }
    L.initialState = { items: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) }
    L.intent = ({ DOM }) => ({ CLEAR: DOM.click('.clear') })
    L.model = { CLEAR: (s) => ({ ...s, items: [] }) }
    const m = mount(L)
    await until(() => expect(m.$$('.it').length).toBe(50))
    await sleep(20)
    click(m.$('.clear'))
    await until(() => expect(m.$$('.it').length).toBe(0))
    await until(() => expect(stopped.length).toBe(50))
  })

  needs('R2').itNext('D165 / Q18 teardown: scoped _remove swap, 0 timers', 'teardown: removed items stop their intent streams at the first macrotask after the flush (G-302: as xstream), with no xstream stop timer', async () => {
    const stopped = []
    function It({ state }) { return h('li', { className: 'it' }, String(state.id)) }
    It.intent = ({ DOM }) => ({ C: DOM.click('.it').map(() => 1), T: xs.create({ start: () => {}, stop: () => stopped.push('own') }).map((x) => x) })
    It.model = { C: (s) => s, T: (s) => s }
    function L() { return h('ul', null, h('button', { className: 'clear' }), h(Collection, { of: It, from: 'items' })) }
    L.initialState = { items: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) }
    L.intent = ({ DOM }) => ({ CLEAR: DOM.click('.clear') })
    L.model = { CLEAR: (s) => ({ ...s, items: [] }) }
    const m = mount(L)
    await until(() => expect(m.$$('.it').length).toBe(50))
    await sleep(20)
    const st = globalThis.setTimeout, stacks = []
    // (a stop cascading from an older xstream timer, left by an earlier test, is not this teardown's)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(function (f, ms) { const k = new Error().stack; if (String(f).includes('_stopNow') && !k.includes('listOnTimeout')) stacks.push(k); return st(f, ms) })
    click(m.$('.clear'))
    await until(() => expect(m.$$('.it').length).toBe(0))
    await until(() => expect(stopped.length).toBe(50))
    expect(stacks).toEqual([])
  })

  // R1: the same teardown with tag children (no Collection), so the next core's R1 covers it
  function tagList(stopped) {
    function It({ n }) { return h('li', { className: 'it' }, String(n)) }
    It.intent = ({ DOM }) => ({ C: DOM.click('.it').map(() => 1), T: xs.create({ start: () => {}, stop: () => stopped.push('own') }).map((x) => x) })
    It.model = { C: (s) => s, T: (s) => s }
    function L({ state }) { return h('ul', null, h('button', { className: 'clear' }), ...(state.show ? Array.from({ length: 50 }, (_, i) => h(It, { id: 'i' + i, n: i })) : [])) }
    L.initialState = { show: true }
    L.intent = ({ DOM }) => ({ CLEAR: DOM.click('.clear') })
    L.model = { CLEAR: (s) => ({ ...s, show: false }) }
    return L
  }

  it('teardown (tag children): removed children stop their intent streams', async () => {
    const stopped = []
    const m = mount(tagList(stopped))
    await until(() => expect(m.$$('.it').length).toBe(50))
    await sleep(20)
    click(m.$('.clear'))
    await until(() => expect(m.$$('.it').length).toBe(0))
    await until(() => expect(stopped.length).toBe(50))
  })

  itNext('D165 / Q18 teardown: scoped _remove swap, 0 timers', 'teardown (tag children): removed children stop their intent streams at the first macrotask after the flush (G-302: as xstream), with no xstream stop timer', async () => {
    const stopped = []
    const m = mount(tagList(stopped))
    await until(() => expect(m.$$('.it').length).toBe(50))
    await sleep(20)
    const st = globalThis.setTimeout, stacks = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(function (f, ms) { const k = new Error().stack; if (String(f).includes('_stopNow') && !k.includes('listOnTimeout')) stacks.push(k); return st(f, ms) })
    click(m.$('.clear'))
    await until(() => expect(m.$$('.it').length).toBe(0))
    await until(() => expect(stopped.length).toBe(50))
    expect(stacks).toEqual([])
  })

  it('G-260 / G-283: a loop that never settles keeps the page responsive and stops on dispose', async () => {
    function Loop({ state }) { return h('b', { className: 'g' }, String(state.n)) }
    Loop.initialState = { n: 0 }
    Loop.intent = ({ DOM }) => ({ ADD: DOM.select('.g').elements() })
    Loop.model = { ADD: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(Loop)
    let ticks = 0
    const iv = setInterval(() => ticks++, 5)
    await sleep(200)
    clearInterval(iv)
    expect(ticks).toBeGreaterThan(5) // macrotasks still run
    expect(m.state().n).toBeGreaterThan(50)
    m.app.dispose(); forget(m.app)
    const n = m.state().n
    await sleep(30)
    expect(m.state().n).toBe(n)
  })

  itNext('PLAN-4.6 §2.4 flush contract (loop guard: MessageChannel hop, no timers)', 'G-283: a loop that never settles arms no timer', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout')
    function Loop({ state }) { return h('b', { className: 'g' }, String(state.n)) }
    Loop.initialState = { n: 0 }
    Loop.intent = ({ DOM }) => ({ ADD: DOM.select('.g').elements() })
    Loop.model = { ADD: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(Loop)
    await sleep(200)
    // xstream's own deferred stops (streams disposed by an earlier test) aside; the sleep is the test's
    const mine = spy.mock.calls.filter((c) => !String(c[0]).includes('_stopNow'))
    expect(m.state().n).toBeGreaterThan(50)
    expect(mine.length).toBeLessThanOrEqual(1)
  })
})

parity('parity: no timer-dependent startup (G-266 / G-273 / G-274 / G-284 under fake timers)', () => {
  itNext('D165 one-clock startup', 'G-266: under fake timers that are never advanced, the startup needs no timer', async () => {
    vi.useFakeTimers()
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.intent = () => ({ INC: xs.of(1) })
    Child.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    function Root() { return h('div', null, h(Child, { state: 'kid' })) }
    Root.initialState = { kid: { n: 1 } }
    const m = mount(Root)
    await microtasks(40)
    expect(m.text('.c')).toBe('2')
  })

  itNext('D165 BOOTSTRAP a microtask after the first render', 'BOOTSTRAP runs with fake timers never advanced (not at 10 ms)', async () => {
    vi.useFakeTimers()
    const seen = []
    function C({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    C.initialState = { n: 1 }
    C.model = { BOOTSTRAP: (s) => { seen.push(s.n); return { ...s, n: 5 } } }
    const m = mount(C)
    await microtasks(40)
    expect(seen).toEqual([1])
    expect(m.text('.c')).toBe('5')
  })

  it('an update that creates no component patches without the clock (fake timers)', async () => {
    function C({ state }) { return h('button', { className: 'b' }, String(state.n)) }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    C.model = { INC: (s) => ({ n: s.n + 1 }) }
    const m = mount(C)
    await until(() => expect(m.$('.b')).toBeTruthy())
    await sleep(20)
    vi.useFakeTimers()
    click(m.$('.b'))
    await microtasks()
    expect(m.text('.b')).toBe('1')
  })

  needs('R2').itNext('D165 one-clock startup (no first-render gate)', 'G-273: a new item with intent, added under fake timers then vi.clearAllTimers(), appears and responds without the clock', async () => {
    function Item({ state }) { return h('li', { className: 'item' }, `${state.id}:${state.n || 0}`) }
    Item.intent = ({ DOM }) => ({ X: DOM.click('.item') })
    Item.model = { X: (s) => ({ ...s, n: (s.n || 0) + 1 }) }
    function App({ state }) { return h('div', null, h('button', { className: 'b' }, String(state.n)), h('ul', null, h(Collection, { of: Item, from: 'items' }))) }
    App.initialState = { n: 0, items: [] }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    App.model = { INC: (s) => ({ n: s.n + 1, items: [...s.items, { id: 'i' + s.n }] }) }
    const m = mount(App)
    await until(() => expect(m.$('.b')).toBeTruthy())
    await sleep(20)
    vi.useFakeTimers()
    click(m.$('.b'))
    await microtasks()
    vi.clearAllTimers()
    await microtasks()
    expect(m.$$('.item').map((e) => e.textContent)).toEqual(['i0:0'])
    click(m.$('.item'))
    await microtasks()
    expect(m.$$('.item').map((e) => e.textContent)).toEqual(['i0:1'])
  })

  itNext('PLAN-4.6 §2.4 flush contract (G-274 / G-284, D159)', 'G-284: raw run() under never-advanced fake timers keeps rendering past 100 updates', async () => {
    function C({ state }) { return h('button', { className: 'b' }, String(state.n)) }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    C.model = { INC: (s) => ({ n: s.n + 1 }) }
    const m = mount(C)
    await until(() => expect(m.$('.b')).toBeTruthy())
    await sleep(20)
    vi.useFakeTimers()
    for (let i = 1; i <= 150; i++) { click(m.$('.b')); await microtasks(10) }
    await microtasks(50)
    expect(m.text('.b')).toBe('150')
  })
})
