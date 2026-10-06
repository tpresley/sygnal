// @vitest-environment jsdom
// PLAN-5 3-P (D219): a cancelled or interrupted keyboard drag (Escape, END on unmount, INIT, a key
// or press over drag state another instance started) puts back the lists it lifted from only when
// they are exactly the arrays its last step made; after any other change (undo, an edit, an
// insert, new data, another tab's slice) the item stays where it is and the drag just ends. undo()
// is told the gesture ended (G-510), and a base belongs to the behavior that opened it (G-514).
// Each 3-O review probe (G-511…G-516) is a case here.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { renderComponent, Collection, sortable, undo, persist, defineBehavior, ABORT } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { setupChecks } from './diagnostics/helpers.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })
const order = (s, k = 'tasks') => s[k].map(x => x.id).join('')
const press = (k, o = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))

function Task({ state }) {
  return h('li', { className: 'task', 'data-id': state.id },
    h('button', { type: 'button', className: 'grip' }, '⠿'), h('span', null, state.title))
}
function TaskList({ state }) {
  return h('section', null, h('ul', null, h(Collection, { of: Task, from: 'tasks' })), h('p', { className: 'say', role: 'status' }, state.sort?.message))
}
const TASKS = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 3, title: 'C' }, { id: 4, title: 'D' }]
const grip = (id) => document.querySelector(`.task[data-id="${id}"] .grip`)
const ids = (a) => a.map(x => x.id).join('')
const hist = (s) => ({ past: s.history.past.map(ids), future: s.history.future.map(ids), base: s.history.base })
const ADD = (st) => ({ ...st, tasks: [...st.tasks, { id: st.tasks.length + 1, title: 'N' }] })
const ME = (s) => s

const withUndo = (opts = {}) => {
  function U(props) { return TaskList(props) }
  U.initialState = { tasks: TASKS }
  U.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }), history: undo({ key: 'tasks', ...opts }) }
  U.model = { ADD }
  return U
}
const refocus = (at) => { if (document.activeElement === document.body) grip(at(t.state).sort.dragging).focus() }
const lift = async (id, at = ME) => { grip(id).focus(); press(' '); await t.next(s => at(s).sort?.dragging === String(id)) }
const key = async (k, at = ME) => { const b = order(at(t.state)); refocus(at); press(k); await t.next(s => order(at(s)) !== b) }
const esc = async (at = ME) => { refocus(at); press('Escape'); await t.next(s => at(s).sort.dragging === null); await t.settle() }
const drop = async (at = ME) => { refocus(at); press('Enter'); await t.next(s => at(s).sort.dragging === null); await t.settle() }
const act = async (a, d) => { t.simulateAction(a, d); await t.settle() }

// a sub-list host (sortable only) shown by a page whose actions change its data mid-drag
const Sub = (props) => TaskList(props)
Object.assign(Sub, { uses: { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) } })
function Page({ state }) { return h('div', null, state.show ? h(Sub, { state: 'list' }) : h('p', null, 'hidden')) }
Page.initialState = { show: true, list: { tasks: TASKS } }
const edit = (f) => (s) => ({ ...s, list: { ...s.list, tasks: f(s.list.tasks) } })
const by = (...n) => (a) => n.map(i => a.find(x => x.id == i) || { id: i, title: 'X' + i })
Page.model = {
  PREPEND: edit(a => [{ id: 9, title: 'Z' }, ...a]),
  DEL1: edit(a => a.filter(x => x.id != 1)),
  SHUF: edit(by(4, 3, 1, 2)),
  NEW: edit(by(5, 6, 2)),
  R4123: edit(by(4, 1, 2, 3)),
  SAME: edit(a => [...a]),
  HIDE: (s) => ({ ...s, show: false }),
}
const L = (s) => s.list

describe('3-P D219: the drag\'s own arrays are restored', () => {
  it('Escape with nothing else changed: the lists it lifted from come back (the same arrays)', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    const before = t.state.list.tasks
    await lift(2, L); await key('ArrowDown', L); await key('ArrowDown', L)
    await esc(L)
    expect(t.state.list.tasks).toBe(before)
    expect(t.state.list.sort.message).toBe('Reorder cancelled. B is back at position 2 of 4.')
  })

  it('unmounted with nothing else changed: the item goes back', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    await act('HIDE')
    expect(order(t.state.list)).toBe('1234')
  })

  it('a copy of the list (same entries, another array): the item stays, the drag ends', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    await act('SAME')
    await esc(L)
    expect(order(t.state.list)).toBe('1324')
    expect(t.state.list.sort.message).toBe('Reorder cancelled. The list changed, so B stays at position 3 of 4.')
  })
})

// G-511 / G-513 (probes a A1–A3, b C1–C2): the item stays where the other action left it
describe('3-P G-511 / G-513: another change mid-drag, then Escape or unmount', () => {
  const cases = [
    { name: 'an entry inserted before it (A1)', action: 'PREPEND', end: '91324' },
    { name: 'an entry before it removed (A2)', action: 'DEL1', end: '324' },
    { name: 'the list reordered by another action (A3)', action: 'SHUF', end: '4312' },
    { name: 'the list replaced, the item at the drag\'s index by chance (C1)', action: 'NEW', end: '562' },
    { name: 'another action\'s order, the item at the drag\'s index by chance (C2)', action: 'R4123', end: '4123' },
  ]
  for (const c of cases) {
    for (const how of ['Escape', 'unmount']) {
      it(`${c.name}, then ${how}: ${c.end}`, async () => {
        t = renderComponent(Page, { dom: 'real' }); await t.ready()
        await lift(2, L); await key('ArrowDown', L)          // 1324
        await act(c.action)
        if (how === 'Escape') await esc(L); else await act('HIDE')
        expect(order(t.state.list)).toBe(c.end)
        expect(t.state.list.sort).toMatchObject({ dragging: null, mode: null, origin: null })
      })
    }
  }
})

describe('3-P G-511 / G-512: undo or redo mid-drag, then the drag ends', () => {
  it('UNDO×2 mid-drag, then Escape (B1): the undone order stays, redo still has both', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await lift(1); await key('ArrowDown'); await drop()  // 2134
    await lift(1); await key('ArrowUp')                    // 1234
    await act('history.UNDO'); await act('history.UNDO')
    expect(order(t.state)).toBe('1234')
    await esc()
    expect(order(t.state)).toBe('1234')
    expect(hist(t.state)).toEqual({ past: [], future: ['2134', '1234'], base: undefined })
    await act('ADD')
    expect(hist(t.state).past).toEqual(['1234'])
    await act('history.UNDO')
    expect(order(t.state)).toBe('1234')
  })

  it('REDO mid-drag, then Escape (B2): the drag\'s own array, so it goes back; the cancel is one step', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await lift(1); await key('ArrowDown')                  // 2134
    await act('history.UNDO'); await act('history.REDO')
    expect(order(t.state)).toBe('2134')
    await esc()
    expect(order(t.state)).toBe('1234')
    expect(hist(t.state)).toEqual({ past: ['1234', '2134'], future: [], base: undefined })
    await act('ADD')
    expect(hist(t.state).past).toEqual(['1234', '2134', '1234'])
    await act('history.UNDO'); expect(order(t.state)).toBe('1234')
    await act('history.UNDO'); expect(order(t.state)).toBe('2134')
  })

  it('UNDO×2 mid-drag, then a key from another instance (B3): nothing moves, nothing pending', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await lift(1); await key('ArrowDown'); await drop()
    await lift(1); await key('ArrowUp')
    await act('history.UNDO'); await act('history.UNDO')
    t.simulateAction('sort.KEY', { key: ' ', id: '3', n: 42 })
    await t.next(s => s.sort.dragging === '3')
    expect(order(t.state)).toBe('1234')
    expect(hist(t.state)).toEqual({ past: [], future: ['2134', '1234'], base: undefined })
  })

  it('UNDO×2 mid-drag, then a drop (B4): it drops where it is; undo records nothing', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await lift(1); await key('ArrowDown'); await drop()
    await lift(1); await key('ArrowUp')
    await act('history.UNDO'); await act('history.UNDO')
    await drop()
    expect(order(t.state)).toBe('1234')
    expect(hist(t.state)).toEqual({ past: [], future: ['2134', '1234'], base: undefined })
  })

  it('a sub-host with undo: drop, re-lift, move, UNDO×2, unmount (G1): the undone order stays', async () => {
    const SubU = (props) => h('div', null, h('button', { type: 'button', className: 'undo' }, 'u'), TaskList(props))
    SubU.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }), history: undo({ key: 'tasks', undo: '.undo' }) }
    function Pg({ state }) { return h('div', null, state.show ? h(SubU, { state: 'list' }) : h('p', null, 'x')) }
    Pg.initialState = { show: true, list: { tasks: TASKS } }
    Pg.model = { HIDE: (s) => ({ ...s, show: false }) }
    t = renderComponent(Pg, { dom: 'real' }); await t.ready()
    await lift(1, L); await key('ArrowDown', L); await drop(L)
    await lift(1, L); await key('ArrowUp', L)
    const u = async () => { document.querySelector('.undo').click(); await t.settle() }
    await u(); await u()
    expect(order(t.state.list)).toBe('1234')
    await act('HIDE')
    expect(order(t.state.list)).toBe('1234')
    expect(hist(t.state.list)).toEqual({ past: [], future: ['2134', '1234'], base: undefined })
  })
})

describe('3-P G-510: undo settles when a drag ends without a drop', () => {
  it('lift, move, a recorded ADD, Escape: the item stays, nothing pending; the next change is its own step', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await lift(1); await key('ArrowDown')                  // 2134
    await act('ADD')                                       // 21345
    await esc()
    expect(order(t.state)).toBe('21345')
    expect(t.state.history.base).toBe(undefined)
    await lift(3); await key('ArrowDown'); await drop()   // 21435
    expect(hist(t.state).past).toEqual(['1234', '21345'])
  })

  it('an untracked change mid-drag, then Escape: the stale base is dropped, nothing recorded', async () => {
    t = renderComponent(withUndo({ track: ['sort.DROPPED'] }), { dom: 'real' }); await t.ready()
    await lift(1); await key('ArrowDown')                  // 2134, base pending
    await act('ADD')                                       // untracked: 21345
    await esc()
    expect(order(t.state)).toBe('21345')
    expect(hist(t.state)).toEqual({ past: [], future: [], base: undefined })
  })

  it('a multi-list drag whose other list changed, then unmounted: the move is recorded, nothing pending', async () => {
    const SubB = ({ state }) => h('div', null,
      h('ul', { 'data-list': 'a' }, h(Collection, { of: Task, from: 'a' })),
      h('ul', { 'data-list': 'b' }, h(Collection, { of: Task, from: 'b' })))
    SubB.uses = { sort: sortable({ from: ['a', 'b'], item: '.task', handle: '.grip' }), history: undo({ key: 'a' }) }
    function Pg({ state }) { return h('div', null, state.show ? h(SubB, { state: 'board' }) : null) }
    Pg.initialState = { show: true, board: { a: [{ id: 1 }, { id: 2 }], b: [{ id: 3 }] } }
    Pg.model = { HIDE: (s) => ({ ...s, show: false }), B: (s) => ({ ...s, board: { ...s.board, b: [...s.board.b, { id: 7 }] } }) }
    const B = (s) => s.board
    t = renderComponent(Pg, { dom: 'real' }); await t.ready()
    await lift(1, B); await key('ArrowDown', (s) => ({ ...s.board, tasks: s.board.a }))
    expect(ids(t.state.board.a)).toBe('21')
    expect(t.state.board.sort.mode).toBe('keyboard'); expect(t.state.board.history.base).toBeTruthy()
    await act('B'); expect(t.state.board.sort.mode).toBe('keyboard'); await act('HIDE')
    expect(ids(t.state.board.a)).toBe('21')
    expect(t.state.board.history.past.map(ids)).toEqual(['12'])
    expect(t.state.board.history.base).toBe(undefined)
  })
})

describe('3-P G-514: a base belongs to the gesture behavior that opened it', () => {
  it('another gesture behavior\'s completing action doesn\'t commit it (E1)', async () => {
    const nudge = defineBehavior({ initialState: {}, undoStep: ['DONE'],
      model: { RIGHT: { HOST: (st) => ({ ...st, tasks: [...st.tasks.slice(1), st.tasks[0]] }) }, DONE: ABORT } })
    function P2(props) { return TaskList(props) }
    P2.initialState = { tasks: TASKS }
    P2.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }), n: nudge(), history: undo({ key: 'tasks' }) }
    t = renderComponent(P2, { dom: 'real' }); await t.ready()
    await act('n.RIGHT')
    expect(order(t.state)).toBe('2341')
    await act('sort.DROPPED', { id: 'x' })
    expect(hist(t.state).past).toEqual([])
    expect(t.state.history.base).toBeTruthy()
    await act('n.DONE')
    expect(hist(t.state)).toEqual({ past: ['1234'], future: [], base: undefined })
  })
})

describe('3-P G-516: another tab\'s drag state (persist sync) never moves items here', () => {
  it('a synced mid-drag slice, then a key here: the other tab\'s order stays', async () => {
    let fire
    const store = { data: {}, getItem: (k) => store.data[k] ?? null, setItem: (k, v) => { store.data[k] = v }, removeItem: (k) => { delete store.data[k] }, subscribe: (fn) => { fire = fn; return () => {} } }
    function Root({ state }) { return h('div', null, h(Sub, { state: 'list' })) }
    Root.initialState = { list: { tasks: TASKS } }
    Root.persist = persist({ key: 'board', storage: store, sync: true, debounceMs: 0 })
    t = renderComponent(Root, { dom: 'real' }); await t.ready()
    const other = { list: { tasks: by(1, 3, 2, 4)(TASKS),
      sort: { dragging: '2', over: null, after: false, list: null, mode: 'keyboard', press: null, origin: { list: 'tasks', index: 1, n: 0.5, at: ['tasks', 2] }, message: '' } } }
    fire('board', JSON.stringify({ version: 1, state: other }))
    await t.next(s => s.list.sort.dragging === '2')
    expect(order(t.state.list)).toBe('1324')
    await lift(3, L)
    expect(order(t.state.list)).toBe('1324')
    await esc(L)
    expect(order(t.state.list)).toBe('1324')
  })
})

describe('3-P G-515: several lists with undo', () => {
  function Card({ state }) { return h('li', { className: 'task', 'data-id': state.id }, h('button', { type: 'button', className: 'grip' }, state.id)) }
  function Board() {
    return h('div', null,
      h('ul', { 'data-list': 'todo' }, h(Collection, { of: Card, from: 'todo' })),
      h('ul', { 'data-list': 'done' }, h(Collection, { of: Card, from: 'done' })))
  }
  Board.initialState = { todo: [{ id: 1 }, { id: 2 }], done: [{ id: 3 }] }
  Board.uses = { sort: sortable({ from: ['todo', 'done'], item: '.task', handle: '.grip' }), history: undo({ key: ['todo', 'done'] }) }
  const both = (s) => ids(s.todo) + '|' + ids(s.done)
  const step = async (k) => { const b = both(t.state); refocus(ME); press(k); await t.next(s => both(s) !== b) }

  it('undo({ key: [\'todo\', \'done\'] }): a move between lists is one step; UNDO / REDO restore both lists', async () => {
    t = renderComponent(Board, { dom: 'real' }); await t.ready()
    await lift(2); await step('ArrowRight')
    expect(both(t.state)).toBe('1|32')
    expect(t.state.history.past).toEqual([])
    await drop()
    expect(t.state.history.past).toEqual([{ todo: Board.initialState.todo, done: Board.initialState.done }])
    await act('history.UNDO')
    expect(both(t.state)).toBe('12|3')
    await act('history.REDO')
    expect(both(t.state)).toBe('1|32')
  })

  it('Escape after a move between lists: both lists come back, nothing recorded', async () => {
    t = renderComponent(Board, { dom: 'real' }); await t.ready()
    await lift(2); await step('ArrowRight')
    await esc()
    expect(both(t.state)).toBe('12|3')
    expect(hist({ history: t.state.history })).toEqual({ past: [], future: [], base: undefined })
  })
})

describe('3-P: duplicate ids (F1)', () => {
  it('a repeated id, unmounted mid-drag: the snapshot comes back exactly (no index math)', async () => {
    const Sub2 = ({ state }) => h('ul', null, ...state.tasks.map(x => h('li', { className: 'task', 'data-id': x.id }, h('button', { type: 'button', className: 'grip' }, x.title))))
    Sub2.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
    function Pg({ state }) { return h('div', null, state.show ? h(Sub2, { state: 'list' }) : h('p', null, 'x')) }
    Pg.initialState = { show: true, list: { tasks: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }, { id: 2, title: 'B2' }, { id: 3, title: 'C' }] } }
    Pg.model = { HIDE: (s) => ({ ...s, show: false }) }
    t = renderComponent(Pg, { dom: 'real' }); await t.ready()
    const before = t.state.list.tasks
    document.querySelectorAll('.task[data-id="2"] .grip')[0].focus(); press(' ')
    await t.next(s => s.list.sort.dragging === '2')
    press('ArrowDown'); await t.next(s => s.list.tasks !== before)
    expect(t.state.list.tasks.map(x => x.title).join()).toBe('A,B2,B,C')
    expect(t.state.list.sort.dragging).toBe('2')
    expect(t.state.list.tasks).not.toBe(before)
    await act('HIDE')
    expect(t.state.list.tasks).toBe(before)
  })
})
