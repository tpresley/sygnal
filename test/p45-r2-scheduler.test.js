// @vitest-environment jsdom
// P45-R2 G-273 / G-274: the render scheduler recovers from a timer of its own that never fires
// (vi.clearAllTimers(), a switch from fake to real timers).
// - G-273: a first-render gate whose timer is lost kept `g > 0`: every later patch was held, and
//   the 50 ms bound was only checked inside a flush, so a held patch waited for the next change.
// - G-274: the flush counter was reset only by a timer set at the 9th flush: if it was lost,
//   every later flush went through setTimeout; a lost capped-flush timer stopped flushing for good.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { makeScheduler, B } from '../src/cycle/run/scheduler.ts'
import { run, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const real = globalThis.setTimeout
const sleep = (ms) => new Promise(r => real(r, ms))
const microtasks = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
afterEach(() => { globalThis.setTimeout = real; vi.useRealTimers(); document.body.innerHTML = '' })

describe('P45-R2 G-273: a lost first-render gate', () => {
  it('holds a patch at most ~50 ms, on its own timer, and no later patch', async () => {
    const s = makeScheduler()
    globalThis.setTimeout = () => 0 // the gate's timer is lost
    s.t(1, () => {}, 1)
    globalThis.setTimeout = real
    let patches = 0
    s(2 * B, () => patches++)
    await microtasks()
    expect(patches).toBe(0) // held while the gate is pending
    await sleep(120) // nothing else happens: the hold's own timer flushes
    expect(patches).toBe(1)
    s(2 * B, () => patches++)
    await microtasks()
    expect(patches).toBe(2) // the lost gate no longer holds anything
  })

  it('a gate that fires late, after the hold ended, is ignored', async () => {
    const s = makeScheduler()
    let fire
    globalThis.setTimeout = (f) => { fire = f; return 0 }
    s.t(1, () => {}, 1)
    globalThis.setTimeout = real
    let patches = 0
    s(2 * B, () => patches++)
    await sleep(120)
    fire() // the late gate
    s.t(1, () => {}, 1) // a new gate: its patch is held again until it fires
    s(2 * B, () => patches++)
    await microtasks()
    expect(patches).toBe(1)
    await until(() => expect(patches).toBe(2))
  })

  it('an app: the timers a new item set are cleared; later changes still patch', async () => {
    function Item({ state }) { return h('li', { className: 'item' }, state.id) }
    Item.intent = ({ DOM }) => ({ X: DOM.click('.item') })
    Item.model = { X: (s) => s }
    function App({ state }) { return h('div', null, h('button', { className: 'b' }, String(state.n)), h('ul', null, h(Collection, { of: Item, from: 'items' }))) }
    App.initialState = { n: 0, items: [] }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    App.model = { INC: (s) => ({ n: s.n + 1, items: s.n ? s.items : [{ id: 'a' }] }) }
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(App, {}, { mountPoint: '#root' })
    try {
      const $ = (q) => document.querySelector(q)
      await until(() => expect($('.b')).toBeTruthy())
      await sleep(20)
      vi.useFakeTimers()
      $('.b').dispatchEvent(new MouseEvent('click', { bubbles: true })) // creates an Item (a gate)
      await microtasks()
      vi.clearAllTimers()
      vi.useRealTimers()
      $('.b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await until(() => expect($('.b').textContent).toBe('2'))
      await sleep(20)
      $('.b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await microtasks()
      expect($('.b').textContent).toBe('3') // in microtasks: no hold left
    } finally { app.dispose() }
  })
})

describe('P45-R2 G-274: the render-loop guard', () => {
  it('a lost counter-reset timer: flushes in separate macrotasks stay microtask flushes', async () => {
    let drop = 0, timers = 0
    globalThis.setTimeout = (f, ms) => { if (drop) { drop = 0; return 0 } timers++; return real(f, ms) }
    const s = makeScheduler()
    const flushOnce = () => new Promise(r => s(1, r))
    for (let i = 0; i < 8; i++) await flushOnce()
    drop = 1 // the 9th flush's reset timer
    await flushOnce()
    await sleep(20)
    timers = 0
    for (let i = 0; i < 300; i++) { await flushOnce(); if (i % 50 == 0) await sleep(2) }
    // one reset timer per macrotask that had 9 flushes, one capped flush at most
    expect(timers).toBeLessThan(15)
  })

  it('a lost capped-flush timer: the next change flushes again', async () => {
    const s = makeScheduler()
    let ran = 0
    globalThis.setTimeout = () => 0 // every timer lost (fake timers never advanced, then cleared)
    for (let i = 0; i < 150; i++) { s(1, () => ran++); await microtasks() }
    globalThis.setTimeout = real
    expect(ran).toBe(99)
    s(1, () => ran++)
    await until(() => expect(ran).toBe(151))
  })
})
