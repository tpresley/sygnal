// @vitest-environment jsdom
// PLAN-5 3-O: the second undo-gesture / sortable fix pass (G-504…G-509): a keyboard drag's restore
// follows where the item is (not which array holds it); SYG435 finds a list whose items are
// wrapped; an untracked gesture records nothing; drops join only when `coalesce` names them; REDO
// mid-drag; shallow "back where it started". Plus a sequence matrix for undo gestures.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent, Collection, sortable, undo, defineBehavior, ABORT } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const order = (s, k = 'tasks') => s[k].map(x => x.id).join('')
const press = (k, o = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))

function Task({ state }) {
  return h('li', { className: 'task', 'data-id': state.id },
    h('button', { type: 'button', className: 'grip' }, '⠿'), h('span', null, state.title))
}
function TaskList() { return h('section', null, h('ul', null, h(Collection, { of: Task, from: 'tasks' }))) }
const TASKS = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }, { id: 4, title: 'D' }]
const grip = (id) => document.querySelector(`.task[data-id="${id}"] .grip`)
const ids = (a) => a.map(x => x.id).join('')
const past = () => t.state.history.past.map(ids)
const future = () => t.state.history.future.map(ids)
const ADD = (st) => ({ ...st, tasks: [...st.tasks, { id: st.tasks.length + 1, title: 'N' }] })

// a list with undo({ key: 'tasks', ...opts }) and ADD (recorded unless track leaves it out)
const withUndo = (opts = {}, first = 'sort') => {
  function L(props) { return TaskList(props) }
  L.initialState = { tasks: TASKS }
  const s = sortable({ from: 'tasks', item: '.task', handle: '.grip' }), u = undo({ key: 'tasks', ...opts })
  L.uses = first === 'sort' ? { sort: s, history: u } : { history: u, sort: s }
  L.model = { ADD }
  return L
}
const lift = async (id, at = (s) => s) => { grip(id).focus(); press(' '); await t.next(s => at(s).sort?.dragging === String(id)) }
const key = async (k, at = (s) => s) => {
  const b = order(at(t.state))
  // a reorder may move the focused node (jsdom then drops the focus; the drag keeps going)
  if (document.activeElement === document.body) grip(at(t.state).sort.dragging).focus()
  press(k); await t.next(s => order(at(s)) !== b)
}
const drop = async () => {
  if (document.activeElement === document.body) grip(t.state.sort.dragging).focus()
  press('Enter'); await t.next(s => s.sort.dragging === null); await t.settle()
}
const drag = async (id, k = 'ArrowDown') => { await lift(id); await key(k); await drop() }
const act = async (a, d) => { t.simulateAction(a, d); await t.settle() }

// a sub-list host (sortable only) shown by a page whose actions change its data mid-drag
const Sub = (props) => TaskList(props)
Object.assign(Sub, { uses: { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) } })
function Page({ state }) { return h('div', null, state.show ? h(Sub, { state: 'list' }) : h('p', null, 'hidden')) }
Page.initialState = { show: true, list: { tasks: TASKS } }
const edit = (f) => (s) => ({ ...s, list: { ...s.list, tasks: f(s.list.tasks) } })
Page.model = {
  EDIT: edit(a => a.map(x => x.id == 4 ? { ...x, title: 'D2' } : x)),
  ADD: edit(a => [...a, { id: 5, title: 'E' }]),
  FRONT: edit(a => [a.find(x => x.id == 2), ...a.filter(x => x.id != 2)]),
  GO: (s) => ({ ...s, show: false, list: { ...s.list, tasks: [{ id: 2, title: 'B' }, { id: 5, title: 'E' }, { id: 6, title: 'F' }] } }),
  HIDE: (s) => ({ ...s, show: false }),
}
const L = (s) => s.list

describe('3-O G-504: END restores while the item is where the drag left it', () => {
  it('an item edit (map) mid-drag, then unmounted: the item goes back', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    expect(order(t.state.list)).toBe('1324')
    await act('EDIT')
    expect(t.state.list.tasks[3].title).toBe('D2')
    await act('HIDE')
    expect(order(t.state.list)).toBe('1234')
    expect(t.state.list.tasks[3].title).toBe('D2')
    expect(t.state.list.sort).toMatchObject({ dragging: null, mode: null, origin: null })
  })

  it('an ADD mid-drag, then unmounted: the item goes back, the added entry stays', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    await act('ADD')
    await act('HIDE')
    expect(order(t.state.list)).toBe('12345')
  })

  it('the item moved by another action: the data is left as it is', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    await act('FRONT')
    expect(order(t.state.list)).toBe('2134')
    await act('HIDE')
    expect(order(t.state.list)).toBe('2134')
  })

  it('G-474 still: an action that replaces the list is left as it is', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    await act('GO')
    expect(order(t.state.list)).toBe('256')
  })

  it('a second host mounted after an item edit (its INIT): the item goes back', async () => {
    function Two({ state }) {
      return h('div', null, h('div', null, h(Sub, { state: 'list' })), state.two ? h('div', null, h(Sub, { state: 'list' })) : null)
    }
    Two.initialState = { two: false, list: { tasks: TASKS } }
    Two.model = { EDIT: Page.model.EDIT, TWO: (s) => ({ ...s, two: true }) }
    t = renderComponent(Two, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    await act('EDIT')
    t.simulateAction('TWO')
    await t.next(s => s.two && s.list.sort.dragging === null)
    expect(order(t.state.list)).toBe('1234')
  })
})

describe('3-O G-504 / G-509: UNDO mid-drag, then the drag ends', () => {
  it('UNDO back to the order from before the drag: END leaves it', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    t.simulateAction('ADD'); await t.next(s => s.tasks.length === 5)
    await drag(1)                                       // 21345
    await lift(1); await key('ArrowDown')                // 23145
    await act('history.UNDO')
    expect(order(t.state)).toBe('21345')
    await act('history.UNDO')
    expect(order(t.state)).toBe('12345')
    expect(t.state.sort.dragging).toBe('1')
    // ends the drag (a key from another instance: the END rule): nothing is moved
    t.simulateAction('sort.KEY', { key: ' ', id: '3', n: 42 })
    await t.next(s => s.sort.dragging === '3')
    expect(order(t.state)).toBe('12345')
  })
})

describe('3-O G-505: SYG435 with each item in its own wrapper', () => {
  const make = (view) => {
    function H(props) { return view(props) }
    H.initialState = { tasks: TASKS }
    H.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
    return H
  }
  function W({ state }) { return h('div', { className: 'wrap' }, h('div', { className: 'task', 'data-id': state.id }, h('button', { type: 'button', className: 'grip' }, 'g'))) }

  it('a sorted Collection of wrapped items is reported, once', async () => {
    t = renderComponent(make(() => h('div', null, h(Collection, { of: W, from: 'tasks', sort: (a, b) => b.id - a.id }))), { dom: 'real' })
    await t.ready()
    await lift(1)
    press('Escape'); await t.next(s => s.sort.dragging === null)
    await lift(2)
    expect(diagnostics('SYG435')).toHaveLength(1)
  })

  it('table rows (the id on a cell\'s element) in another order are reported', async () => {
    const row = (x) => h('tr', null, h('td', null, h('span', { className: 'task', 'data-id': x.id }, h('button', { type: 'button', className: 'grip' }, 'g'))))
    t = renderComponent(make(({ state }) => h('table', null, h('tbody', null, ...[...state.tasks].reverse().map(row)))), { dom: 'real' })
    await t.ready()
    await lift(3)
    expect(diagnostics('SYG435')).toHaveLength(1)
  })

  it('wrapped items in the array\'s order, with a matching id elsewhere: nothing', async () => {
    t = renderComponent(make(() => h('div', null,
      h('aside', null, h('div', { className: 'task', 'data-id': 4 }, 'D (selected)')),
      h('div', null, h(Collection, { of: W, from: 'tasks' })))), { dom: 'real' })
    await t.ready()
    await lift(2)
    expect(diagnostics('SYG435')).toHaveLength(0)
  })
})

describe('3-O G-506: track leaving the drags out', () => {
  it('UNDO mid-drag undoes the tracked ADD, not the untracked drag', async () => {
    t = renderComponent(withUndo({ track: ['ADD'] }), { dom: 'real' }); await t.ready()
    await act('ADD')
    await lift(2); await key('ArrowDown')
    expect(order(t.state)).toBe('13245')
    expect(t.state.history.base).toBe(undefined)
    await act('history.UNDO')
    expect(order(t.state)).toBe('1234')
    expect(future()).toEqual(['13245'])
  })

  it('a tracked ADD mid-drag records the order it changed (the drag so far included)', async () => {
    t = renderComponent(withUndo({ track: ['ADD'] }), { dom: 'real' }); await t.ready()
    await lift(2); await key('ArrowDown')
    await act('ADD')
    await drop()
    expect(past()).toEqual(['1324'])
    await act('history.UNDO')
    expect(order(t.state)).toBe('1324')
  })
})
