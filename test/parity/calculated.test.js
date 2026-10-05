// @vitest-environment jsdom
// PLAN-4.6 parity: calculated fields (spike 0-S §1, ported to the public API).
import { it, expect, vi } from 'vitest'
import { parity, mount, h, click, dblclick, until, sleep } from './harness.js'

parity('parity: calculated fields', () => {
  it('fn and [deps, fn] in the view and reducers; topological order regardless of declaration order', async () => {
    const calls = { total: 0 }
    function C({ state }) { return h('p', { className: 'o' }, `${state.label}|${state.total}|${state.double}`) }
    C.initialState = { a: 1, b: 2, name: 'x' }
    // declared out of order: label depends on total (calculated) which depends on a, b
    C.calculated = {
      label: [['total', 'name'], (s) => `${s.name}=${s.total}`],
      total: [['a', 'b'], (s) => { calls.total++; return s.a + s.b }],
      double: (s) => s.total * 2,
    }
    C.intent = ({ DOM }) => ({ INC: DOM.click('.o'), RENAME: DOM.dblclick('.o') })
    let seen
    C.model = { INC: (s) => { seen = s.total; return { ...s, a: s.a + 1 } }, RENAME: (s) => ({ ...s, name: s.name + 'y' }) }
    const m = mount(C)
    await until(() => expect(m.text('.o')).toBe('x=3|3|6'))
    click(m.$('.o'))
    await until(() => expect(m.text('.o')).toBe('x=4|4|8'))
    expect(seen).toBe(3) // reducers get the calculated fields of the state before the action
    const before = calls.total
    dblclick(m.$('.o'))
    await until(() => expect(m.text('.o')).toBe('xy=4|4|8'))
    expect(calls.total).toBe(before) // memoized on its deps: name changed, a and b did not
    // stored in state (storeCalculatedInState's default, the only behaviour after D164)
    expect(m.state()).toMatchObject({ a: 2, total: 4, double: 8, label: 'xy=4' })
  })

  it('SYG209: a calculated cycle is an error naming the cycle path; SYG206: an invalid entry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Bad() { return h('div') }
    Bad.calculated = { a: [['b'], (s) => s.b], b: [['c'], (s) => s.c], c: [['a'], (s) => s.a], ok: (s) => 1 }
    Bad.initialState = {}
    expect(() => mount(Bad)).toThrow(/SYG209[\s\S]*(a → b → c → a|b → c → a → b|c → a → b → c)/)
    function Bad2() { return h('div') }
    Bad2.calculated = { x: 1 }
    Bad2.initialState = {}
    expect(() => mount(Bad2)).toThrow(/SYG206[\s\S]*'x'/)
  })

  it("a child sees its parent's calculated fields; a child bound to a calculated field can't write it (SYG409)", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    function Kid({ state }) { return h('i', { className: 'k' }, String(state)) }
    Kid.intent = ({ DOM }) => ({ W: DOM.click('.k') })
    Kid.model = { W: () => 99 }
    function Whole({ state }) { return h('b', { className: 'w' }, String(state.sum)) }
    function P() { return h('div', null, h(Whole), h(Kid, { state: 'sum' })) }
    P.initialState = { a: 2, b: 3 }
    P.calculated = { sum: [['a', 'b'], (s) => s.a + s.b] }
    const m = mount(P)
    await until(() => expect(m.text('.w') + m.text('.k')).toBe('55'))
    click(m.$('.k'))
    await sleep(20)
    expect(m.text('.k')).toBe('5')
    expect(warn.mock.calls.some((c) => String(c[0]).includes('SYG409'))).toBe(true)
  })
})
