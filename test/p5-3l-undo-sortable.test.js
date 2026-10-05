// @vitest-environment jsdom
// PLAN-5 3-L: the undo-gesture / sortable fix pass (G-473…G-479): recorded actions, UNDO and
// REDO during a drag; END / INIT / a reset restoring only into the lists the drag made; track /
// resetOn / coalesce naming the gesture's actions; SYG435's containers, data-index and once.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent, Collection, sortable, undo } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const order = (s, k = 'tasks') => s[k].map(x => x.id).join()
const press = (k, o = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
const ptr = (el, type, o = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...o }))

function Task({ state }) {
  return h('li', { className: 'task', 'data-id': state.id },
    h('button', { type: 'button', className: 'grip', 'aria-label': `Reorder ${state.title}` }, '⠿'),
    h('span', { className: 'title' }, state.title))
}
function TaskList({ state }) {
  return h('section', { className: 'board' },
    h('ul', { className: 'tasks' }, h(Collection, { of: Task, from: 'tasks' })),
    h('p', { className: 'announce', role: 'status' }, state.sort.message))
}
const TASKS = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }, { id: 4, title: 'D' }]
const grip = (id, root = document) => root.querySelector(`.task[data-id="${id}"] .grip`)
const past = () => t.state.history.past.map(a => a.map(x => x.id).join())
const future = () => t.state.history.future.map(a => a.map(x => x.id).join())

// a list with undo({ key: 'tasks', ...opts }) and an ADD action (recorded)
const withUndo = (opts = {}, first = 'sort') => {
  function L(props) { return TaskList(props) }
  L.initialState = { tasks: TASKS }
  const s = sortable({ from: 'tasks', item: '.task', handle: '.grip' }), u = undo({ key: 'tasks', ...opts })
  L.uses = first === 'sort' ? { sort: s, history: u } : { history: u, sort: s }
  L.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
  L.model = { ADD: (st) => ({ ...st, tasks: [...st.tasks, { id: st.tasks.length + 1, title: 'N' }] }) }
  return L
}
const lift = async (id) => { grip(id).focus(); press(' '); await t.next(s => s.sort.dragging === String(id)) }

describe('3-L G-473: a recorded action, UNDO or REDO during a drag', () => {
  for (const first of ['sort', 'history']) {
    it(`a recorded action mid-drag keeps the order from before the drag reachable (uses: ${first} first)`, async () => {
      t = renderComponent(withUndo({}, first), { dom: 'real' }); await t.ready()
      await lift(2)
      press('ArrowDown'); await t.next(s => order(s) === '1,3,2,4')
      t.simulateAction('ADD'); await t.next(s => order(s) === '1,3,2,4,5')
      expect(t.state.sort.dragging).toBe('2')
      press('ArrowDown'); await t.next(s => order(s) === '1,3,4,2,5')
      press('Enter'); await t.next(s => s.sort.dragging === null)
      await t.next(s => s.history.past.length === 2)
      expect(past()).toEqual(['1,2,3,4', '1,3,2,4,5'])
      expect(t.state.history.base).toBe(undefined)
      t.simulateAction('history.UNDO'); await t.next(s => order(s) === '1,3,2,4,5')
      t.simulateAction('history.UNDO'); await t.next(s => order(s) === '1,2,3,4')
    })
  }

  it('UNDO mid-drag undoes the drag so far (the pre-drag order); REDO brings it back; the drag goes on', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await lift(2)
    press('ArrowDown'); await t.next(s => order(s) === '1,3,2,4')
    press('ArrowDown'); await t.next(s => order(s) === '1,3,4,2')
    t.simulateAction('history.UNDO'); await t.next(s => order(s) === '1,2,3,4')
    expect(past()).toEqual([])
    expect(future()).toEqual(['1,3,4,2'])
    expect(t.state.history.base).toBe(undefined)
    t.simulateAction('history.REDO'); await t.next(s => order(s) === '1,3,4,2')
    expect(past()).toEqual(['1,2,3,4'])
    // the drag is still live: it moves from where the item is, and its drop is one more step
    // (the reorder moved the item's node: jsdom drops the focus, which keeps the drag)
    grip(2).focus()
    press('ArrowUp'); await t.next(s => order(s) === '1,3,2,4')
    press('Enter'); await t.next(s => s.sort.dragging === null)
    await t.next(s => s.history.past.length === 2)
    expect(past()).toEqual(['1,2,3,4', '1,3,4,2'])
  })

  it('UNDO mid-drag with earlier steps: the drag so far is one step back, the earlier one the next', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    t.simulateAction('ADD'); await t.next(s => order(s) === '1,2,3,4,5')
    await lift(1)
    press('ArrowDown'); await t.next(s => order(s) === '2,1,3,4,5')
    t.simulateAction('history.UNDO'); await t.next(s => order(s) === '1,2,3,4,5')
    t.simulateAction('history.UNDO'); await t.next(s => order(s) === '1,2,3,4')
    expect(future()).toEqual(['1,2,3,4,5', '2,1,3,4,5'])
  })
})

describe('3-L G-474: END restores only into the lists the drag made', () => {
  const Sub = (props) => TaskList(props)
  Object.assign(Sub, { uses: { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) } })
  function Page({ state }) {
    return h('div', null, state.show ? h(Sub, { state: 'list' }) : h('p', null, 'hidden'))
  }
  Page.initialState = { show: true, list: { tasks: TASKS } }
  Page.model = {
    GO: (s) => ({ ...s, show: false, list: { ...s.list, tasks: [{ id: 2, title: 'B' }, { id: 5, title: 'E' }, { id: 6, title: 'F' }] } }),
    HIDE: (s) => ({ ...s, show: false }),
  }

  it('an action that hides the host and replaces its list: the new list is left as it is', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await (async () => { grip(2).focus(); press(' '); await t.next(s => s.list.sort?.dragging === '2') })()
    press('ArrowDown'); await t.next(s => order(s.list) === '1,3,2,4')
    t.simulateAction('GO')
    await t.next(s => !s.show)
    await t.settle()
    expect(order(t.state.list)).toBe('2,5,6')
    expect(t.state.list.sort).toMatchObject({ dragging: null, mode: null, origin: null })
  })

  it('the drag\'s own list still goes back', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    grip(2).focus(); press(' '); await t.next(s => s.list.sort?.dragging === '2')
    press('ArrowDown'); await t.next(s => order(s.list) === '1,3,2,4')
    t.simulateAction('HIDE')
    await t.next(s => !s.show)
    await t.settle()
    expect(order(t.state.list)).toBe('1,2,3,4')
  })
})

describe('3-L G-475: drag state this instance did not start, with the END rule', () => {
  it('a key from another instance (a second host of the slice): the item goes back, nothing pending in undo', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await lift(2)
    press('ArrowDown'); await t.next(s => order(s) === '1,3,2,4')
    expect(t.state.history.base).toBeTruthy()
    t.simulateAction('sort.KEY', { key: ' ', id: '1', n: 12345 })
    await t.next(s => s.sort.dragging === '1')
    expect(order(t.state)).toBe('1,2,3,4')
    expect(t.state.history.base).toBe(undefined)
    expect(past()).toEqual([])
  })

  it('a second host mounted mid-drag (its INIT): the item goes back to where it started', async () => {
    const Sub = (props) => TaskList(props)
    Object.assign(Sub, { uses: { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) } })
    function Two({ state }) {
      return h('div', null, h('div', { className: 'a' }, h(Sub, { state: 'list' })), state.two ? h('div', { className: 'b' }, h(Sub, { state: 'list' })) : null)
    }
    Two.initialState = { two: false, list: { tasks: TASKS } }
    Two.model = { TWO: (s) => ({ ...s, two: true }) }
    t = renderComponent(Two, { dom: 'real' }); await t.ready()
    grip(2).focus(); press(' '); await t.next(s => s.list.sort?.dragging === '2')
    press('ArrowDown'); await t.next(s => order(s.list) === '1,3,2,4')
    t.simulateAction('TWO')
    await t.next(s => s.two && s.list.sort.dragging === null)
    expect(order(t.state.list)).toBe('1,2,3,4')
  })

  it('a keyboard drag restored with data the drag did not make (a persisted item host): idle, the data as it is', async () => {
    function Group({ state }) { return h('li', null, h('ul', null, h(Collection, { of: Task, from: 'children' }))) }
    Group.uses = { sort: sortable({ from: 'children', item: '.task', handle: '.grip' }) }
    function Tree() { return h('ul', null, h(Collection, { of: Group, from: 'groups' })) }
    Tree.initialState = { groups: [{ id: 1, children: [{ id: 3, title: 'C' }, { id: 2, title: 'B' }], sort: { dragging: '2', over: null, after: false, list: null, mode: 'keyboard', press: null, origin: { list: 'children', index: 0, n: 1 }, message: '' } }] }
    t = renderComponent(Tree, { dom: 'real' }); await t.ready()
    await t.settle()
    expect(t.state.groups[0].sort).toMatchObject({ dragging: null, mode: null, origin: null })
    expect(t.state.groups[0].children.map(c => c.id).join()).toBe('3,2')
  })
})

describe('3-L G-477: track / resetOn / coalesce naming the gesture\'s actions', () => {
  const drag = async (id, key = 'ArrowDown') => {
    await lift(id)
    const before = order(t.state)
    press(key); await t.next(s => order(s) !== before)
    press('Enter'); await t.next(s => s.sort.dragging === null)
  }

  it('track naming any of sortable\'s actions records its drops', async () => {
    t = renderComponent(withUndo({ track: ['sort.UP'] }), { dom: 'real' }); await t.ready()
    await drag(1)
    await t.next(s => s.history.past.length === 1)
    expect(past()).toEqual(['1,2,3,4'])
    t.simulateAction('ADD'); await t.next(s => s.tasks.length === 5)
    expect(past()).toEqual(['1,2,3,4'])                 // ADD isn't tracked
    expect(diagnostics('SYG226')).toHaveLength(0)
  })

  it('resetOn naming sort.DROPPED clears the history at each drop', async () => {
    t = renderComponent(withUndo({ resetOn: ['sort.DROPPED'] }), { dom: 'real' }); await t.ready()
    t.simulateAction('ADD'); await t.next(s => s.history.past.length === 1)
    await drag(1)
    await t.next(s => s.history.past.length === 0)
    expect(t.state.history.base).toBe(undefined)
  })

  it('coalesce naming sort.DROPPED joins quick drops into one step', async () => {
    t = renderComponent(withUndo({ coalesce: ['sort.DROPPED'], coalesceMs: 5000 }), { dom: 'real' }); await t.ready()
    await drag(1)
    await t.next(s => s.history.past.length === 1)
    await drag(2)
    await t.settle()
    expect(past()).toEqual(['1,2,3,4'])
    t.simulateAction('ADD'); await t.next(s => s.tasks.length === 5)
    expect(t.state.history.past.length).toBe(2)          // not listed: its own step
  })

  it('SYG226 reports a name under the behavior\'s key that is none of its actions', async () => {
    t = renderComponent(withUndo({ track: ['sort.DROPED', 'sort.DROPPED'] }), { dom: 'real' }); await t.ready()
    const d = diagnostics('SYG226')
    expect(d).toHaveLength(1)
    expect(d[0].data).toEqual({ action: 'sort.DROPED' })
  })
})

describe('3-L G-479: a cancelled drag leaves no base', () => {
  it('Escape, and a drag moved back to where it started', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await lift(1)
    press('ArrowDown'); await t.next(s => order(s) === '2,1,3,4')
    expect(t.state.history.base).toBeTruthy()
    press('Escape'); await t.next(s => s.sort.dragging === null)
    expect(t.state.history.base).toBe(undefined)
    await lift(1)
    press('ArrowDown'); await t.next(s => order(s) === '2,1,3,4')
    press('ArrowUp'); await t.next(s => order(s) === '1,2,3,4')
    expect(t.state.history.base).toBe(undefined)
    press('Enter'); await t.next(s => s.sort.dragging === null)
    await t.settle()
    expect(t.state.history).toMatchObject({ past: [], future: [] })
    expect(t.state.history.base).toBe(undefined)
  })
})

describe('3-L G-478: SYG435 looks at the list container, in data-index order, and stops scanning once reported', () => {
  const make = (view) => {
    function L(props) { return view(props) }
    L.initialState = { tasks: TASKS }
    L.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
    return L
  }
  const row = (x, attrs = {}) => h('li', { className: 'task', 'data-id': x.id, ...attrs }, h('button', { type: 'button', className: 'grip' }, '⠿'))

  it('an element with a matching id outside the list (a detail panel) is no list item', async () => {
    t = renderComponent(make(({ state }) => h('div', null,
      h('div', { className: 'task detail', 'data-id': 3 }, 'C (selected)'),
      h('ul', null, ...state.tasks.map(x => row(x))))), { dom: 'real' })
    await t.ready()
    grip(1).focus()
    press(' '); await t.next(s => s.sort.dragging === '1')
    expect(diagnostics('SYG435')).toHaveLength(0)
  })

  it('rows placed out of DOM order by data-index (VirtualCollection\'s pinned focused row) aren\'t a reorder', async () => {
    // the focused row 4 pinned first in the DOM, out of the window's flow
    t = renderComponent(make(({ state }) => h('ul', null,
      row(state.tasks[3], { 'data-index': 3 }), ...state.tasks.slice(0, 3).map((x, i) => row(x, { 'data-index': i })))), { dom: 'real' })
    await t.ready()
    grip(2).focus()
    press(' '); await t.next(s => s.sort.dragging === '2')
    expect(diagnostics('SYG435')).toHaveLength(0)
  })

  it('a real reorder is still reported, and once reported the items are not scanned again', async () => {
    const L = make(({ state }) => h('ul', null, ...[...state.tasks].reverse().map(x => row(x))))
    const bridge = globalThis.__SYGNAL_DIAGNOSTICS__, hook = bridge.sortable
    let scans = 0
    bridge.sortable = (code, a, ...rest) => hook(code, typeof a == 'function' ? (...x) => (scans++, a(...x)) : a, ...rest)
    try {
      t = renderComponent(L, { dom: 'real' }); await t.ready()
      ptr(grip(1), 'pointerdown', { clientX: 5, clientY: 5 })
      await t.next(s => s.sort.press)
      expect(diagnostics('SYG435')).toHaveLength(1)
      expect(scans).toBe(1)
      ptr(grip(1), 'pointerup', { clientX: 5, clientY: 5 })
      await t.next(s => !s.sort.press)
      ptr(grip(2), 'pointerdown', { clientX: 5, clientY: 5 })
      await t.next(s => s.sort.press)
      expect(scans).toBe(1)
      expect(diagnostics('SYG435')).toHaveLength(1)
    } finally { bridge.sortable = hook }
  })
})
