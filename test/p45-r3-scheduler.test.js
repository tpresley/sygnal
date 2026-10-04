// @vitest-environment jsdom
// P45-R3: the render scheduler's guards (review of P45-R2).
// - G-283: once the flush cap (G-260) was hit, every go() armed its own capped-flush timer, each
//   resetting the count: a runaway loop that dirties several stages per step grew the pending
//   timers by ~K-1 per macrotask (100k+ timers in 200 ms) and kept running after it stopped.
// - G-284: with vi.useFakeTimers() and raw run(), the render-loop guard's count is reset by a
//   (fake) timer: after 100 renders the next waits for the clock. Documented (testing guide);
//   pinned here: advancing the clock now and then keeps a long run of input rendering.
// - G-286: a held patch (G-257) armed one 51 ms timer per held flush, not one per hold.
// - G-287: a gate that fires after its hold was dropped (the 50 ms bound) could consume the
//   count of a newer component's gate, so that component's patch wasn't held (two patches).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { makeScheduler, B } from '../src/cycle/run/scheduler.ts'
import { run } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const real = globalThis.setTimeout
const sleep = (ms) => new Promise(r => real(r, ms))
const microtasks = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
afterEach(() => {
  vi.useRealTimers()
  globalThis.setTimeout = real
})

describe('P45-R3 G-283: a runaway loop arms one capped flush at a time', () => {
  it('timers stay bounded by the flushes, and the loop drains once it stops', async () => {
    let timers = 0
    globalThis.setTimeout = (f, ms) => { timers++; return real(f, ms) }
    const s = makeScheduler()
    // 5 stages (deduped like batch()); each run dirties all 5 again in a later microtask
    let stop = false, runs = 0
    const dirty = [0, 0, 0, 0, 0, 0]
    const mk = (k) => () => {
      dirty[k] = 0
      runs++
      if (!stop) queueMicrotask(() => { for (let j = 1; j <= 5; j++) dirty[j]++ || s(j, mk(j)) })
    }
    for (let j = 1; j <= 5; j++) dirty[j]++ || s(j, mk(j))
    await sleep(200)
    stop = true
    const atStop = runs
    globalThis.setTimeout = real
    // a count reset and a capped flush per 100 flushes (5 stage runs each), plus a few
    expect(timers).toBeLessThan(runs / 200 + 10)
    await sleep(30)
    const drained = runs
    expect(drained - atStop).toBeLessThan(5000)
    await sleep(30)
    expect(runs).toBe(drained) // nothing left queued
  })

  it('a capped timer cleared with vi.clearAllTimers(): set again after 100 more changes', async () => {
    vi.useFakeTimers()
    const s = makeScheduler()
    let ran = 0
    for (let i = 0; i < 100; i++) { s(1, () => ran++); await microtasks(3) }
    expect(ran).toBe(99) // capped: the 100th waits for the timer
    vi.clearAllTimers()
    await vi.advanceTimersByTimeAsync(10)
    expect(ran).toBe(99) // its timer is gone
    for (let i = 0; i < 100; i++) s(1, () => ran++)
    await vi.advanceTimersByTimeAsync(10)
    expect(ran).toBe(200)
  })
})

describe('P45-R3 G-284: raw run() under fake timers (documented)', () => {
  it('more than 100 renders wait for the clock; advancing it now and then keeps them going', async () => {
    function App({ state }) { return h('button', { className: 'b' }, String(state.n)) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    App.model = { INC: (st) => ({ n: st.n + 1 }) }
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(App, {}, { mountPoint: '#root' })
    try {
      const $ = (q) => document.querySelector(q)
      const click = async () => { $('.b').dispatchEvent(new MouseEvent('click', { bubbles: true })); await microtasks() }
      await until(() => expect($('.b')).toBeTruthy())
      await sleep(20)
      vi.useFakeTimers()
      for (let i = 1; i <= 120; i++) await click()
      expect(Number($('.b').textContent)).toBeLessThan(120) // the guard waits for the clock
      await vi.advanceTimersByTimeAsync(0)
      expect($('.b').textContent).toBe('120')
      for (let i = 1; i <= 150; i++) {
        await click()
        if (i % 50 == 0) await vi.advanceTimersByTimeAsync(0)
      }
      expect($('.b').textContent).toBe('270')
    } finally { app.dispose(); document.body.innerHTML = '' }
  })
})

describe('P45-R3 G-286: one bound timer per hold', () => {
  it('a 30 ms hold with patches every ~1 ms arms one 51 ms timer', async () => {
    let bound = 0
    globalThis.setTimeout = (f, ms) => { if (ms == 51) bound++; return real(f, ms) }
    const s = makeScheduler()
    let patches = 0
    s.t(30, () => {}, 1)
    for (let i = 0; i < 25; i++) { s(2 * B, () => patches++); await sleep(1) }
    expect(bound).toBe(1)
    await until(() => expect(patches).toBeGreaterThan(0)) // released when the gate fires
  })

  it('a lost bound timer: the next flush past the bound releases the hold', async () => {
    const s = makeScheduler()
    globalThis.setTimeout = () => 0 // gate and bound timers lost
    s.t(1, () => {}, 1)
    let patches = 0
    s(2 * B, () => patches++)
    await microtasks()
    globalThis.setTimeout = real
    expect(patches).toBe(0)
    await sleep(60)
    s(2 * B, () => patches++)
    await microtasks()
    expect(patches).toBe(2)
  })
})

describe('P45-R3 G-287: a late gate from a dropped hold', () => {
  it("doesn't consume a newer component's gate", async () => {
    vi.useFakeTimers()
    const s = makeScheduler()
    // gate A (its timer will fire late: a throttled tab)
    let fireA
    const st = globalThis.setTimeout
    globalThis.setTimeout = (f, ms) => (ms == 1 && !fireA ? (fireA = f, 0) : st(f, ms))
    s.t(1, () => {}, 1)
    globalThis.setTimeout = st
    let patches = 0
    s(2 * B, () => patches++)
    await microtasks()
    expect(patches).toBe(0) // held by A
    await vi.advanceTimersByTimeAsync(60) // the bound passes: the hold (and A's count) dropped
    expect(patches).toBe(1)
    await microtasks() // the next microtask: a new timer for the next gate
    s.t(1, () => {}, 1) // gate B, pending
    fireA() // A fires late
    s(2 * B, () => patches++)
    await microtasks()
    expect(patches).toBe(1) // still held by B
    await vi.advanceTimersByTimeAsync(1) // B fires
    await microtasks()
    expect(patches).toBe(2)
  })
})
