// @vitest-environment jsdom
// PLAN-5 3-H: the `sortable` fix pass (G-444…G-455): nested sortables with repeated ids, held
// keys, undo / persist interplay, the instructions id, filtered lists, native dragstart, a press
// during a keyboard drag, drops after the last item of another list, unmount mid-drag.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent, renderToString, Collection, sortable, persist } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks } from './diagnostics/helpers.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const order = (s, k = 'tasks') => s[k].map(x => x.id).join()
const press = (k, o = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
const ptr = (el, type, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...o }))

// two levels, the ids repeat between them
function Sub({ state }) {
  return h('li', { className: 'node', 'data-id': state.id },
    h('button', { type: 'button', className: 'grip', 'aria-label': 'Move inner ' + state.id }, '⠿'))
}
function Group({ state }) {
  return h('li', { className: 'node', 'data-id': state.id },
    h('button', { type: 'button', className: 'grip', 'aria-label': 'Move group ' + state.id }, '⠿'),
    h('ul', null, h(Collection, { of: Sub, from: 'children' })))
}
Group.uses = { sort: sortable({ from: 'children', item: '.node', handle: '.grip' }) }
function Tree() { return h('ul', { className: 'tree' }, h(Collection, { of: Group, from: 'groups' })) }
Tree.uses = { sort: sortable({ from: 'groups', item: '.node', handle: '.grip' }) }
const groups = (...g) => g.map(([id, kids = []]) => ({ id, children: kids.map(k => ({ id: k })) }))
// the outer group element with this id (not an inner node with the same id)
const outer = (id) => [...t.queryAll('.node')].find(n => n.dataset.id === String(id) && !n.parentElement.closest('.node'))
const innerNode = (gid, id) => [...outer(gid).querySelectorAll('.node')].find(n => n.dataset.id === String(id))

describe('3-H G-444 / G-445: nested sortables with ids repeated between the levels', () => {
  it('pointer: dragging outer 3 over inner 2 (inside group 1) lands before group 1', async () => {
    Tree.initialState = { groups: groups([1, [2]], [2], [3]) }
    t = renderComponent(Tree, { dom: 'real' }); await t.ready()
    const g3 = outer(3).querySelector(':scope > .grip')
    ptr(g3, 'pointerdown', { clientX: 5, clientY: 100 })
    await t.next(s => s.sort.press?.id === '3')
    const target = innerNode(1, 2)
    ptr(target, 'pointermove', { clientX: 5, clientY: 5 })
    await t.next(s => s.sort.dragging === '3')
    expect(t.state.sort.over).toBe('1')                 // the outer item around the inner one
    ptr(target, 'pointerup', { clientX: 5, clientY: 5 })
    await t.next(s => s.sort.dragging === null)
    expect(order(t.state, 'groups')).toBe('3,1,2')
    expect(t.state.groups[1].children.map(c => c.id)).toEqual([2])   // group 1 keeps its inner 2
  })

  it('keyboard: Space on outer group 3 lifts it (focus stays on its own grip, not the inner 3); arrows move it', async () => {
    Tree.initialState = { groups: groups([1, [3]], [2], [3]) }
    t = renderComponent(Tree, { dom: 'real' }); await t.ready()
    const grip = () => outer(3).querySelector(':scope > .grip')
    grip().focus()
    press(' ')
    await t.next(s => s.sort.dragging === '3')
    await sleep(40)
    expect(t.state.sort.dragging).toBe('3')            // not dropped by a focus move
    expect(document.activeElement).toBe(grip())
    press('ArrowUp')
    await t.next(s => order(s, 'groups') === '1,3,2')
    await sleep(40)
    expect(document.activeElement).toBe(grip())
    press('ArrowUp')
    await t.next(s => order(s, 'groups') === '3,1,2')
    await sleep(40)
    expect(document.activeElement).toBe(grip())
    press('Enter')
    await t.next(s => s.sort.dragging === null)
    expect(t.state.groups.find(g => g.id === 1).children).toEqual([{ id: 3 }])
  })

  it('a key on the root element of an inner host (an outer item without a handle) is the outer host\'s', async () => {
    function Leaf({ state }) { return h('li', { className: 'n', 'data-id': state.id, tabIndex: 0 }, 'leaf ' + state.id) }
    function Lane({ state }) {
      return h('li', { className: 'n', 'data-id': state.id, tabIndex: 0 }, 'lane ' + state.id, h('ul', null, h(Collection, { of: Leaf, from: 'kids' })))
    }
    Lane.uses = { sort: sortable({ from: 'kids', item: '.n' }) }
    function Board() { return h('ul', { className: 'board' }, h(Collection, { of: Lane, from: 'lanes' })) }
    Board.initialState = { lanes: [{ id: 1, kids: [{ id: 1 }, { id: 2 }] }, { id: 2, kids: [] }] }
    Board.uses = { sort: sortable({ from: 'lanes', item: '.n' }) }
    t = renderComponent(Board, { dom: 'real' }); await t.ready()
    const lane1 = [...t.queryAll('.n')].find(n => n.dataset.id === '1' && !n.parentElement.closest('.n'))
    lane1.focus()
    press(' ')
    await t.next(s => s.sort.dragging === '1')
    expect(t.state.lanes[0].sort?.dragging ?? null).toBe(null)
    press('ArrowDown')
    await t.next(s => order(s, 'lanes') === '2,1')
    press('Enter')
    await t.next(s => s.sort.dragging === null)
  })
})

function Task({ state, context }) {
  const { dragging, over, after, helpId } = context.sort
  const id = String(state.id)
  const cls = ['task', dragging === id && 'dragging', over === id && dragging !== id && (after ? 'drop-after' : 'drop-before')]
  return h('li', { className: cls.filter(Boolean).join(' '), 'data-id': state.id },
    h('button', { type: 'button', className: 'grip', 'aria-label': `Reorder ${state.title}`, 'aria-describedby': helpId || undefined }, '⠿'),
    h('span', { className: 'title' }, state.title))
}
function TaskList({ state }) {
  return h('section', { className: 'board' },
    h('p', { id: state.sort.helpId || undefined, className: 'help', hidden: true }, 'Press Space to pick up a task.'),
    h('ul', { className: 'tasks' }, h(Collection, { of: Task, from: 'tasks' })),
    h('p', { className: 'announce', role: 'status' }, state.sort.message))
}
const TASKS = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }, { id: 4, title: 'D' }]
TaskList.initialState = { tasks: TASKS, dropped: [] }
TaskList.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
TaskList.context = { sort: (state) => state.sort }
TaskList.model = { 'sort.DROPPED': (s, d) => ({ ...s, dropped: [...s.dropped, `${d.id}:${d.fromIndex}->${d.index}`] }) }
const grip = (id) => t.query(`.task[data-id="${id}"] .grip`)
const droppedActions = () => t.actions.filter(a => a.type === 'sort.DROPPED')

describe('3-H G-446: held Space / Enter', () => {
  it('auto-repeated lift keys neither drop nor lift again (still default-prevented)', async () => {
    t = renderComponent(TaskList, { dom: 'real' }); await t.ready()
    grip(2).focus()
    press(' ')
    await t.next(s => s.sort.dragging === '2')
    const held = new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true })
    grip(2).dispatchEvent(held)
    press('Enter', { repeat: true })
    await sleep(30)
    expect(held.defaultPrevented).toBe(true)
    expect(t.state.sort.dragging).toBe('2')
    press('ArrowDown')
    await t.next(s => order(s) === '1,3,2,4')
    press('Enter')
    await t.next(s => s.sort.dragging === null)
    press('Enter', { repeat: true })
    await sleep(30)
    expect(t.state.sort.dragging).toBe(null)
    await t.settle()
    expect(droppedActions()).toHaveLength(1)
  })
})

describe('3-H G-451: a pointer press on a handle during a keyboard drag', () => {
  it('drops the keyboard drag where it is and starts the press (one press, not two)', async () => {
    t = renderComponent(TaskList, { dom: 'real' }); await t.ready()
    grip(3).focus()
    press('Enter'); await t.next(s => s.sort.dragging === '3')
    press('ArrowUp'); await t.next(s => order(s) === '1,3,2,4')
    ptr(grip(4), 'pointerdown', { clientX: 5, clientY: 100 })
    await t.next(s => s.sort.press?.id === '4')
    expect(t.state.sort).toMatchObject({ dragging: null, mode: null })
    expect(t.state.sort.message).toBe('Dropped C at position 2 of 4.')
    ptr(grip(1), 'pointermove', { clientX: 5, clientY: 5 })
    await t.next(s => s.sort.dragging === '4')
    ptr(grip(1), 'pointerup', { clientX: 5, clientY: 5 })
    await t.next(s => s.sort.dragging === null)
    expect(order(t.state)).toBe('4,1,3,2')
    await t.settle()
    expect(t.state.dropped).toEqual(['3:2->1', '4:3->0'])
  })
})

describe('3-H G-454: a pointer drop in another list lands before or after the hovered item by its half', () => {
  function Card({ state }) {
    return h('li', { className: 'card', 'data-id': state.id }, h('button', { type: 'button', className: 'grip' }, '⠿'), state.id)
  }
  function Board() {
    return h('div', null,
      h('ul', { 'data-list': 'todo' }, h(Collection, { of: Card, from: 'todo' })),
      h('ul', { 'data-list': 'done' }, h(Collection, { of: Card, from: 'done' })))
  }
  Board.initialState = { todo: [{ id: 1 }, { id: 2 }], done: [{ id: 3 }, { id: 4 }] }
  Board.uses = { sort: sortable({ from: ['todo', 'done'], item: '.card', handle: '.grip' }) }
  // mock DOM: the item under the pointer, 20 px tall from y = 100
  const over = (id) => ({ target: { closest: (s) => (s !== '[data-list]' ? { getAttribute: (a) => (a === 'data-id' ? String(id) : null), getBoundingClientRect: () => ({ top: 100, left: 0, width: 200, height: 20 }) } : null) } })
  const drag = async (id, to, y) => {
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: `.card[data-id="${id}"]` })
    await t.next(s => s.sort.press)
    t.simulateEvent('document', 'pointermove', { clientX: 300, clientY: y, ...over(to) })
    await t.next(s => s.sort.over === String(to))
    const after = t.state.sort.after
    t.simulateEvent('document', 'pointerup', { clientX: 300, clientY: y, ...over(to) })
    await t.next(s => s.sort.dragging === null)
    return after
  }

  it('the lower half of the last item: after it (the end of the list, no gap needed)', async () => {
    t = renderComponent(Board); await t.ready()
    expect(await drag(1, 4, 115)).toBe(true)
    expect(order(t.state, 'done')).toBe('3,4,1')
    await t.settle()
    expect(droppedActions().map(a => a.data)).toEqual([{ id: '1', list: 'done', index: 2, fromList: 'todo', fromIndex: 0 }])
  })

  it('the upper half: before it; the lower half of a middle item: after it', async () => {
    t = renderComponent(Board); await t.ready()
    expect(await drag(1, 4, 105)).toBe(false)
    expect(order(t.state, 'done')).toBe('3,1,4')
    expect(await drag(2, 3, 119)).toBe(true)
    expect(order(t.state, 'done')).toBe('3,2,1,4')
  })

  it('in its own list the rule is unchanged (after when moving down, before when moving up)', async () => {
    t = renderComponent(Board); await t.ready()
    expect(await drag(3, 4, 101)).toBe(true)
    expect(order(t.state, 'done')).toBe('4,3')
    expect(await drag(3, 4, 119)).toBe(false)
    expect(order(t.state, 'done')).toBe('3,4')
  })
})

describe('3-H G-448 / G-453: the instructions id', () => {
  it('nothing is written into Collection-item hosts at startup; the first focus inside a host sets its unique id', async () => {
    Tree.initialState = { groups: groups([1, [2]], [2]) }
    t = renderComponent(Tree, { dom: 'real' }); await t.ready()
    await t.settle()
    expect(t.state.groups.map(g => 'sort' in g)).toEqual([false, false])
    expect(t.state.sort.helpId).toBe(null)
    innerNode(1, 2).querySelector('.grip').focus()
    await t.next(s => s.groups[0].sort?.helpId)
    const inner = t.state.groups[0].sort.helpId
    expect(inner).toMatch(/sort-help$/)
    expect('sort' in t.state.groups[1]).toBe(false)     // a host nothing happened in
    expect(t.state.sort.helpId).toMatch(/sort-help$/)   // the outer host heard the focus too
    expect(t.state.sort.helpId).not.toBe(inner)
  })

  it('a root host: no aria-describedby before the first focus (as on the server); the focused handle is described', async () => {
    const server = renderToString(TaskList)
    expect(server).not.toContain('aria-describedby')
    t = renderComponent(TaskList, { dom: 'real' }); await t.ready()
    await t.settle()
    expect(t.state.sort.helpId).toBe(null)
    expect(t.query('.grip').hasAttribute('aria-describedby')).toBe(false)
    grip(3).focus()
    await t.next(s => s.sort.helpId)
    await sleep(10)
    expect(grip(3).getAttribute('aria-describedby')).toBe(t.query('.help').id)
    expect(t.query('.help').id).toBe(t.state.sort.helpId)
  })

  it('a press or a key sets it too (no focus event: a mock DOM, a button Safari does not focus)', async () => {
    t = renderComponent(TaskList); await t.ready()
    t.simulateEvent('.grip', 'pointerdown', { clientX: 0, clientY: 0, within: '.task[data-id="1"]' })
    await t.next(s => s.sort.helpId)
    expect(t.html()).toContain(`aria-describedby="${t.state.sort.helpId}"`)
  })
})

describe('3-H G-452: persist and restored drag state', () => {
  const stale = { dragging: '2', over: '3', after: true, list: 'tasks', mode: 'pointer', press: { id: '2', x: 0, y: 0 }, origin: { list: 'tasks', index: 1 }, message: 'Picked up B', helpId: 'x-sort-help' }
  function Saved(props) { return TaskList(props) }
  Saved.initialState = TaskList.initialState
  Saved.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
  Saved.context = TaskList.context
  Saved.persist = persist({ key: 'tasks-app', debounceMs: 0 })

  it('persist leaves the sortable slice out (saved mid-drag)', async () => {
    t = renderComponent(Saved, { dom: 'real' }); await t.ready()
    ptr(grip(2), 'pointerdown', { clientX: 5, clientY: 5 })
    ptr(grip(3), 'pointermove', { clientX: 5, clientY: 60 })
    await t.next(s => s.sort.dragging === '2')
    await t.settle()
    const saved = t.storage('tasks-app').state
    expect(Object.keys(saved).sort()).toEqual(['dropped', 'tasks'])
  })

  it('a stored slice (saved by an older version) is not restored: no live listeners, no stale drag', async () => {
    t = renderComponent(Saved, { dom: 'real', storage: { 'tasks-app': { version: 1, state: { tasks: TASKS, dropped: [], sort: stale } } } })
    await t.ready()
    expect(t.state.sort).toMatchObject({ dragging: null, press: null, mode: null })
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 50, clientY: 50 }))
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
    await t.settle()
    expect(t.actions.filter(a => /^sort\.(MOVE|UP)$/.test(a.type))).toEqual([])
  })

  it('stale drag state in a Collection-item host\'s data (restored with the parent\'s) is reset when it starts and arms nothing', async () => {
    Tree.initialState = { groups: [{ id: 1, children: [{ id: 2 }, { id: 3 }], sort: { ...stale, list: 'children', origin: { list: 'children', index: 0 } } }, { id: 9, children: [] }] }
    t = renderComponent(Tree, { dom: 'real' }); await t.ready()
    await t.settle()
    expect(t.state.groups[0].sort).toMatchObject({ dragging: null, press: null, mode: null })
    expect(innerNode(1, 2).closest('.node')).toBeTruthy()
  })

  it('drag state written into a running host (a sync, devtools) arms no listeners; the next press starts clean', async () => {
    function Host({ state }) { return h('div', null, h('button', { type: 'button', className: 'inject' }, 'x'), h(Tree, { state: 'tree' })) }
    Tree.initialState = undefined
    Host.initialState = { tree: { groups: groups([1, [2, 3]], [9]) } }
    Host.intent = ({ DOM }) => ({ INJECT: DOM.click('.inject') })
    Host.model = { INJECT: (s) => ({ ...s, tree: { ...s.tree, groups: s.tree.groups.map((g, i) => (i ? g : { ...g, sort: { ...stale, list: 'children', dragging: null, mode: null, origin: null } })) } }) }
    t = renderComponent(Host, { dom: 'real' }); await t.ready()
    t.query('.inject').click()
    await t.next(s => s.tree.groups[0].sort?.press)
    // a move far from the stale press would start a drag if its listeners were live
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 300, clientY: 300 }))
    await t.settle()
    expect(t.state.tree.groups[0].sort.dragging).toBe(null)
    // a real press replaces the stale one and drags
    const g = innerNode(1, 3).querySelector('.grip')
    ptr(g, 'pointerdown', { clientX: 5, clientY: 50 })
    await t.next(s => s.tree.groups[0].sort.press?.id === '3')
    ptr(innerNode(1, 2), 'pointermove', { clientX: 5, clientY: 5 })
    await t.next(s => s.tree.groups[0].sort.dragging === '3')
    ptr(innerNode(1, 2), 'pointerup', { clientX: 5, clientY: 5 })
    await t.next(s => s.tree.groups[0].children.map(c => c.id).join() === '3,2')
  })
})

describe('3-H G-450: native drag and drop', () => {
  it('a native dragstart (an image or link in the item) is prevented while a pointer is pressed', async () => {
    function Row({ state }) { return h('li', { className: 'row', 'data-id': state.id }, h('img', { alt: '', src: 'data:,' }), h('a', { href: '#x' }, state.id)) }
    function Rows() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    Rows.initialState = { rows: [{ id: 'a' }, { id: 'b' }] }
    Rows.uses = { sort: sortable({ from: 'rows', item: '.row' }) }
    t = renderComponent(Rows, { dom: 'real' }); await t.ready()
    const img = t.query('.row[data-id="a"] img')
    const before = new Event('dragstart', { bubbles: true, cancelable: true })
    img.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(false)
    ptr(img, 'pointerdown', { clientX: 5, clientY: 5 })
    await t.next(s => s.sort.press?.id === 'a')
    const during = new Event('dragstart', { bubbles: true, cancelable: true })
    img.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true)
    ptr(img, 'pointermove', { clientX: 5, clientY: 40 })
    await t.next(s => s.sort.dragging === 'a')
    const dragging = new Event('dragstart', { bubbles: true, cancelable: true })
    t.query('.row[data-id="a"] a').dispatchEvent(dragging)
    expect(dragging.defaultPrevented).toBe(true)
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 5, clientY: 40 }))
    await t.next(s => !s.sort.press)
    const after = new Event('dragstart', { bubbles: true, cancelable: true })
    img.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})
