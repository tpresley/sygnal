// @vitest-environment jsdom
// PLAN-4.6 parity: the §5 timing rules. What both cores guarantee, and the D165 changes
// (synchronous reducers, INITIALIZE at construction, BOOTSTRAP a microtask after the first render).
import { it, expect } from 'vitest'
import { parity, itNext, mount, h, click, until, sleep, microtasks, xs } from './harness.js'

function Counter({ state }) { return h('button', { className: 'b' }, String(state.n)) }
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

parity('parity: timing rules both cores keep', () => {
  it('every non-STATE sink of an action sees the state from before the action', async () => {
    const seen = []
    function C({ state }) { return h('button', { className: 'b' }, String(state.n)) }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    C.model = {
      INC: {
        EFFECT: (s) => { seen.push(['EFFECT', s.n]) },
        STATE: (s) => ({ ...s, n: s.n + 1 }),
        EVENTS: (s) => { seen.push(['EVENTS', s.n]); return { type: 'X', data: s.n } },
        LOG: (s) => { seen.push(['LOG', s.n]); return 'n' },
      },
    }
    const m = mount(C, { LOG: (s$) => { s$.addListener({ next: () => {} }) } })
    await until(() => expect(m.text('.b')).toBe('0'))
    click(m.$('.b'))
    await until(() => expect(m.text('.b')).toBe('1'))
    click(m.$('.b'))
    await until(() => expect(m.text('.b')).toBe('2'))
    expect(seen.filter((x) => x[0] == 'EFFECT').map((x) => x[1])).toEqual([0, 1])
    expect(seen.filter((x) => x[0] == 'EVENTS').map((x) => x[1])).toEqual([0, 1])
    expect(seen.filter((x) => x[0] == 'LOG').map((x) => x[1])).toEqual([0, 1])
  })

  it('a batch of synchronous actions is applied in order and rendered in one patch', async () => {
    const m = mount(Counter)
    await until(() => expect(m.text('.b')).toBe('0'))
    await sleep(20)
    const before = m.patches()
    for (let i = 0; i < 5; i++) click(m.$('.b'))
    await until(() => expect(m.text('.b')).toBe('5'))
    await sleep(20)
    expect(m.patches() - before).toBe(1)
    expect(m.states.map((s) => s.n).slice(-5)).toEqual([1, 2, 3, 4, 5])
  })

  it('STATE.stream drops repeats by identity; STATE.watch compares deeply (D170 / Q22)', async () => {
    const stream = [], watch = []
    function C({ state }) { return h('button', { className: 'b' }, String(state.k.v)) }
    C.initialState = { k: { v: 1 }, n: 0 }
    C.intent = ({ DOM, STATE }) => {
      STATE.stream.map((s) => s.k).addListener({ next: (k) => stream.push(k) })
      STATE.watch((s) => s.k).addListener({ next: (k) => watch.push(k) })
      return { SAME: DOM.click('.b') }
    }
    C.model = { SAME: (s) => ({ ...s, k: { v: 1 }, n: s.n + 1 }) } // a new object, deep-equal
    const m = mount(C)
    await until(() => expect(m.text('.b')).toBe('1'))
    await sleep(20)
    const [s0, w0] = [stream.length, watch.length]
    click(m.$('.b'))
    await until(() => expect(m.state().n).toBe(1))
    await sleep(20)
    expect(stream.length - s0).toBe(1) // a new root state: the stream emits
    expect(watch.length - w0).toBe(0) // deep-equal slice: watch does not
  })

  it('a model next(type, data, ms) runs after the delay, not before', async () => {
    const at = []
    function C({ state }) { return h('p', { className: 'p' }, String(state.n)) }
    C.initialState = { n: 0 }
    C.intent = () => ({ GO: xs.of(1) })
    C.model = { GO: { EFFECT: (s, d, next) => { at.push(['go', Date.now()]); next('LATER', 7, 40) } }, LATER: (s, v) => ({ ...s, n: v }) }
    const m = mount(C)
    await until(() => expect(m.text('.p')).toBe('7'), 3000)
    expect(m.text('.p')).toBe('7')
    expect(at.length).toBe(1)
  })
})

parity('parity: D165 timing changes (new behaviour)', () => {
  itNext('D165 synchronous reducers', 'a STATE reducer is applied when its action is processed: STATE.stream listeners see it synchronously', async () => {
    const m = mount(Counter)
    await until(() => expect(m.text('.b')).toBe('0'))
    click(m.$('.b'))
    expect(m.state().n).toBe(1) // no microtask awaited
  })

  itNext('D165 INITIALIZE at construction', 'the initial state is on STATE.stream when run() returns', () => {
    const m = mount(Counter)
    expect(m.state()).toEqual({ n: 0 })
  })

  itNext('D165 INITIALIZE at construction', "a model INITIALIZE entry has run when run() returns", () => {
    function C({ state }) { return h('p', null, String(state.n)) }
    C.initialState = { n: 1 }
    C.model = { INITIALIZE: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(C)
    expect(m.state()).toEqual({ n: 2 })
  })

  itNext('D165 BOOTSTRAP a microtask after the first render', 'BOOTSTRAP is dispatched within microtasks of the first patch (no 10 ms timer)', async () => {
    const seen = []
    function C({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    C.initialState = { n: 1 }
    C.model = { BOOTSTRAP: { EFFECT: () => seen.push(1) } }
    const m = mount(C)
    await until(() => expect(m.text('.c')).toBe('1'), 500)
    await microtasks(20)
    expect(seen).toEqual([1])
  })

  it("an intent's synchronous emission (xs.of) is applied before the first patch (both cores)", async () => {
    function C({ state }) { return h('p', { className: 'c' }, String(state.n)) }
    C.initialState = { n: 0 }
    C.intent = () => ({ SET: xs.of(5) })
    C.model = { SET: (s, v) => ({ ...s, n: v }) }
    const m = mount(C)
    await until(() => expect(m.text('.c')).toBe('5'))
    await sleep(20)
    expect(m.patches()).toBe(1)
  })
})
