// @vitest-environment jsdom
// PLAN-5 3-H: the `sortable` fix pass (G-444…G-455): nested sortables with repeated ids, held
// keys, undo / persist interplay, the instructions id, filtered lists, native dragstart, a press
// during a keyboard drag, drops after the last item of another list, unmount mid-drag.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent, Collection, sortable } from '../src/index.js'
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
