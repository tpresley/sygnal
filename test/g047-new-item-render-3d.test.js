// 3D (G-047 recheck): after an item is added through simulateEvent, t.next / t.waitForState
// resolve only once the NEW Collection item (and its own nested Collection) has rendered,
// so t.html() already contains it and the next simulateEvent can target it.
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { useFreshDiagnostics } from './review-2e2/helpers.js'

useFreshDiagnostics()

function Item({ state }) {
  return h('li', { className: 'item', data: { itemId: state.id } },
    h('span', { className: 'label' }, state.label),
    h('button', { className: 'edit' }, 'edit'),
    state.editing ? h('input', { className: 'edit-input', value: state.label }) : null)
}
Item.intent = ({ DOM }) => ({ EDIT: DOM.click('.edit') })
Item.model = { EDIT: s => ({ ...s, editing: true }) }

function Group({ state }) {
  return h('section', { className: 'group', data: { groupId: state.id } },
    h('h2', null, state.title),
    h('div', { className: 'items' }, h(Collection, { of: Item, from: 'items' })),
    h('button', { className: 'add-item' }, '+'))
}
Group.intent = ({ DOM }) => ({ ADD_ITEM: DOM.click('.add-item') })
Group.model = {
  ADD_ITEM: s => ({ ...s, items: [...s.items, { id: `${s.id}-${s.items.length + 1}`, label: `item ${s.items.length + 1}`, editing: false }] }),
}

function Board({ state }) {
  return h('main', null,
    h('button', { className: 'add-group' }, 'add'),
    h(Collection, { of: Group, from: 'groups' }))
}
Board.initialState = { groups: [{ id: 'g1', title: 'one', items: [] }] }
Board.intent = ({ DOM }) => ({ ADD_GROUP: DOM.click('.add-group') })
Board.model = {
  ADD_GROUP: s => {
    const id = `g${s.groups.length + 1}`
    return { ...s, groups: [...s.groups, { id, title: id, items: [{ id: `${id}-1`, label: 'first', editing: false }] }] }
  },
}

describe('G-047 recheck: new Collection items have rendered when next()/waitForState resolve', () => {
  it('a new item added via simulateEvent is in html() right after t.next', async () => {
    const t = renderComponent(Board)
    await t.ready()
    for (let n = 1; n <= 8; n++) {
      t.simulateEvent('.add-item', 'click')
      await t.next(s => s.groups[0].items.length === n)
      expect(t.html()).toContain(`<li class="item" data-item-id="g1-${n}"><span class="label">item ${n}</span>`)
    }
    t.dispose()
  })

  it('a new nested Collection (group with an item) has rendered after t.next / t.waitForState', async () => {
    const t = renderComponent(Board)
    await t.ready()
    for (let n = 2; n <= 6; n++) {
      t.simulateEvent('.add-group', 'click')
      const s = n % 2 ? await t.next(s => s.groups.length === n) : await t.waitForState(s => s.groups.length === n)
      expect(s.groups.length).toBe(n)
      expect(t.html()).toContain(`data-group-id="g${n}"`)
      expect(t.html()).toContain(`<li class="item" data-item-id="g${n}-1"><span class="label">first</span>`)
      // and the new grandchild is live: an event for it reaches its intent
      t.simulateEvent(`.group[data-group-id="g${n}"] .item[data-item-id="g${n}-1"] .edit`, 'click')
      await t.next(s => s.groups[n - 1].items[0].editing)
      expect(t.html()).toContain(`<input class="edit-input" value="first">`)
    }
    t.expectNoDiagnostics()
    t.dispose()
  })
})
