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
