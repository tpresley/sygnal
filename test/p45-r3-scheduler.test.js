// @vitest-environment jsdom
// P45-R3: the render scheduler's guards (review of P45-R2).
// - G-283: once the flush cap (G-260) was hit, every go() armed its own capped-flush timer, each
//   resetting the count: a runaway loop that dirties several stages per step grew the pending
//   timers by ~K-1 per macrotask (100k+ timers in 200 ms) and kept running after it stopped.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { makeScheduler, B } from '../src/cycle/run/scheduler.ts'

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
