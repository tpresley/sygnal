// @vitest-environment jsdom
// Sift (Phase C): a component whose view returns its trigger as a bare element when closed and
// `<>{trigger}{confirm}</>` when open replaced the trigger on every switch (the element root and the
// fragment's first child had different keys), so the focus fell to <body>. A keyed fragment's
// first child with no key of its own now takes the key the fragment would have as one element (as
// React keeps X across `<X/>` ↔ `<><X/>…</>`).
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { Collection } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.ts'
import { Fragment } from '../src/cycle/dom/fragment.ts'

function Confirm({ state }) {
  const trigger = h('button', { className: 'trigger' }, 'Resume')
  return state.open ? h(Fragment, null, trigger, h('div', { className: 'confirm' }, 'Sure?')) : trigger
}
Confirm.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.trigger') })
Confirm.model = { TOGGLE: s => ({ ...s, open: !s.open }) }

const Alone = Object.assign((p) => Confirm(p), Confirm, { initialState: { open: false } })
function Parent() { return h('main', null, h('p', null, 'before'), h(Isolated)) }
const Isolated = Object.assign((p) => Confirm(p), Confirm, { initialState: { open: false }, isolatedState: true })
function List() { return h('ul', null, h(Collection, { of: Confirm, from: 'items' })) }
List.initialState = { items: [{ id: 'a', open: false }, { id: 'b', open: true }] }

async function flips(C, sel = '.trigger') {
  const t = renderComponent(C, { dom: 'real' })
  await t.ready()
  const first = t.query(sel)
  first.focus()
  const kept = []
  for (let i = 0; i < 4; i++) {
    await t.simulateEvent(sel, 'click')
    await t.settle()
    kept.push(t.query(sel) === first && document.activeElement === first)
  }
  t.dispose()
  return kept
}

describe('a component root that turns from an element into a fragment and back', () => {
  it('keeps the element and its focus: the app root', async () => {
    expect(await flips(Alone)).toEqual([true, true, true, true])
  })

  it('keeps the element and its focus: a child component', async () => {
    expect(await flips(Parent)).toEqual([true, true, true, true])
  })

  it('keeps the element and its focus: Collection items (keys under a prefix)', async () => {
    const t = renderComponent(List, { dom: 'real' })
    await t.ready()
    const [a, b] = t.queryAll('.trigger')
    for (let i = 0; i < 3; i++) {
      await t.simulateEvent('.trigger', 'click')
      await t.settle()
      const [a2, b2] = t.queryAll('.trigger')
      expect([a2 === a, b2 === b]).toEqual([true, true])
    }
    expect(t.queryAll('.confirm').length).toBe(2)
    t.dispose()
  })
})
