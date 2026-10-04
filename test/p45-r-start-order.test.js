// @vitest-environment jsdom
// P45-R G-266/G-270/G-272: a component's start timers (P45-D: shared by the components created
// together, one per delay).
// - G-266: a component created after the app's 0 ms timer fired, while its 1 ms timer was
//   pending, joined that timer: its intent (and BOOTSTRAP) started before its own INITIALIZE. The
//   intent now always waits for the component's own INITIALIZE.
// - G-270: a shared timer that never fires (vi.clearAllTimers(), a fake/real timer swap) kept its
//   slot, so no later component with that delay ever started. A slot is shared only within the
//   microtask that made it.
// - G-272: INITIALIZE is scheduled once while one is pending (a stop + restart of the action
//   stream before it fires sent it twice).
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { run, Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeScheduler } from '../src/cycle/run/scheduler.ts'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })

let apps = []
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; vi.useRealTimers() })

function mount(App) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  apps.push(run(App, {}, { mountPoint: '#root' }))
  return { $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] }
}

describe('P45-R G-266: a component starts its intent after its own INITIALIZE', () => {
  it('a child created in the root\'s first render: an intent that emits at once reduces the initial state', async () => {
    const seen = []
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 1 }
    Child.intent = () => ({ INC: xs.of(1) })
    Child.model = { INC: (s) => { seen.push(s.n); return { ...s, n: s.n + 1 } } }
    function Root() { return h('div', null, h(Child)) }
    Root.initialState = { x: 0 }
    Root.model = { NOP: (s) => s }
    const m = mount(Root)
    await sleep(60)
    expect(seen).toEqual([1])
    expect(m.$('.c').textContent).toBe('2')
  })

  it('BOOTSTRAP in a child created in the root\'s first render sees the initial state', async () => {
    const seen = []
    function Child({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    Child.isolatedState = true
    Child.initialState = { n: 1 }
    Child.model = { BOOTSTRAP: (s) => { seen.push(s?.n); return { ...s, n: s.n * 10 } } }
    function Root() { return h('div', null, h(Child)) }
    Root.initialState = { x: 0 }
    Root.model = { BOOTSTRAP: (s) => s }
    const m = mount(Root)
    await sleep(80)
    expect(seen).toEqual([1])
    expect(m.$('.c').textContent).toBe('10')
  })

  it('a timer slot is shared only by components created in the same microtask', async () => {
    const s = makeScheduler(), spy = vi.spyOn(globalThis, 'setTimeout'), order = []
    s.t(1, () => order.push('a'))
    s.t(1, () => order.push('b'))
    expect(spy.mock.calls.length).toBe(1)
    await Promise.resolve()
    s.t(1, () => order.push('c'))
    expect(spy.mock.calls.length).toBe(2)
    spy.mockRestore()
    await sleep(20)
    expect(order).toEqual(['a', 'b', 'c'])
  })
})

describe('P45-R G-270: a start timer that never fires', () => {
  it('does not stop later components from starting', async () => {
    vi.useFakeTimers()
    const s = makeScheduler(), ran = []
    s.t(1, () => ran.push('lost'))
    // the pending start timer is lost (a test clearing its timers, say)
    vi.clearAllTimers()
    await Promise.resolve()
    s.t(1, () => ran.push('later'))
    await vi.advanceTimersByTimeAsync(10)
    expect(ran).toEqual(['later'])
  })

  it('a pending gate whose timer never fires holds the patch for 50 ms at most', async () => {
    vi.useFakeTimers()
    const s = makeScheduler(), out = []
    s.t(1, () => {}, 1)
    vi.clearAllTimers()
    s(2e6, () => out.push('patch'))
    await vi.advanceTimersByTimeAsync(0)
    expect(out).toEqual([])
    await vi.advanceTimersByTimeAsync(60)
    s(1, () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(out).toEqual(['patch'])
  })
})
