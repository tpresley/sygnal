// PLAN-2 E11: renderComponent under vi.useFakeTimers(). The harness's waits (ready, next,
// waitForState, settle) drive the fake clock, so debounce/delay/next() tests run on virtual time.
import { describe, it, expect, afterEach, vi } from 'vitest'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { debounce, throttle, delay } from '../src/extra/xstreamExtras.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import xs from 'xstream'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  vi.useRealTimers()
  _resetDiagnostics()
})

const clock = () => setTimeout.clock
const realNow = () => vi.getRealSystemTime()

function Search({ state }) {
  return h('div', null, h('input', { className: 'q', value: state.query }), h('p', { className: 'sent' }, state.sent.join(',')))
}
Search.initialState = { query: '', sent: [] }
Search.intent = ({ DOM }) => {
  const q$ = DOM.input('.q').value()
  return { TYPE: q$, SEND: q$.compose(debounce(300)) }
}
Search.model = {
  TYPE: (s, query) => ({ ...s, query }),
  SEND: (s, q) => ({ ...s, sent: [...s.sent, q] }),
}

describe('E11: renderComponent with vi.useFakeTimers()', () => {
  it('ready(), next(), waitForState() and settle() resolve without the test advancing the clock', async () => {
    vi.useFakeTimers()
    const started = realNow()
    t = renderComponent(Search)
    await t.ready()
    t.simulateEvent('.q', 'input', { value: 'du' })
    await t.next(s => s.sent.length === 1)
    expect(t.html()).toContain('<p class="sent">du</p>')
    await t.waitForState(s => s.query === 'du')
    await t.settle()
    // a 300ms debounce, but no real wait
    expect(realNow() - started).toBeLessThan(250)
  })

  it('a debounce fires exactly at its period, measured from the input after ready()', async () => {
    vi.useFakeTimers()
    t = renderComponent(Search)
    await t.ready()
    for (const v of ['d', 'du', 'dun', 'dune']) {
      t.simulateEvent('.q', 'input', { value: v })
      await vi.advanceTimersByTimeAsync(50)
    }
    await vi.advanceTimersByTimeAsync(249)
    expect(t.states.at(-1).sent).toEqual([])
    const before = clock().now
    await t.next(s => s.sent.length === 1)
    expect(t.states.at(-1).sent).toEqual(['dune'])
    // next() advanced the clock to the debounce (1ms) plus the render quiet window, no further
    expect(clock().now - before).toBeLessThan(40)
  })

  it('throttle, delay and xs.periodic run on the fake clock', async () => {
    vi.useFakeTimers()
    function T({ state }) { return h('p', null, String(state.n)) }
    T.initialState = { n: 0, late: false, ticks: 0 }
    T.intent = ({ DOM }) => ({
      HIT: DOM.click('.x').compose(throttle(100)),
      LATE: DOM.click('.x').compose(delay(500)),
      TICK: xs.periodic(1000).take(3),
    })
    T.model = {
      HIT: s => ({ ...s, n: s.n + 1 }),
      LATE: s => ({ ...s, late: true }),
      TICK: s => ({ ...s, ticks: s.ticks + 1 }),
    }
    function Wrap(props) { return h('div', null, h('button', { className: 'x' }, 'x'), T(props)) }
    Object.assign(Wrap, { initialState: T.initialState, intent: T.intent, model: T.model })
    t = renderComponent(Wrap)
    await t.ready()
    t.simulateEvent('.x', 'click')
    t.simulateEvent('.x', 'click')
    await t.next(s => s.n === 1)
    await t.next(s => s.late)
    expect(t.states.at(-1).n).toBe(1)
    await t.next(s => s.ticks === 3, 5000)
  })

  it("a model next('X', data, ms) delay runs on the fake clock", async () => {
    vi.useFakeTimers()
    function M({ state }) { return h('p', null, state.status) }
    M.initialState = { status: 'idle' }
    M.model = {
      START: (s, _, next) => { next('DONE', null, 5000); return { ...s, status: 'waiting' } },
      DONE: s => ({ ...s, status: 'done' }),
    }
    const started = realNow()
    t = renderComponent(M)
    t.simulateAction('START')
    await t.next(s => s.status === 'done', 6000) // the timeout is virtual too
    expect(t.html()).toContain('done')
    expect(realNow() - started).toBeLessThan(1000)
  })

  it('a wait that never matches times out on virtual time, quickly', async () => {
    vi.useFakeTimers()
    const started = realNow()
    t = renderComponent(Search)
    await expect(t.next(s => s.query === 'never', 3000)).rejects.toThrow(/next timed out after 3000ms/)
    expect(realNow() - started).toBeLessThan(1000)
  })

  it("works when Date isn't faked (toFake without Date)", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    t = renderComponent(Search)
    await t.ready()
    t.simulateEvent('.q', 'input', { value: 'x' })
    await vi.advanceTimersByTimeAsync(299)
    expect(t.states.at(-1).sent).toEqual([])
    await t.next(s => s.sent.length === 1)
    await t.settle()
    expect(t.html()).toContain('<p class="sent">x</p>')
  })

  it('child components mount, render and reach the parent on the fake clock', async () => {
    vi.useFakeTimers()
    function Item({ state }) { return h('li', null, h('button', { className: 'pick' }, state.label)) }
    Item.intent = ({ DOM }) => ({ PICK: DOM.click('.pick').compose(debounce(100)) })
    Item.model = { PICK: { PARENT: s => s.label } }
    function List({ state }) { return h('ul', null, h(Item, { state: 'item' })) }
    List.initialState = { item: { label: 'one' }, picked: null }
    List.intent = ({ CHILD }) => ({ PICKED: CHILD.select(Item) })
    List.model = { PICKED: (s, label) => ({ ...s, picked: label }) }
    t = renderComponent(List)
    t.simulateEvent('.pick', 'click')
    await t.next(s => s.picked === 'one')
    expect(t.html()).toContain('<button class="pick">one</button>')
  })

  it('waits started before the test advances the clock still resolve', async () => {
    vi.useFakeTimers()
    t = renderComponent(Search)
    t.simulateEvent('.q', 'input', { value: 'a' })
    const p = t.next(s => s.sent.length === 1)
    await vi.advanceTimersByTimeAsync(400)
    await p
    expect(t.states.at(-1).sent).toEqual(['a'])
  })
})
