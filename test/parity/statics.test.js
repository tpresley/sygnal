// @vitest-environment jsdom
// PLAN-4.6 parity: the generic statics path with the real makeTimerDriver (spike 0-S §5, from
// p4-3c-timers-run), ported to the public API.
import { it, expect, vi } from 'vitest'
import { parity, mount, forget, h, click, Collection, Switchable, makeTimerDriver } from './harness.js'

parity('parity: generic statics (timers)', () => {
  function Clock({ state }) { return h('p', { className: 'n' }, String(state.n)) }
  Clock.initialState = { running: true, n: 0 }
  Clock.timers = (state) => ({ tick: state.running && { every: 1000, action: 'TICK' } })
  Clock.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.n') })
  Clock.model = { TICK: (state, { n }) => ({ ...state, n }), TOGGLE: (s) => ({ ...s, running: !s.running }) }

  it('ticks into the view; falsy stops; a new spec restarts from scratch; app dispose leaves no timer', async () => {
    vi.useFakeTimers()
    const m = mount(Clock, { CLOCK: makeTimerDriver() })
    await vi.advanceTimersByTimeAsync(3050)
    expect(m.text('.n')).toBe('3')
    click(m.$('.n'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(m.text('.n')).toBe('3')
    click(m.$('.n'))
    await vi.advanceTimersByTimeAsync(1010)
    expect(m.text('.n')).toBe('1')
    m.app.dispose()
    forget(m.app)
    await vi.advanceTimersByTimeAsync(200)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("Collection items each run their own timer; a removed item's timer stops", async () => {
    vi.useFakeTimers()
    function T({ state }) { return h('li', { className: 't' }, `${state.id}:${state.n || 0}`) }
    T.timers = (s) => ({ t: { every: s.ms, action: 'TICK' } })
    T.model = { TICK: (s, { n }) => ({ ...s, n }) }
    function L() { return h('ul', null, h('button', { className: 'drop' }), h(Collection, { of: T, from: 'items' })) }
    L.initialState = { items: [{ id: 1, ms: 100 }, { id: 2, ms: 300 }] }
    L.intent = ({ DOM }) => ({ DROP: DOM.click('.drop') })
    L.model = { DROP: (s) => ({ ...s, items: s.items.slice(1) }) }
    const m = mount(L, { TIMER: makeTimerDriver() })
    await vi.advanceTimersByTimeAsync(610)
    expect(m.$$('.t').map((e) => e.textContent)).toEqual(['1:6', '2:2'])
    click(m.$('.drop'))
    await vi.advanceTimersByTimeAsync(400)
    expect(m.$$('.t').map((e) => e.textContent)).toEqual(['2:3'])
    expect(m.state().items).toEqual([{ id: 2, ms: 300, n: 3 }])
  })

  it('a hidden Switchable page keeps only its background: true timers; shown again, the others restart', async () => {
    vi.useFakeTimers()
    function Page({ state }) { return h('p', { className: 'pg' }, `${state.fg}/${state.bg}`) }
    Page.timers = () => ({ fg: { every: 100, action: 'FG' }, bg: { every: 100, action: 'BG', background: true } })
    Page.model = { FG: (s) => ({ ...s, fg: s.fg + 1 }), BG: (s) => ({ ...s, bg: s.bg + 1 }) }
    function Other() { return h('p', { className: 'other' }, 'o') }
    function T({ state }) { return h('div', null, h('button', { className: 'flip' }), h(Switchable, { of: { pg: Page, o: Other }, current: state.page })) }
    T.initialState = { page: 'pg', fg: 0, bg: 0 }
    T.intent = ({ DOM }) => ({ FLIP: DOM.click('.flip') })
    T.model = { FLIP: (s) => ({ ...s, page: s.page == 'pg' ? 'o' : 'pg' }) }
    const m = mount(T, { TIMER: makeTimerDriver() })
    await vi.advanceTimersByTimeAsync(310)
    expect(m.text('.pg')).toBe('3/3')
    click(m.$('.flip'))
    await vi.advanceTimersByTimeAsync(500)
    expect(m.state()).toMatchObject({ fg: 3, bg: 8 })
    click(m.$('.flip'))
    await vi.advanceTimersByTimeAsync(210)
    expect(m.text('.pg')).toBe('5/10')
  })
}, 'R3')
