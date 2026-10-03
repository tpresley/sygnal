// PLAN-4 3-C (GS-7): makeTimerDriver() and the `timers` static, under renderComponent (its
// timer fake runs the real driver) and fake timers (vi.advanceTimersByTimeAsync drives it).
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { renderComponent, renderToString, makeTimerDriver, Switchable, lazy } from '../src/index.js'
import { timerDriver } from '../src/extra/timers.js'
import { createElement as h } from '../src/pragma/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function Stopwatch({ state }) {
  return h('div', null, h('span', { className: 'ticks' }, String(state.ticks)))
}
Stopwatch.initialState = { running: false, ticks: 0, seen: [] }
Stopwatch.timers = (state) => ({ tick: state.running && { every: 100, action: 'TICK' } })
Stopwatch.model = {
  START: (state) => ({ ...state, running: true }),
  PAUSE: (state) => ({ ...state, running: false }),
  RESET: (state) => ({ ...state, running: false, ticks: 0, seen: [] }),
  TICK: (state, tick) => ({ ...state, ticks: state.ticks + 1, seen: [...state.seen, tick] }),
}

const act = async (name, data, ms = 0) => { t.simulateAction(name, data); await vi.advanceTimersByTimeAsync(ms) }

describe('every: a stopwatch on fake timers', () => {
  it('start, pause, resume, reset; 1,000 ticks with no drift', async () => {
    vi.useFakeTimers()
    t = renderComponent(Stopwatch)
    await t.ready()
    expect(t.timers()).toEqual([])
    await act('START')
    expect(t.timers()).toEqual([{ name: 'tick', every: 100, action: 'TICK', component: 'Stopwatch' }])
    const t0 = Date.now()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(t.state.ticks).toBe(1000)
    const seen = t.state.seen
    // tick n is due at start + n * every: n from 1, t = Date.now() on the grid
    expect(seen.map(x => x.n)).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1))
    expect(seen.every((x, i) => x.t === t0 + (i + 1) * 100)).toBe(true)

    await act('PAUSE')
    expect(t.timers()).toEqual([])
    await vi.advanceTimersByTimeAsync(5000)
    expect(t.state.ticks).toBe(1000)

    await act('START')            // resume: a fresh timer, n from 1 again
    await vi.advanceTimersByTimeAsync(250)
    expect(t.state.ticks).toBe(1002)
    expect(t.state.seen.at(-1).n).toBe(2)

    await act('RESET')
    expect(t.state.ticks).toBe(0)
    expect(t.timers()).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.state.ticks).toBe(0)
  })

  it('dispose stops everything: no timer is left (vi.getTimerCount() === 0)', async () => {
    vi.useFakeTimers()
    t = renderComponent(Stopwatch, { initialState: { running: true, ticks: 0, seen: [] } })
    await t.ready()
    await vi.advanceTimersByTimeAsync(350)
    expect(t.state.ticks).toBe(3)
    t.dispose()
    t = null
    await vi.advanceTimersByTimeAsync(100)   // xstream stops its streams a tick after the last listener goes
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an equal spec keeps the timer running; a changed spec restarts it', async () => {
    vi.useFakeTimers()
    function C() { return h('p', null, 'x') }
    C.initialState = { every: 0, other: 0, at: [] }
    C.timers = (s) => ({ tick: s.every && { every: s.every, action: 'TICK' } })
    C.model = {
      START: (s) => ({ ...s, every: 100 }),
      OTHER: (s) => ({ ...s, other: s.other + 1 }),
      SLOWER: (s) => ({ ...s, every: 250 }),
      TICK: (s, { t: now }) => ({ ...s, at: [...s.at, now] }),
    }
    t = renderComponent(C)
    await t.ready()
    await act('START')
    const t0 = Date.now()
    await vi.advanceTimersByTimeAsync(50)
    await act('OTHER')          // structurally equal declaration: not restarted
    await vi.advanceTimersByTimeAsync(50)
    expect(t.state.at).toEqual([t0 + 100])
    await vi.advanceTimersByTimeAsync(30)
    await act('SLOWER')         // changed: restarted at t0 + 130
    expect(t.timers()).toEqual([{ name: 'tick', every: 250, action: 'TICK', component: 'C' }])
    await vi.advanceTimersByTimeAsync(500)
    expect(t.state.at).toEqual([t0 + 100, t0 + 380, t0 + 630])
  })
})

describe('after: a countdown', () => {
  function Countdown({ state }) { return h('p', null, state.expired ? 'done' : 'waiting') }
  Countdown.initialState = { armed: false, expired: 0, data: null }
  Countdown.timers = (state) => ({ done: state.armed && { after: 5000, action: 'EXPIRE' } })
  Countdown.model = {
    ARM: (state) => ({ ...state, armed: true }),
    DISARM: (state) => ({ ...state, armed: false }),
    EXPIRE: (state, data) => ({ ...state, expired: state.expired + 1, data }),
  }

  it('fires once after the delay, with { t }; not again while the same spec stays declared', async () => {
    vi.useFakeTimers()
    t = renderComponent(Countdown)
    await t.ready()
    await act('ARM')
    const t0 = Date.now()
    expect(t.timers()).toEqual([{ name: 'done', after: 5000, action: 'EXPIRE', component: 'Countdown' }])
    await vi.advanceTimersByTimeAsync(4999)
    expect(t.state.expired).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(t.state.expired).toBe(1)
    expect(t.state.data).toEqual({ t: t0 + 5000 })
    expect(t.timers()).toEqual([])       // fired: no longer active
    await vi.advanceTimersByTimeAsync(20_000)
    expect(t.state.expired).toBe(1)
    expect(t.html()).toBe('<p>done</p>')
  })

  it('disarmed before it fires: it never fires', async () => {
    vi.useFakeTimers()
    t = renderComponent(Countdown)
    await t.ready()
    await act('ARM')
    await vi.advanceTimersByTimeAsync(3000)
    await act('DISARM')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(t.state.expired).toBe(0)
  })
})

describe('frame', () => {
  it('fires every frame with { t, dt } (setTimeout 16 ms without requestAnimationFrame)', async () => {
    vi.useFakeTimers()
    expect(globalThis.requestAnimationFrame).toBeUndefined()
    function Spinner() { return h('p', null, 'x') }
    Spinner.initialState = { animating: true, frames: [] }
    Spinner.timers = (state) => ({ frame: state.animating && { frame: 'FRAME' } })
    Spinner.model = {
      FRAME: (state, f) => (state.frames.length === 4 ? { ...state, animating: false, frames: [...state.frames, f] } : { ...state, frames: [...state.frames, f] }),
    }
    t = renderComponent(Spinner)
    await t.ready()
    expect(t.timers()).toEqual([{ name: 'frame', frame: 'FRAME', action: 'FRAME', component: 'Spinner' }])
    await vi.advanceTimersByTimeAsync(1000)
    const f = t.state.frames
    expect(f).toHaveLength(5)
    expect(f.map(x => x.dt)).toEqual([0, 16, 16, 16, 16])
    expect(f[1].t - f[0].t).toBe(16)
    expect(t.timers()).toEqual([])
  })

  it('uses requestAnimationFrame when there is one', async () => {
    const queue = new Map()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (f) => { queue.set(++id, f); return id })
    vi.stubGlobal('cancelAnimationFrame', (i) => { queue.delete(i) })
    const flush = (ts) => { const fs = [...queue.values()]; queue.clear(); fs.forEach(f => f(ts)) }
    function Spinner() { return h('p', null, 'x') }
    Spinner.initialState = { animating: true, frames: [] }
    Spinner.timers = (state) => ({ frame: state.animating && { frame: 'FRAME' } })
    Spinner.model = {
      FRAME: (state, f) => ({ ...state, frames: [...state.frames, f.dt] }),
      STOP: (state) => ({ ...state, animating: false }),
    }
    t = renderComponent(Spinner)
    await t.ready()
    expect(queue.size).toBe(1)
    flush(1000); flush(1016.5); flush(1050)
    await t.waitForState(s => s.frames.length === 3)
    expect(t.state.frames).toEqual([0, 16.5, 33.5])
    t.simulateAction('STOP')
    await t.waitForState(s => !s.animating)
    expect(queue.size).toBe(0)
  })
})

describe('hidden Switchable pages', () => {
  const page = (background) => {
    function Page() { return h('p', null, 'page') }
    Page.timers = (state) => ({ tick: { every: 100, action: 'TICK', ...(background ? { background } : {}) } })
    Page.model = { TICK: (state) => ({ ...state, ticks: state.ticks + 1 }) }
    return Page
  }
  const app = (background) => {
    const A = page(background)
    function Other() { return h('p', null, 'other') }
    function App({ state }) { return h('div', null, h(Switchable, { of: { a: A, b: Other }, current: state.page })) }
    App.initialState = { page: 'a', ticks: 0 }
    App.model = { GO: (state, page) => ({ ...state, page }) }
    return App
  }

  it('a hidden page’s timers stop, and start again when it is shown', async () => {
    vi.useFakeTimers()
    t = renderComponent(app(false))
    await t.ready()
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.state.ticks).toBe(10)
    expect(t.timers()).toEqual([{ name: 'tick', every: 100, action: 'TICK', component: 'Page' }])
    await act('GO', 'b', 20)
    expect(t.timers()).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.state.ticks).toBe(10)
    await act('GO', 'a', 20)
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.state.ticks).toBe(20)
  })

  it('background: true keeps it running while hidden', async () => {
    vi.useFakeTimers()
    t = renderComponent(app(true))
    await t.ready()
    await vi.advanceTimersByTimeAsync(1000)
    await act('GO', 'b', 20)
    expect(t.timers()).toEqual([{ name: 'tick', every: 100, action: 'TICK', background: true, component: 'Page' }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(t.state.ticks).toBe(20)
  })
})

describe('SSR', () => {
  it('renderToString starts no timer', () => {
    vi.useFakeTimers()
    const html = renderToString(Stopwatch, { state: { running: true, ticks: 0, seen: [] } })
    expect(html).toContain('<span class="ticks">0</span>')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the driver itself', () => {
  const declare = (sink$, id, timers, name = 'C') =>
    sink$.shamefullySendNext(Object.defineProperties({ timers }, { __emitterId: { value: id }, __emitterName: { value: name } }))

  it('every is drift-free: each delay is computed from the start, so lateness does not add up', async () => {
    vi.useFakeTimers()
    // every timer callback runs 7 ms late (a busy main thread)
    const real = globalThis.setTimeout
    vi.stubGlobal('setTimeout', (f, ms, ...a) => real(f, ms + 7, ...a))
    const sink$ = xs.create()
    const source = makeTimerDriver()(sink$)
    const got = []
    source.replies(1).addListener({ next: (a) => got.push(a) })
    const t0 = Date.now()
    declare(sink$, 1, { tick: { every: 100, action: 'TICK' } })
    await vi.advanceTimersByTimeAsync(100_000 + 7)
    expect(got).toHaveLength(1000)
    expect(got.at(-1)).toEqual({ type: 'TICK', data: { n: 1000, t: t0 + 100_000 + 7 } })
    source.dispose()
    vi.unstubAllGlobals()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a tick later than a whole interval coalesces the missed ones (n jumps)', async () => {
    vi.useFakeTimers()
    const sink$ = xs.create()
    const source = makeTimerDriver()(sink$)
    const got = []
    source.replies(1).addListener({ next: (a) => got.push(a.data.n) })
    declare(sink$, 1, { tick: { every: 100, action: 'TICK' } })
    await vi.advanceTimersByTimeAsync(100)
    vi.setSystemTime(Date.now() + 350)    // the clock jumps (a sleeping laptop)
    await vi.advanceTimersByTimeAsync(100)
    expect(got).toEqual([1, 5])
    source.dispose()
  })

  it('per sender and name: removing a name, a falsy entry and the sender stopping each stop it', async () => {
    vi.useFakeTimers()
    const sink$ = xs.create()
    const runners = new Map()
    const source = timerDriver(runners)(sink$)
    const a = [], b = []
    const subA = source.replies(1).subscribe({ next: (x) => a.push(x.type) })
    source.replies(2).addListener({ next: (x) => b.push(x.type) })
    declare(sink$, 1, { x: { every: 10, action: 'X' }, y: { every: 10, action: 'Y' } })
    declare(sink$, 2, { x: { every: 10, action: 'X' } })
    await vi.advanceTimersByTimeAsync(10)
    expect(a).toEqual(['X', 'Y'])
    expect(b).toEqual(['X'])
    declare(sink$, 1, { x: { every: 10, action: 'X' } })      // y removed
    await vi.advanceTimersByTimeAsync(10)
    expect(a).toEqual(['X', 'Y', 'X'])
    declare(sink$, 1, { x: false })                             // falsy
    await vi.advanceTimersByTimeAsync(10)
    expect(a).toEqual(['X', 'Y', 'X'])
    declare(sink$, 1, { x: { every: 10, action: 'X' } })
    subA.unsubscribe()                                           // sender 1 disposed
    await vi.advanceTimersByTimeAsync(0)
    expect(runners.has(1)).toBe(false)
    await vi.advanceTimersByTimeAsync(10)
    expect(b).toEqual(['X', 'X', 'X', 'X'])
    sink$.shamefullySendComplete()                               // app dispose
    expect(vi.getTimerCount()).toBe(0)
  })

  it('an invalid spec is not started (SYG422 is the dev entry’s)', async () => {
    vi.useFakeTimers()
    const sink$ = xs.create()
    const runners = new Map()
    const source = timerDriver(runners)(sink$)
    source.replies(1).addListener({ next: () => {} })
    declare(sink$, 1, { a: { every: 0, action: 'A' }, b: { after: 10 }, c: { frame: true }, d: { every: 10, after: 5, action: 'D' }, e: { every: 10, action: 'E' } })
    expect(vi.getTimerCount()).toBe(1)
    source.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('timers is a reserved static', () => {
  it('lazy() copies it from the loaded component', async () => {
    const L = lazy(() => Promise.resolve({ default: Stopwatch }))
    await L.__sygnalLazyPromise
    expect(L.timers).toBe(Stopwatch.timers)
  })
})
