// @vitest-environment jsdom
// PLAN-5 3-D (B-1): the `sortable` behavior. Mock DOM (keyboard flow, pointer logic with
// synthetic coordinates, two lists, DROPPED, Escape restore, focus commands) and jsdom real DOM
// (keyboard with focus restore, focus loss, nested sortables, text-selection guard).
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent, Collection, sortable } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function Task({ state, context }) {
  const { dragging, over, after, helpId } = context.sort
  const id = String(state.id)
  const cls = ['task', dragging === id && 'dragging', over === id && dragging !== id && (after ? 'drop-after' : 'drop-before')]
  return h('li', { className: cls.filter(Boolean).join(' '), 'data-id': state.id },
    h('button', { type: 'button', className: 'grip', 'aria-label': `Reorder ${state.title}`, 'aria-describedby': helpId || undefined, 'aria-pressed': String(dragging === id) }, '⠿'),
    h('span', { className: 'title' }, state.title))
}
function TaskList({ state }) {
  return h('section', { className: 'board' },
    h('p', { id: state.sort.helpId || undefined, className: 'help', hidden: true }, 'Press Space to pick up a task.'),
    h('ul', { className: 'tasks' }, h(Collection, { of: Task, from: 'tasks' })),
    h('p', { className: 'announce', role: 'status', 'aria-live': 'assertive' }, state.sort.message),
    h('p', { className: 'dropped' }, state.dropped.join(';')))
}
TaskList.initialState = {
  tasks: [{ id: 1, title: 'Write spec' }, { id: 2, title: 'Build prototype' }, { id: 3, title: 'Test it' }, { id: 4, title: 'Ship' }],
  dropped: [],
}
TaskList.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
TaskList.context = { sort: (state) => state.sort }
TaskList.model = { 'sort.DROPPED': (s, d) => ({ ...s, dropped: [...s.dropped, `${d.id}:${d.fromIndex}->${d.index}`] }) }
// the same list as a sub-component (its state from the parent)
const SubList = (props) => TaskList(props)
SubList.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
SubList.context = TaskList.context
SubList.model = TaskList.model

const order = (s, k = 'tasks') => s[k].map(x => x.id).join()
const key = (id, k) => t.simulateEvent('.grip', 'keydown', { key: k, within: `.task[data-id="${id}"]` })
// a pointer event's target in the mock DOM: closest(item) gives the item with this id
const over = (id) => ({ target: { closest: (s) => (s !== '[data-list]' ? { getAttribute: (a) => (a === 'data-id' ? String(id) : null) } : null) } })
const dropped = () => t.actions.filter(a => a.type === 'sort.DROPPED').map(a => a.data)

describe('sortable: keyboard (mock DOM)', () => {
  it('Space lifts, arrows move the item live, Enter drops; announcements; one DROPPED', async () => {
    t = renderComponent(TaskList, { strict: true }); await t.ready()
    key(2, ' ')
    await t.next(s => s.sort.dragging === '2')
    expect(t.state.sort).toMatchObject({ mode: 'keyboard', origin: { list: 'tasks', index: 1 } })
    expect(t.state.sort.message).toMatch(/^Picked up Build prototype, position 2 of 4\. Use the arrow keys/)
    key(2, 'ArrowDown')
    await t.next(s => order(s) === '1,3,2,4')
    expect(t.state.sort.message).toBe('Build prototype: position 3 of 4.')
    key(2, 'ArrowDown')
    await t.next(s => order(s) === '1,3,4,2')
    key(2, 'ArrowDown')                      // at the end: no change
    key(2, 'Enter')
    await t.next(s => s.sort.dragging === null)
    expect(order(t.state)).toBe('1,3,4,2')
    expect(t.state.sort.message).toBe('Dropped Build prototype at position 4 of 4.')
    await t.settle()
    expect(dropped()).toEqual([{ id: '2', list: 'tasks', index: 3, fromList: 'tasks', fromIndex: 1 }])
    expect(t.state.dropped).toEqual(['2:1->3'])
    t.expectNoDiagnostics()
  })

  it('Home / End move to the ends; Escape puts the item back where it started (no DROPPED)', async () => {
    t = renderComponent(TaskList); await t.ready()
    key(3, 'Enter'); await t.next(s => s.sort.dragging === '3')
    key(3, 'ArrowUp'); await t.next(s => order(s) === '1,3,2,4')
    key(3, 'Home'); await t.next(s => order(s) === '3,1,2,4')
    key(3, 'End'); await t.next(s => order(s) === '1,2,4,3')
    key(3, 'Escape'); await t.next(s => s.sort.dragging === null)
    expect(order(t.state)).toBe('1,2,3,4')
    expect(t.state.sort.message).toBe('Reorder cancelled. Test it is back at position 3 of 4.')
    await t.settle()
    expect(dropped()).toEqual([])
  })

  it('a drop where it started sends no DROPPED; Tab drops at the current position', async () => {
    t = renderComponent(TaskList); await t.ready()
    key(1, ' '); await t.next(s => s.sort.dragging === '1')
    key(1, ' '); await t.next(s => s.sort.dragging === null)
    key(1, ' '); await t.next(s => s.sort.dragging === '1')
    key(1, 'ArrowDown'); await t.next(s => order(s) === '2,1,3,4')
    key(1, 'Tab'); await t.next(s => s.sort.dragging === null)
    await t.settle()
    expect(dropped()).toEqual([{ id: '1', list: 'tasks', index: 1, fromList: 'tasks', fromIndex: 0 }])
  })

  it('a lifted item removed by another action ends the drag at the next key', async () => {
    function L({ state }) { return h('div', null, h('button', { type: 'button', className: 'drop-all' }, 'Clear'), TaskList({ state })) }
    L.initialState = TaskList.initialState
    L.uses = TaskList.uses
    L.context = TaskList.context
    L.intent = ({ DOM }) => ({ CLEAR: DOM.click('.drop-all') })
    L.model = { CLEAR: (s) => ({ ...s, tasks: s.tasks.filter(x => x.id !== 2) }) }
    t = renderComponent(L); await t.ready()
    key(2, ' '); await t.next(s => s.sort.dragging === '2')
    t.simulateEvent('.drop-all', 'click'); await t.next(s => s.tasks.length === 3)
    key(1, 'ArrowDown')                       // any key on a handle while the drag is stale
    await t.next(s => s.sort.dragging === null)
    expect(t.state.sort.mode).toBe(null)
    expect(order(t.state)).toBe('1,3,4')
  })

  it('every keyboard step but Tab sends a focusWithin command for the moved item\'s handle', async () => {
    t = renderComponent(TaskList); await t.ready()
    key(1, ' '); await t.next(s => s.sort.dragging === '1')
    key(1, 'ArrowDown'); await t.next(s => order(s) === '2,1,3,4')
    key(1, 'Tab'); await t.next(s => s.sort.dragging === null)
    await t.settle()
    const cmds = t.commands('ELEMENT')
    expect(cmds).toHaveLength(2)
    for (const c of cmds) {
      expect(String(c.focus)).toBe('')                 // the sender's root (focusWithin)
      expect(c.focus.within).toBe(':scope .task[data-id="1"] .grip')
    }
  })

  it('arrow keys do nothing until an item is lifted; keys on other elements are ignored', async () => {
    t = renderComponent(TaskList); await t.ready()
    key(1, 'ArrowDown')
    t.simulateEvent('.title', 'keydown', { key: ' ', within: '.task[data-id="1"]' })
    await t.settle()
    expect(t.state.sort.dragging).toBe(null)
    expect(order(t.state)).toBe('1,2,3,4')
    expect(t.commands('ELEMENT')).toHaveLength(0)
  })

  it('axis: "x" moves with ArrowLeft / ArrowRight; label and messages are options', async () => {
    function Chip({ state }) { return h('li', { className: 'chip', 'data-key': state.key, tabIndex: 0 }, state.name) }
    function Row({ state }) { return h('ul', null, h(Collection, { of: Chip, from: 'chips' }), h('p', { 'aria-live': 'polite' }, state.sort.message)) }
    Row.initialState = { chips: [{ key: 'a', name: 'Alpha' }, { key: 'b', name: 'Beta' }] }
    Row.uses = { sort: sortable({ from: 'chips', item: '.chip', axis: 'x', attr: 'data-key', idField: 'key', label: (c) => c.name.toUpperCase(),
      messages: { move: (l, n, m) => `${l} ${n}/${m}` } }) }
    t = renderComponent(Row); await t.ready()
    t.simulateEvent('.chip[data-key="a"]', 'keydown', { key: 'Enter' })
    await t.next(s => s.sort.dragging === 'a')
    expect(t.state.sort.message).toMatch(/^Picked up ALPHA, position 1 of 2/)
    t.simulateEvent('.chip[data-key="a"]', 'keydown', { key: 'ArrowDown' })
    await t.settle()
    expect(t.state.chips.map(c => c.key).join()).toBe('a,b')
    t.simulateEvent('.chip[data-key="a"]', 'keydown', { key: 'ArrowRight' })
    await t.next(s => s.chips[1].key === 'a')
    expect(t.state.sort.message).toBe('ALPHA 2/2')
    expect(t.commands('ELEMENT').at(-1).focus.within).toBe(':scope .chip[data-key="a"]')
  })
})

describe('sortable: pointer (mock DOM)', () => {
  it('press, move past the threshold, drop over a later item: reorder after it', async () => {
    t = renderComponent(TaskList); await t.ready()
    t.simulateEvent('.grip', 'pointerdown', { clientX: 10, clientY: 10, within: '.task[data-id="1"]' })
    await t.next(s => s.sort.press?.id === '1')
    expect(t.state.sort.dragging).toBe(null)
    t.simulateEvent('document', 'pointermove', { clientX: 11, clientY: 12, ...over(1) })   // under 4 px
    await t.settle()
    expect(t.state.sort.dragging).toBe(null)
    t.simulateEvent('document', 'pointermove', { clientX: 10, clientY: 30, ...over(1) })
    await t.next(s => s.sort.dragging === '1')
    expect(t.state.sort).toMatchObject({ mode: 'pointer', message: 'Picked up Write spec, position 1 of 4.' })
    t.simulateEvent('document', 'pointermove', { clientX: 10, clientY: 70, ...over(3) })
    await t.next(s => s.sort.over === '3')
    expect(t.state.sort.after).toBe(true)
    expect(order(t.state)).toBe('1,2,3,4')          // indicator only until the drop
    t.simulateEvent('document', 'pointerup', { clientX: 10, clientY: 70, ...over(3) })
    await t.next(s => s.sort.dragging === null)
    expect(order(t.state)).toBe('2,3,1,4')
    expect(t.state.sort.message).toBe('Dropped Write spec at position 3 of 4.')
    await t.settle()
    expect(dropped()).toEqual([{ id: '1', list: 'tasks', index: 2, fromList: 'tasks', fromIndex: 0 }])
    expect(t.commands('ELEMENT')).toHaveLength(0)      // pointer moves don't move focus
  })

  it('moving up lands before the item; a click (no move) changes nothing; Escape and pointercancel cancel', async () => {
    t = renderComponent(TaskList); await t.ready()
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.task[data-id="4"]' })
    t.simulateEvent('document', 'pointerup', { clientX: 0, clientY: 0, ...over(4) })
    await t.settle()
    expect(t.state.sort.press).toBe(null)
    expect(t.state.sort.message).toBe('')
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.task[data-id="4"]' })
    t.simulateEvent('document', 'pointermove', { clientX: 0, clientY: -50, ...over(2) })
    await t.next(s => s.sort.over === '2')
    expect(t.state.sort.after).toBe(false)
    t.simulateEvent('document', 'keydown', { key: 'Escape' })
    await t.next(s => s.sort.dragging === null)
    expect(order(t.state)).toBe('1,2,3,4')
    expect(t.state.sort.message).toMatch(/^Reorder cancelled/)
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.task[data-id="4"]' })
    t.simulateEvent('document', 'pointermove', { clientX: 0, clientY: -50, ...over(2) })
    await t.next(s => s.sort.dragging === '4')
    t.simulateEvent('document', 'pointercancel', {})
    await t.next(s => s.sort.dragging === null)
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.task[data-id="4"]' })
    t.simulateEvent('document', 'pointermove', { clientX: 0, clientY: -50, ...over(2) })
    t.simulateEvent('document', 'pointerup', { clientX: 0, clientY: -50, ...over(2) })
    await t.next(s => order(s) === '1,4,2,3')
  })

  it('a release outside the items changes nothing; a secondary button is not a press', async () => {
    t = renderComponent(TaskList); await t.ready()
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.task[data-id="2"]' })
    t.simulateEvent('document', 'pointermove', { clientX: 300, clientY: 300, target: { closest: () => null } })
    await t.next(s => s.sort.dragging === '2')
    t.simulateEvent('document', 'pointerup', { clientX: 300, clientY: 300, target: { closest: () => null } })
    await t.next(s => s.sort.dragging === null)
    expect(order(t.state)).toBe('1,2,3,4')
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, button: 2, within: '.task[data-id="2"]' })
    await t.settle()
    expect(t.state.sort.press).toBe(null)
  })

  it('without a handle, a press on a button inside the item is not a drag', async () => {
    function Row({ state }) {
      return h('li', { className: 'row', 'data-id': state.id, tabIndex: 0 }, state.title, ' ', h('button', { type: 'button', className: 'del' }, `Delete ${state.title}`))
    }
    function Plain() { return h('ul', { className: 'rows' }, h(Collection, { of: Row, from: 'rows' })) }
    Plain.initialState = { rows: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }
    Plain.uses = { sort: sortable({ from: 'rows', item: '.row' }) }
    t = renderComponent(Plain); await t.ready()
    t.simulateEvent('.del', 'pointerdown', { clientX: 0, clientY: 0, within: '.row[data-id="a"]' })
    await t.settle()
    expect(t.state.sort.press).toBe(null)
    t.simulateEvent('.row[data-id="a"]', 'pointerdown', { clientX: 0, clientY: 0 })
    await t.next(s => s.sort.press?.id === 'a')
  })
})

describe('sortable: two lists (mock DOM)', () => {
  function Card({ state }) {
    return h('li', { className: 'card', 'data-id': state.id }, h('button', { type: 'button', className: 'grip', 'aria-label': `Move ${state.title}` }, '⠿'), state.title)
  }
  function Board() {
    return h('div', { className: 'board' },
      h('ul', { className: 'todo', 'data-list': 'todo' }, h(Collection, { of: Card, from: 'todo' })),
      h('ul', { className: 'done', 'data-list': 'done' }, h(Collection, { of: Card, from: 'done' })))
  }
  Board.initialState = { todo: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }], done: [{ id: 3, title: 'C' }] }
  Board.uses = { sort: sortable({ from: ['todo', 'done'], item: '.card', handle: '.grip' }) }

  it('pointer: drop over an item of the other list moves it there', async () => {
    t = renderComponent(Board); await t.ready()
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.card[data-id="1"]' })
    await t.next(s => s.sort.press)
    t.simulateEvent('document', 'pointermove', { clientX: 200, clientY: 0, ...over(3) })
    await t.next(s => s.sort.over === '3')
    expect(t.state.sort).toMatchObject({ list: 'done', after: false })
    t.simulateEvent('document', 'pointerup', { clientX: 200, clientY: 0, ...over(3) })
    await t.next(s => s.done.length === 2)
    expect(order(t.state, 'todo')).toBe('2')
    expect(order(t.state, 'done')).toBe('1,3')
    await t.settle()
    expect(dropped()).toEqual([{ id: '1', list: 'done', index: 0, fromList: 'todo', fromIndex: 0 }])
  })

  it('pointer: drop on an empty list (its data-list container) appends', async () => {
    t = renderComponent(Board); await t.ready()
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.card[data-id="3"]' })
    await t.next(s => s.sort.press)
    const box = { target: { closest: (s) => (s === '[data-list]' ? { getAttribute: () => 'todo' } : null) } }
    t.simulateEvent('document', 'pointermove', { clientX: 0, clientY: 99, ...box })
    await t.next(s => s.sort.list === 'todo')
    t.simulateEvent('document', 'pointerup', { clientX: 0, clientY: 99, ...box })
    await t.next(s => s.done.length === 0)
    expect(order(t.state, 'todo')).toBe('1,2,3')
  })

  it('keyboard: the cross axis moves the lifted item to the next / previous list; Escape restores', async () => {
    t = renderComponent(Board); await t.ready()
    const k = (id, name) => t.simulateEvent('.grip', 'keydown', { key: name, within: `.card[data-id="${id}"]` })
    k(2, ' '); await t.next(s => s.sort.dragging === '2')
    k(2, 'ArrowRight'); await t.next(s => s.done.length === 2)
    expect(order(t.state, 'done')).toBe('3,2')
    expect(t.state.sort.message).toBe('B: done, position 2 of 2.')
    k(2, 'ArrowRight'); await t.settle()           // no list after 'done'
    expect(order(t.state, 'done')).toBe('3,2')
    k(2, 'Escape'); await t.next(s => s.sort.dragging === null)
    expect(order(t.state, 'todo')).toBe('1,2')
    expect(order(t.state, 'done')).toBe('3')
    k(1, ' '); await t.next(s => s.sort.dragging === '1')
    k(1, 'ArrowRight'); await t.next(s => s.done.length === 2)
    k(1, 'Enter'); await t.next(s => s.sort.dragging === null)
    await t.settle()
    expect(dropped()).toEqual([{ id: '1', list: 'done', index: 0, fromList: 'todo', fromIndex: 0 }])
  })
})

describe('sortable: the instructions id and two lists on one page', () => {
  it('state.sort.helpId is a uid() id of the host, distinct per instance', async () => {
    function Two() { return h('div', null, h(SubList, { state: 'a' }), h(SubList, { state: 'b' })) }
    const list = (n) => ({ tasks: [{ id: n, title: 'T' + n }], dropped: [] })
    Two.initialState = { a: list(1), b: list(2) }
    t = renderComponent(Two); await t.ready()
    await t.settle()
    const a = t.state.a.sort.helpId, b = t.state.b.sort.helpId
    expect(a).toMatch(/sort-help$/)
    expect(b).toMatch(/sort-help$/)
    expect(a).not.toBe(b)
    expect(t.html()).toContain(`aria-describedby="${a}"`)
  })
})

describe('sortable: real DOM (jsdom)', () => {
  const press = (k) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

  it('keyboard moves keep focus on the moved item (focusWithin)', async () => {
    t = renderComponent(TaskList, { dom: 'real', strict: true }); await t.ready()
    const grip = (id) => t.query(`.task[data-id="${id}"] .grip`)
    grip(2).focus()
    press(' ')
    await t.next(s => s.sort.dragging === '2')
    expect(grip(2).getAttribute('aria-pressed')).toBe('true')
    press('ArrowUp')
    await t.next(s => order(s) === '2,1,3,4')
    await sleep(40)
    expect(document.activeElement).toBe(grip(2))
    press('ArrowDown'); await t.next(s => order(s) === '1,2,3,4')
    press('ArrowDown'); await t.next(s => order(s) === '1,3,2,4')
    await sleep(40)
    expect(document.activeElement).toBe(grip(2))
    press('Enter')
    await t.next(s => s.sort.dragging === null)
    expect([...t.queryAll('.task')].map(e => e.dataset.id)).toEqual(['1', '3', '2', '4'])
    expect(t.query('.announce').textContent).toBe('Dropped Build prototype at position 3 of 4.')
    expect(t.query('.help').id).toBe(grip(1).getAttribute('aria-describedby'))
    await t.settle()
    t.expectNoDiagnostics()
  })

  it('Space on a grip is default-prevented (no page scroll, no button click); Tab is not', async () => {
    t = renderComponent(TaskList, { dom: 'real' }); await t.ready()
    const g = t.query('.task[data-id="1"] .grip')
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    g.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    await t.next(s => s.sort.dragging === '1')
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    g.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    await t.next(s => s.sort.dragging === null)
  })

  it('focus moving to another element drops a keyboard drag at its current position', async () => {
    function WithOther() { return h('div', null, h(SubList, { state: 'list' }), h('button', { type: 'button', className: 'other' }, 'Other')) }
    WithOther.initialState = { list: TaskList.initialState }
    t = renderComponent(WithOther, { dom: 'real' }); await t.ready()
    const grip = (id) => t.query(`.task[data-id="${id}"] .grip`)
    grip(1).focus()
    press(' '); await t.next(s => s.list.sort.dragging === '1')
    press('ArrowDown'); await t.next(s => order(s.list) === '2,1,3,4')
    await sleep(40)
    expect(document.activeElement).toBe(grip(1))
    t.query('.other').focus()
    await t.next(s => s.list.sort.dragging === null)
    expect(order(t.state.list)).toBe('2,1,3,4')
    expect(t.state.list.dropped).toEqual(['1:0->1'])
  })

  it('a pointer press anywhere drops a keyboard drag', async () => {
    t = renderComponent(TaskList, { dom: 'real' }); await t.ready()
    t.query('.task[data-id="3"] .grip').focus()
    press('Enter'); await t.next(s => s.sort.dragging === '3')
    press('ArrowUp'); await t.next(s => order(s) === '1,3,2,4')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }))
    await t.next(s => s.sort.dragging === null)
    expect(order(t.state)).toBe('1,3,2,4')
  })

  it('a text selection can\'t start while a pointer is pressed on an item', async () => {
    t = renderComponent(TaskList, { dom: 'real' }); await t.ready()
    const g = t.query('.task[data-id="1"] .grip')
    const before = new Event('selectstart', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(false)
    g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, clientX: 5, clientY: 5 }))
    await t.next(s => s.sort.press)
    const during = new Event('selectstart', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true)
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }))
    await t.next(s => !s.sort.press)
  })

  it('nested sortables: an item belongs to the innermost sortable host only', async () => {
    function Sub({ state }) {
      return h('li', { className: 'node', 'data-id': state.id },
        h('button', { type: 'button', className: 'grip', 'aria-label': 'Move ' + state.id }, '⠿'))
    }
    function Group({ state }) {
      return h('li', { className: 'node', 'data-id': state.id },
        h('button', { type: 'button', className: 'grip', 'aria-label': 'Move ' + state.id }, '⠿'),
        h('ul', null, h(Collection, { of: Sub, from: 'children' })))
    }
    Group.uses = { sort: sortable({ from: 'children', item: '.node', handle: '.grip' }) }
    function Tree() { return h('ul', { className: 'tree' }, h(Collection, { of: Group, from: 'groups' })) }
    // the ids repeat between the levels on purpose
    Tree.initialState = { groups: [{ id: 1, children: [{ id: 1 }, { id: 2 }] }, { id: 2, children: [] }] }
    Tree.uses = { sort: sortable({ from: 'groups', item: '.node', handle: '.grip' }) }
    t = renderComponent(Tree, { dom: 'real' }); await t.ready()
    const inner = t.query('.tree .node[data-id="1"] ul .node[data-id="1"] .grip')
    inner.focus()
    press(' ')
    await t.next(s => s.groups[0].sort?.dragging === '1')
    expect(t.state.sort.dragging).toBe(null)
    press('ArrowDown')
    await t.next(s => s.groups[0].children.map(c => c.id).join() === '2,1')
    expect(order(t.state, 'groups')).toBe('1,2')
    press('Enter'); await t.next(s => s.groups[0].sort.dragging === null)
    // the outer level still sorts its own items
    t.query('.tree > div > .node[data-id="1"] > .grip').focus()
    press(' '); await t.next(s => s.sort.dragging === '1')
    expect(t.state.groups[0].sort.dragging).toBe(null)
    press('ArrowDown'); await t.next(s => order(s, 'groups') === '2,1')
  })
})

describe('sortable: dev diagnostics', () => {
  it('SYG145: an item without the id attribute (once)', async () => {
    function Row({ state }) { return h('li', { className: 'row' }, h('button', { type: 'button', className: 'grip' }, 'Move ' + state.id)) }
    function L() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    L.initialState = { rows: [{ id: 1 }, { id: 2 }] }
    L.uses = { sort: sortable({ from: 'rows', item: '.row', handle: '.grip' }) }
    t = renderComponent(L)
    await t.ready()
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.row' })
    t.simulateEvent('.grip', 'keydown', { key: ' ', within: '.row' })
    await t.settle()
    expect(diagnostics('SYG145')).toHaveLength(1)
    expect(diagnostics('SYG145')[0].message).toMatch(/data-id/)
    expect(t.state.sort.dragging).toBe(null)
  })

  it('SYG146: item / handle selectors that match nothing under the host (real DOM, first interaction)', async () => {
    function Row({ state }) { return h('li', { className: 'row', 'data-id': state.id }, h('button', { type: 'button', className: 'grip' }, 'Move ' + state.id)) }
    function L() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    L.initialState = { rows: [{ id: 1 }] }
    L.uses = { sort: sortable({ from: 'rows', item: '.rwo', handle: '.grip' }) }
    t = renderComponent(L, { dom: 'real' }); await t.ready()
    t.query('.grip').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }))
    t.query('.grip').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }))
    await t.settle()
    expect(diagnostics('SYG146')).toHaveLength(1)
    expect(diagnostics('SYG146')[0].message).toMatch(/'\.rwo'/)
  })

  it('SYG146: a handle selector that no item contains', async () => {
    function Row({ state }) { return h('li', { className: 'row', 'data-id': state.id }, h('button', { type: 'button', className: 'grip' }, 'Move ' + state.id)) }
    function L() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    L.initialState = { rows: [{ id: 1 }] }
    L.uses = { sort: sortable({ from: 'rows', item: '.row', handle: '.handle' }) }
    t = renderComponent(L, { dom: 'real' }); await t.ready()
    t.query('.grip').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await t.settle()
    expect(diagnostics('SYG146').map(d => d.data?.option)).toEqual(['handle'])
  })

  it('SYG146 is not reported for an empty list', async () => {
    function L() { return h('div', null, h('button', { type: 'button', className: 'x' }, 'x'), h('ul', null, h(Collection, { of: Task, from: 'tasks' }))) }
    L.initialState = { tasks: [] }
    L.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
    L.context = { sort: (s) => s.sort }
    t = renderComponent(L, { dom: 'real' }); await t.ready()
    t.query('.x').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true }))
    await t.settle()
    expect(diagnostics('SYG146')).toHaveLength(0)
  })

  it('SYG147: `from` that is not an array key of the host state', async () => {
    function L({ state }) { return h('ul', null, state.sort.message) }
    L.initialState = { items: [], other: 3 }
    L.uses = { sort: sortable({ from: ['itmes', 'other'], item: '.x' }) }
    t = renderComponent(L); await t.ready()
    await t.settle()
    const d = diagnostics('SYG147')
    expect(d.map(x => x.data?.from)).toEqual(['itmes', 'other'])
    expect(d[0].message).toMatch(/'itmes'/)
    expect(d[0].fix).toMatch(/items/)
  })
})
