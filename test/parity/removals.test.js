// @vitest-environment jsdom
// PLAN-4.6 parity: the D162-D164 API changes, where they are observable through the public API.
// The canonical forms keep working on both cores; the removed forms are covered by the migration
// guide (dev-plans/research/core-rewrite/05-migration-guide-draft.md), not pinned here, except
// for the public entry's shape and the view's single argument.
import { it, expect } from 'vitest'
import { parity, itNext, needs, mount, h, click, until, api, Collection } from './harness.js'

parity('parity: D162-D164 (public API shape)', () => {
  needs('R2').it('canonical forms: destructured view, object model with STATE/EFFECT, CHILD.select(Fn), Collection of={Fn}', async () => {
    const got = []
    function Item({ state }) { return h('li', { className: 'it' }, h('button', { className: 'up' }, state.t)) }
    Item.intent = ({ DOM }) => ({ UP: DOM.click('.up') })
    Item.model = { UP: { PARENT: (s) => s.t } }
    function P({ state, context, ...props }) { return h('div', null, h('b', { className: 'last' }, state.last), h('ul', null, h(Collection, { of: Item, from: 'items' }))) }
    P.initialState = { last: '-', items: [{ id: 1, t: 'x' }, { id: 2, t: 'y' }] }
    P.intent = ({ CHILD }) => ({ PICK: CHILD.select(Item) })
    P.model = { PICK: { STATE: (s, t) => ({ ...s, last: t }), EFFECT: (s, t) => got.push(t) } }
    const m = mount(P)
    await until(() => expect(m.$$('.up').length).toBe(2))
    click(m.$$('.up')[1])
    await until(() => expect(m.text('.last')).toBe('y'))
    expect(got).toEqual(['y'])
  })

  itNext('D164 positional view args dropped', 'a view is called with exactly one argument', async () => {
    let n
    function C() { n = arguments.length; return h('p', { className: 'c' }, 'c') }
    C.initialState = {}
    const m = mount(C)
    await until(() => expect(m.$('.c')).toBeTruthy())
    expect(n).toBe(1)
  })

  needs('R5').itNext('D162 component({...}) factory removed', "the public entry no longer exports the options factory `component`", () => {
    expect('component' in api).toBe(false)
  })

  needs('R5').itNext('D162 defineComponent(opts) added', 'defineComponent(opts) returns an ordinary function component', async () => {
    expect(typeof api.defineComponent).toBe('function')
    const C = api.defineComponent({
      name: 'Counter',
      view: ({ state }) => h('button', { className: 'b' }, String(state.n)),
      initialState: { n: 0 },
      intent: ({ DOM }) => ({ INC: DOM.click('.b') }),
      model: { INC: (s) => ({ ...s, n: s.n + 1 }) },
    })
    expect(typeof C).toBe('function')
    expect(C.initialState).toEqual({ n: 0 })
    const m = mount(C)
    await until(() => expect(m.text('.b')).toBe('0'))
    click(m.$('.b'))
    await until(() => expect(m.text('.b')).toBe('1'))
  })
})
