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
// (3-U: `key` an array, e.g. ['tasks', 'note'], records the tasks with a note that doesn't change)
const withUndo = (opts = {}, first = 'sort', key = 'tasks') => {
  function L(props) { return TaskList(props) }
  L.initialState = { tasks: TASKS, note: 'n' }
  const s = sortable({ from: 'tasks', item: '.task', handle: '.grip' }), u = undo({ key, ...opts })
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

// 3-P (D219): G-504's "restore while the item is where the drag left it" is gone: any other change to
// the list mid-drag leaves the item where it is at END / INIT (only the drag's own arrays are restored)
describe('3-O G-504, D219: END after another change to the list', () => {
  it('an item edit (map) mid-drag, then unmounted: the item stays where it is, the edit kept', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    expect(order(t.state.list)).toBe('1324')
    await act('EDIT')
    expect(t.state.list.tasks[3].title).toBe('D2')
    await act('HIDE')
    expect(order(t.state.list)).toBe('1324')
    expect(t.state.list.tasks[3].title).toBe('D2')
    expect(t.state.list.sort).toMatchObject({ dragging: null, mode: null, origin: null })
  })

  it('an ADD mid-drag, then unmounted: the item stays where it is', async () => {
    t = renderComponent(Page, { dom: 'real' }); await t.ready()
    await lift(2, L); await key('ArrowDown', L)
    await act('ADD')
    await act('HIDE')
    expect(order(t.state.list)).toBe('13245')
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

  it('a second host mounted after an item edit (its INIT): the item stays where it is', async () => {
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
    expect(order(t.state.list)).toBe('1324')
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

describe('3-O G-509: back where a gesture started, for object values', () => {
  it('a custom undoStep behavior: an object value put back field by field is no step', async () => {
    const nudge = defineBehavior({
      initialState: {},
      undoStep: ['DONE'],
      model: {
        RIGHT: { HOST: (st) => ({ ...st, pos: { ...st.pos, x: st.pos.x + 1 } }) },
        LEFT: { HOST: (st) => ({ ...st, pos: { ...st.pos, x: st.pos.x - 1 } }) },
        DONE: ABORT,
      },
    })
    function P() { return h('div', null, 'p') }
    P.initialState = { pos: { x: 0, y: 0 } }
    P.uses = { n: nudge(), history: undo({ key: 'pos' }) }
    t = renderComponent(P); await t.ready()
    await act('n.RIGHT')
    expect(t.state.history.base).toBeTruthy()
    await act('n.LEFT')
    expect(t.state.pos).toEqual({ x: 0, y: 0 })
    expect(t.state.history.base).toBe(undefined)
    await act('n.DONE')
    expect(t.state.history.past).toEqual([])
    await act('n.RIGHT'); await act('n.DONE')
    expect(t.state.history.past).toEqual([{ x: 0, y: 0 }])
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

describe('3-O G-507: coalesceMs alone doesn\'t join drops', () => {
  it('two quick drags are two steps; coalesce naming the drop joins them', async () => {
    t = renderComponent(withUndo({ coalesceMs: 5000 }), { dom: 'real' }); await t.ready()
    await drag(1); await drag(3)
    expect(past()).toEqual(['1234', '2134'])
    t.dispose()
    t = renderComponent(withUndo({ coalesceMs: 5000, coalesce: ['sort.DROPPED'] }), { dom: 'real' }); await t.ready()
    await drag(1); await drag(3)
    expect(past()).toEqual(['1234'])
  })
})

describe('3-O G-508: REDO mid-drag', () => {
  it('records the order from before the drag (no half-moved step); UNDO then goes back to it', async () => {
    t = renderComponent(withUndo(), { dom: 'real' }); await t.ready()
    await act('ADD'); await act('history.UNDO')
    await lift(2); await key('ArrowDown')
    await act('history.REDO')
    expect(order(t.state)).toBe('12345')
    expect(past()).toEqual(['1234'])
    expect(t.state.history.base).toBe(undefined)
    await act('history.UNDO')
    expect(order(t.state)).toBe('1234')
  })

  it('keeps to limit', async () => {
    t = renderComponent(withUndo({ limit: 1 }), { dom: 'real' }); await t.ready()
    await act('ADD'); await act('history.UNDO')
    await lift(2); await key('ArrowDown')
    await act('history.REDO')
    expect(past()).toEqual(['1234'])
  })
})

// gesture → recorded action → gesture → UNDO×n → REDO×n, under each option; `steps` are run in
// order, then `undo` / `redo` are the orders after each UNDO / REDO (the last one: a no-op)
describe('3-O: undo gesture sequences', () => {
  const run = async (steps) => {
    for (const s of steps) {
      if (s === 'ADD') await act('ADD')
      else if (s === 'lift1' || s === 'lift2') await lift(Number(s[4]))
      else if (s === 'down') await key('ArrowDown')
      else if (s === 'up') await key('ArrowUp')
      else if (s === 'esc') { if (document.activeElement === document.body) grip(t.state.sort.dragging).focus(); press('Escape'); await t.next(x => x.sort.dragging === null); await t.settle() }
      else if (s === 'drop') await drop()
      else if (s === 'undo' || s === 'redo') await act(s === 'undo' ? 'history.UNDO' : 'history.REDO')
      else await drag(Number(s.slice(4)))               // 'drag1', 'drag3'
    }
  }
  const cases = [
    { name: 'defaults', opts: {}, steps: ['drag1', 'ADD', 'drag3'], end: '21435', undo: ['21345', '2134', '1234', '1234'] },
    { name: 'track: [ADD]', opts: { track: ['ADD'] }, steps: ['drag1', 'ADD', 'drag3'], end: '21435', undo: ['2134', '2134'], redo: ['21435', '21435'] },
    { name: 'track: [sort.DROPPED]', opts: { track: ['sort.DROPPED'] }, steps: ['drag1', 'ADD', 'drag3'], end: '21435', undo: ['21345', '1234', '1234'], redo: ['21345', '21435', '21435'] },
    { name: 'limit: 2', opts: { limit: 2 }, steps: ['drag1', 'ADD', 'drag3'], end: '21435', undo: ['21345', '2134', '2134'] },
    { name: 'coalesce: [sort.DROPPED]', opts: { coalesce: ['sort.DROPPED'], coalesceMs: 5000 }, steps: ['drag1', 'drag3', 'ADD'], end: '21435', undo: ['2143', '1234', '1234'] },
    { name: 'coalesceMs alone', opts: { coalesceMs: 5000 }, steps: ['drag1', 'drag3', 'ADD'], end: '21435', undo: ['2143', '2134', '1234', '1234'] },
    { name: 'resetOn: [ADD]', opts: { resetOn: ['ADD'] }, steps: ['drag1', 'ADD', 'drag3'], end: '21435', undo: ['21345', '21345'] },
    { name: 'resetOn: [sort.DROPPED]', opts: { resetOn: ['sort.DROPPED'] }, steps: ['ADD', 'drag1'], end: '21345', undo: ['21345'] },
    { name: 'a recorded action mid-drag', opts: {}, steps: ['lift1', 'down', 'ADD', 'down', 'drop'], end: '23145', undo: ['21345', '1234', '1234'] },
    { name: 'a cancelled drag, then a drag', opts: {}, steps: ['lift1', 'down', 'esc', 'ADD', 'drag2'], end: '13245', undo: ['12345', '1234', '1234'] },
    { name: 'a drag moved back, then dropped', opts: {}, steps: ['ADD', 'lift2', 'down', 'up', 'drop', 'drag3'], end: '12435', undo: ['12345', '1234', '1234'] },
    // 3-P (D219, G-510 / G-512): a drag that ends without a drop restores only its own arrays, and
    // undo settles: nothing is left pending, and the next change is a step of its own
    { name: 'a recorded action mid-drag, then cancelled', opts: {}, steps: ['lift1', 'down', 'ADD', 'esc', 'ADD'], end: '213456', undo: ['21345', '1234', '1234'] },
    { name: 'UNDO twice mid-drag, then cancelled', opts: {}, steps: ['drag1', 'lift1', 'up', 'undo', 'undo', 'esc'], end: '1234', undo: ['1234'], redo: ['2134', '1234', '1234'] },
    { name: 'UNDO and REDO mid-drag, then cancelled', opts: {}, steps: ['lift1', 'down', 'undo', 'redo', 'esc'], end: '1234', undo: ['2134', '1234', '1234'] },
    { name: 'UNDO mid-drag, then dropped', opts: {}, steps: ['lift1', 'down', 'undo', 'drop'], end: '1234', undo: ['1234'], redo: ['2134', '2134'] },
  ]
  // 3-U: also with an array key (D221), whose values compare key by key (G-529)
  for (const key of ['tasks', ['tasks', 'note']]) for (const first of ['sort', 'history']) {
    for (const c of cases) {
      it(`${c.name} (uses: ${first} first${typeof key == 'string' ? '' : ', key: [tasks, note]'})`, async () => {
        t = renderComponent(withUndo(c.opts, first, key), { dom: 'real' }); await t.ready()
        await run(c.steps)
        expect(order(t.state)).toBe(c.end)
        expect(t.state.history.base).toBe(undefined)
        for (const o of c.undo) { await act('history.UNDO'); expect(order(t.state)).toBe(o) }
        const redo = c.redo || [...c.undo.slice(0, -1).reverse().slice(1), c.end, c.end]
        for (const o of redo) { await act('history.REDO'); expect(order(t.state)).toBe(o) }
        expect(t.state.history.future).toEqual([])
        expect(t.state.note).toBe('n')
      })
    }
  }
})
