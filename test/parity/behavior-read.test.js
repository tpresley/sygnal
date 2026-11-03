// @vitest-environment jsdom
// A behavior's read-time normalizer (the core's `read` hook; the wizard spike's Bug B, user-approved
// with a size-budget raise): a behavior's merge sets `c._read = { [key]: (value, state) => value }`,
// and the core applies it whenever the component's state is read (before calculated fields,
// memoized per state object), so a slice a parent seeded without the behavior's own fields gets
// them in the component's very first view call. Not wizard-specific: any behavior can use it.
import { it, expect } from 'vitest'
import { parity, mount, h, click, until } from './harness.js'

// a hand-written behavior: its slice always has `size` (the count of `items`)
const sized = {
  merge(c, k) {
    c._read = { ...c._read, [k]: (v, state) => v && typeof v == 'object' && v.size !== v.items.length ? { ...v, size: v.items.length, of: state.label } : v }
  },
}

parity('parity: a behavior read-time normalizer', () => {
  it("a parent-seeded slice is normalized in the child's first view call, and after every write", async () => {
    const views = []
    function Child({ state }) {
      views.push(state.list.size)
      return h('p', { className: 'c' }, `${state.list.size}:${state.list.of}`)
    }
    Child.uses = { list: sized }
    Child.intent = ({ DOM }) => ({ ADD: DOM.click('.c') })
    Child.model = { ADD: (s) => ({ ...s, list: { ...s.list, items: [...s.list.items, 'x'] } }) }
    function Root() { return h('main', null, h(Child, { state: 'page' })) }
    Root.initialState = { page: { label: 'L', list: { items: ['a', 'b'] } } }
    const m = mount(Root)
    await until(() => expect(m.text('.c')).toBe('2:L'))
    expect(views[0]).toBe(2)                     // the first view call already has it
    click(m.$('.c'))
    await until(() => expect(m.text('.c')).toBe('3:L'))
    expect(m.state().page.list).toEqual({ items: ['a', 'b', 'x'], size: 3, of: 'L' })   // stored as read
  })

  it('a component with no behavior using it reads its state as before (the same object)', async () => {
    function C({ state }) { return h('p', { className: 'o' }, state.n) }
    C.initialState = { n: 1 }
    const m = mount(C)
    await until(() => expect(m.text('.o')).toBe('1'))
    expect(m.state()).toEqual({ n: 1 })
  })
})
