// PLAN-4 2-A GS-4: a STATE reducer returning the identical object it received is "no change"
// (ABORT): no state emission, no render. SYG222 (dev entry) flags an in-place mutation that the
// same-object return would hide. SYG502 (strict) is retired.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { configureStrict } from '../src/extra/diagnostics/checks/index.js'
import { configureDiagnostics } from '../src/extra/diagnostics/index.js'
import { getCodeInfo } from '../src/extra/diagnostics/checks/index.js'
import { CODE_TITLES, STRICT_CODE_SEVERITY, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'

// A stand-in for immer's curried produce (immer is not a dependency): the recipe edits a deep
// copy; when nothing changed the BASE object is returned, as immer does
const produce = (recipe) => (base, ...args) => {
  const draft = JSON.parse(JSON.stringify(base))
  recipe(draft, ...args)
  return JSON.stringify(draft) === JSON.stringify(base) ? base : draft
}

let t
beforeEach(() => { setupChecks() })
afterEach(() => { t?.dispose(); t = null; configureStrict(undefined) })

describe('GS-4: the same object returned = no change', () => {
  it('X1: immer-style produce reducers incl. calculated fields and Collection item writes; a no-op adds 0 states', async () => {
    function Item({ state }) { return h('li', { className: 'item' }, state.text, state.done ? ' ✓' : '', h('button', { className: 'done' }, 'done')) }
    Item.intent = ({ DOM }) => ({ DONE: DOM.click('.done') })
    Item.model = { DONE: produce((d) => { d.done = true }) }

    function Todos({ state }) {
      return h('div', null, h('input', { className: 'draft', value: state.draft }), h('button', { className: 'add' }, 'add'), h('button', { className: 'noop' }, 'noop'),
        h('span', { className: 'count' }, String(state.remaining)), h(Collection, { of: Item, from: 'todos' }))
    }
    Todos.initialState = { draft: '', nextId: 1, todos: [] }
    Todos.calculated = { remaining: (s) => s.todos.filter(x => !x.done).length }
    Todos.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value(), ADD: DOM.click('.add'), NOOP: DOM.click('.noop') })
    Todos.model = {
      DRAFT: produce((d, v) => { d.draft = v }),
      ADD: produce((d) => { d.todos.push({ id: d.nextId++, text: d.draft, done: false }); d.draft = '' }),
      NOOP: produce(() => {}),
    }

    t = renderComponent(Todos, { dom: 'real' })
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'a' }); await t.next(s => s.draft === 'a')
    t.simulateEvent('.add', 'click'); await t.next(s => s.todos.length === 1)
    expect(t.state.remaining).toBe(1)
    t.simulateEvent('.done', 'click'); await t.next(s => s.todos[0].done)
    expect(t.state.remaining).toBe(0)
    const n = t.states.length
    t.simulateEvent('.noop', 'click'); await t.settle()
    expect(t.states.length - n).toBe(0)
    expect(t.query('.count').textContent).toBe('0')
  })

  it('`return state` emits no state and does not call the view again', async () => {
    let views = 0
    function App({ state }) { views++; return h('div', null, String(state.count)) }
    App.initialState = { count: 0 }
    App.model = { SAME: (state) => state, INC: (state) => ({ ...state, count: state.count + 1 }) }
    t = renderComponent(App)
    await t.ready(); await t.settle()
    const states = t.states.length, renders = views
    t.simulateAction('SAME'); await t.settle()
    expect(t.states.length).toBe(states)
    expect(views).toBe(renders)
    t.simulateAction('INC'); await t.next(s => s.count === 1)
    expect(t.states.length).toBe(states + 1)
  })

  it('with calculated fields: returning the (enhanced) state it got is no change too', async () => {
    function App({ state }) { return h('div', null, String(state.double)) }
    App.initialState = { count: 2 }
    App.calculated = { double: (s) => s.count * 2 }
    App.model = { SAME: (state) => state }
    t = renderComponent(App)
    await t.ready(); await t.settle()
    const n = t.states.length
    t.simulateAction('SAME'); await t.settle()
    expect(t.states.length).toBe(n)
  })

  it('a Collection item returning its own state object changes nothing upstream', async () => {
    let itemViews = 0
    function Row({ state }) { itemViews++; return h('li', { className: 'row' }, state.text) }
    Row.intent = ({ DOM }) => ({ TOUCH: DOM.click('.row') })
    Row.model = { TOUCH: (state) => state }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }
    t = renderComponent(List, { dom: 'real' })
    await t.ready(); await t.settle()
    const n = t.states.length, renders = itemViews
    t.simulateEvent('.row', 'click'); await t.settle()
    expect(t.states.length).toBe(n)
    expect(itemViews).toBe(renders)
  })

  it('other sinks are unchanged: a non-STATE sink still sends the same object', async () => {
    function App({ state }) { return h('div', null, String(state.count)) }
    App.initialState = { count: 0 }
    App.model = { GO: { STATE: (state) => state, OUT: (state) => state } }
    t = renderComponent(App)
    await t.ready()
    t.simulateAction('GO'); await t.settle()
    expect(t.sinkValues('OUT')).toHaveLength(1)
    expect(t.sinkValues('OUT')[0]).toMatchObject({ count: 0 })
  })
})

describe('GS-4: SYG222 (dev entry) — the same object returned after an in-place mutation', () => {
  it('reports the mutation and does not re-render', async () => {
    let views = 0
    function Counter({ state }) { views++; return h('div', null, String(state.count)) }
    Counter.initialState = { count: 0 }
    Counter.model = { BUMP: (state) => { state.count++; return state } }
    t = renderComponent(Counter)
    await t.ready(); await t.settle()
    const n = t.states.length, renders = views
    t.simulateAction('BUMP'); await t.settle()
    expect(t.states.length).toBe(n)
    expect(views).toBe(renders)
    const found = diagnostics('SYG222')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'warn', component: 'Counter', data: { action: 'BUMP', keys: ['count'] } })
    expect(found[0].fix).toMatch(/new object/)
  })

  it('sees an added or a deleted key, in a Collection item too', async () => {
    function Row({ state }) { return h('li', { className: 'row' }, state.text) }
    Row.intent = ({ DOM }) => ({ TAG: DOM.click('.row') })
    Row.model = { TAG: (state) => { state.tagged = true; return state } }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 1, text: 'a' }] }
    List.model = { DROP: (state) => { delete state.rows; return state } }
    t = renderComponent(List, { dom: 'real' })
    await t.ready(); await t.settle()
    t.simulateEvent('.row', 'click'); await t.settle()
    t.simulateAction('DROP'); await t.settle()
    expect(diagnostics('SYG222').map(d => [d.component, d.data.action, d.data.keys])).toEqual([['Row', 'TAG', ['tagged']], ['List', 'DROP', ['rows']]])
  })

  it('does not report a clean same-object return, a new object, or a non-STATE sink', async () => {
    function App({ state }) { return h('div', null, String(state.count)) }
    App.initialState = { count: 0, list: [1] }
    App.model = {
      SAME: (state) => state,
      NEW: (state) => ({ ...state, count: state.count + 1 }),
      // a nested mutation is below the shallow snapshot (documented limit)
      DEEP: (state) => { state.list.push(2); return state },
      OUT: { OUT: (state) => { state.count = 99; return state } },
    }
    t = renderComponent(App)
    await t.ready()
    for (const a of ['SAME', 'NEW', 'DEEP', 'OUT']) t.simulateAction(a)
    await t.settle()
    expect(diagnostics('SYG222')).toEqual([])
  })

  it('reports once per component and action', async () => {
    function App({ state }) { return h('div', null, String(state.count)) }
    App.initialState = { count: 0 }
    App.model = { BUMP: (state) => { state.count++; return state } }
    t = renderComponent(App)
    await t.ready()
    t.simulateAction('BUMP'); t.simulateAction('BUMP'); await t.settle()
    expect(diagnostics('SYG222')).toHaveLength(1)
  })

  it('is not reported with diagnostics off (production): the mutation is just ignored', async () => {
    configureDiagnostics({ mode: 'off' })
    function App({ state }) { return h('div', null, String(state.count)) }
    App.initialState = { count: 0 }
    App.model = { BUMP: (state) => { state.count++; return state } }
    t = renderComponent(App, { diagnostics: 'off' })
    await t.ready(); await t.settle()
    const n = t.states.length
    t.simulateAction('BUMP'); await settle(80)
    expect(t.states.length).toBe(n)
    expect(diagnostics('SYG222')).toEqual([])
  })

  it('is registered as a dev-entry warning', () => {
    expect(DEV_CODE_SEVERITY.SYG222).toBe('warn')
    expect(getCodeInfo('SYG222')).toMatchObject({ severity: 'warn', title: CODE_TITLES.SYG222 })
    expect(CODE_TITLES.SYG222).toMatch(/mutated in place/)
  })
})

describe('GS-4: SYG502 retired', () => {
  it('strict mode no longer reports `return state` (it is the same as ABORT)', async () => {
    function App({ state }) { return h('div', null, String(state.count)) }
    App.initialState = { count: 0 }
    App.model = { GO: (state) => (state.count > 5 ? { ...state, count: 0 } : state) }
    t = renderComponent(App, { strict: true })
    await t.ready()
    t.simulateAction('GO'); await t.settle()
    expect(diagnostics('SYG502')).toEqual([])
  })

  it('keeps its code entry, titled as retired', () => {
    expect(STRICT_CODE_SEVERITY.SYG502).toBe('warn')
    expect(CODE_TITLES.SYG502).toMatch(/retired in 6\.0/i)
  })
})
