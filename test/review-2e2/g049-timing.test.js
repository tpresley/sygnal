// 2E-2 regression tests (PLAN-1 Phase 2 close-review fixes): renderComponent timing.
// G-049: an event for a not-yet-rendered selector waits for it, then targets the first match
//        (never every listener with that selector string)
// G-039: an event for a just-mounted child waits until the child's intent is subscribed
// G-047: waitForState / next resolve after the whole tree (children too) rendered the state
// G-041: next() matches only states emitted after the call; waitForState matches history
// settle(): resolves once nothing is pending
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { Collection } from '../../src/collection.js'
import { Portal } from '../../src/portal.js'
import { wait, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

// a kanban-like board: Enter in a lane's .new-task-input adds a task to THAT lane
function Lane({ state }) {
  return h('section', { className: 'lane' },
    h('h2', null, state.title),
    h(Collection, { of: Task, from: 'tasks', className: 'tasks' }),
    state.adding
      ? h('input', { className: 'new-task-input' })
      : h('button', { className: 'add-task-btn' }, '+'))
}
Lane.intent = ({ DOM }) => ({
  SHOW_ADD: DOM.click('.add-task-btn'),
  ADD: DOM.keydown('.new-task-input').filter(e => e.key === 'Enter').map(e => e.target.value),
})
Lane.model = {
  SHOW_ADD: s => ({ ...s, adding: true }),
  ADD: (s, title) => ({ ...s, adding: false, tasks: [...s.tasks, { id: `${s.id}-${s.tasks.length}`, title }] }),
}
function Task({ state }) { return h('li', { className: 'task' }, state.title) }

function Board() { return h('main', null, h(Collection, { of: Lane, from: 'lanes' })) }
Board.initialState = {
  lanes: ['todo', 'doing', 'review', 'done'].map(id => ({ id, title: id, adding: false, tasks: [] })),
}
const tasksPerLane = s => s.lanes.map(l => l.tasks.length)

describe('G-049: simulateEvent on a selector that is not rendered yet', () => {
  it('Enter on .new-task-input only affects one lane', async () => {
    const t = renderComponent(Board)
    await t.ready()
    t.simulateEvent('.add-task-btn', 'click')
    // the input isn't rendered yet: the event waits for it instead of reaching all four lanes
    t.simulateEvent('.new-task-input', 'keydown', { key: 'Enter', value: 'Write tests' })
    const s = await t.waitForState(s => s.lanes[0].tasks.length === 1)
    await t.settle()
    expect(tasksPerLane(t.states.at(-1))).toEqual([1, 0, 0, 0])
    expect(s.lanes[0].tasks[0].title).toBe('Write tests')
    expect(t.html()).toContain('<li class="task">Write tests</li>')
    t.expectNoDiagnostics()
    t.dispose()
  })

  it('an element that never renders: SYG103 and the event is dropped', async () => {
    const t = renderComponent(Board)
    await t.ready()
    t.simulateEvent('.new-task-input', 'keydown', { key: 'Enter', value: 'nowhere' })
    await t.settle()
    expect(tasksPerLane(t.states.at(-1))).toEqual([0, 0, 0, 0])
    const d = t.diagnostics.filter(d => d.code === 'SYG103')
    expect(d.map(x => x.data)).toEqual([{ selector: '.new-task-input', type: 'keydown' }])
    expect(d[0].message).toMatch(/dropped/)
    t.dispose()
  })

  it('finds elements inside a <Portal> (rendered elsewhere, kept on the placeholder)', async () => {
    function Modal({ state }) {
      return h('div', null, h('div', { id: 'target' }),
        h(Portal, { target: '#target' }, h('button', { className: 'in-portal' }, String(state.n))))
    }
    Modal.initialState = { n: 0 }
    Modal.intent = ({ DOM }) => ({ HIT: DOM.select('.in-portal').events('click') })
    Modal.model = { HIT: s => ({ ...s, n: s.n + 1 }) }
    const t = renderComponent(Modal)
    t.simulateEvent('.in-portal', 'click')
    await t.waitForState(s => s.n === 1, 1000)
    expect(t.diagnostics.filter(d => d.code === 'SYG103')).toEqual([])
    t.dispose()
  })

  it("'document' still goes to DOM.select('document') listeners", async () => {
    function Doc({ state }) { return h('div', null, String(state.n)) }
    Doc.initialState = { n: 0 }
    Doc.intent = ({ DOM }) => ({ KEY: DOM.select('document').events('keydown') })
    Doc.model = { KEY: s => ({ ...s, n: s.n + 1 }) }
    const t = renderComponent(Doc)
    t.simulateEvent('document', 'keydown', { key: 'a' })
    await t.waitForState(s => s.n === 1)
    expect(t.diagnostics.filter(d => d.code === 'SYG103')).toEqual([])
    t.dispose()
  })
})

describe('G-039: events to a just-mounted child', () => {
  function Panel({ state }) { return h('div', { className: 'panel' }, h('button', { className: 'panel-btn' }, String(state.n))) }
  Panel.intent = ({ DOM }) => ({ INC: DOM.click('.panel-btn') })
  Panel.model = { INC: s => ({ ...s, n: s.n + 1 }) }
  function App({ state }) { return h('main', null, state.open ? h(Panel, { state: 'panel' }) : h('p', null, 'closed')) }
  App.initialState = { open: false, panel: { n: 0 } }
  App.model = { OPEN: s => ({ ...s, open: true }) }

  it('is delivered once the child has subscribed, even right after it rendered', async () => {
    const t = renderComponent(App)
    await t.ready()
    // click as soon as a render contains the child's button: its view is there before its
    // intent subscribes
    let sent = false
    t.dom$.addListener({ next: () => {
      if (!sent && t.html().includes('panel-btn')) { sent = true; t.simulateEvent('.panel-btn', 'click') }
    } })
    t.simulateAction('OPEN')
    const s = await t.waitForState(s => s.panel.n === 1, 1000)
    expect(s.panel.n).toBe(1)
    t.dispose()
  })

  it('a new Collection item (with BOOTSTRAP) gets an event sent as soon as it renders', async () => {
    function Row({ state }) { return h('li', null, h('button', { className: `inc inc-${state.id}` }, String(state.n))) }
    Row.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
    // BOOTSTRAP delays the item's action stream (and so its intent subscription) by 10ms
    Row.model = { BOOTSTRAP: { EFFECT: () => {} }, INC: s => ({ ...s, n: s.n + 1 }) }
    function Rows() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    Rows.initialState = { rows: [{ id: 1, n: 0 }] }
    Rows.model = { ADD: s => ({ ...s, rows: [...s.rows, { id: s.rows.length + 1, n: 0 }] }) }
    const t = renderComponent(Rows)
    await t.ready()
    let sent = false
    t.dom$.addListener({ next: () => {
      if (!sent && t.html().includes('inc-2')) { sent = true; t.simulateEvent('.inc-2', 'click') }
    } })
    t.simulateAction('ADD')
    const s = await t.waitForState(s => s.rows[1]?.n === 1, 1000)
    expect(s.rows.map(r => r.n)).toEqual([0, 1])
    t.dispose()
  })

  it('works without any waiting between the calls', async () => {
    const t = renderComponent(App)
    t.simulateAction('OPEN')
    t.simulateEvent('.panel-btn', 'click')
    t.simulateEvent('.panel-btn', 'click')
    await t.waitForState(s => s.panel.n === 2, 1000)
    t.dispose()
  })
})

describe('G-047 / G-041: waitForState, next and settle', () => {
  function Item({ state }) { return h('li', { className: 'item' }, `${state.label}:${state.n}`) }
  function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
  List.initialState = { count: 0, items: [{ id: 1, label: 'a', n: 0 }] }
  List.model = {
    ADD: s => ({ ...s, items: [...s.items, { id: s.items.length + 1, label: String.fromCharCode(97 + s.items.length), n: 0 }] }),
    BUMP: s => ({ ...s, items: s.items.map(i => ({ ...i, n: i.n + 1 })) }),
    RESET: s => ({ ...s, count: 0 }),
    INC: s => ({ ...s, count: s.count + 1 }),
  }

  it('waitForState resolves after new Collection items rendered (html() is current)', async () => {
    const t = renderComponent(List)
    await t.ready()
    for (let i = 0; i < 5; i++) {
      t.simulateAction('ADD')
      const s = await t.waitForState(s => s.items.length === i + 2)
      expect(t.html()).toContain(`<li class="item">${s.items.at(-1).label}:0</li>`)
      t.simulateAction('BUMP')
      const b = await t.next(s => s.items[0].n === i + 1)
      expect(t.html()).toContain(`<li class="item">${b.items.at(-1).label}:1</li>`)
    }
    t.dispose()
  })

  it('next() ignores history, waitForState matches it', async () => {
    const t = renderComponent(List)
    await t.ready()
    t.simulateAction('INC')
    await t.waitForState(s => s.count === 1)
    // count === 0 is in the history (the initial state)
    const old = await t.waitForState(s => s.count === 0)
    expect(old).toBe(t.states[0])
    const pending = t.next(s => s.count === 0)
    let resolved = false
    pending.then(() => { resolved = true })
    await wait(30)
    expect(resolved).toBe(false)
    t.simulateAction('RESET')
    const s = await pending
    expect(s).toBe(t.states.at(-1))
    expect(t.states.indexOf(s)).toBeGreaterThan(1)
    // next() with no predicate: the next state
    t.simulateAction('INC')
    expect((await t.next()).count).toBe(1)
    await expect(t.next(s => s.count === 99, 50)).rejects.toThrow(/next timed out after 50ms/)
    t.dispose()
  })

  it('settle() waits for queued input and the renders it causes', async () => {
    const t = renderComponent(List)
    t.simulateAction('ADD')
    t.simulateAction('ADD')
    t.simulateAction('BUMP')
    await t.settle()
    expect(t.states.at(-1).items.map(i => i.n)).toEqual([1, 1, 1])
    expect(t.html()).toBe('<ul><div><li class="item">a:1</li><li class="item">b:1</li><li class="item">c:1</li></div></ul>')
    t.dispose()
  })

  it('settle() rejects when the app never calms down', async () => {
    function Ticker({ state }) { return h('p', null, String(state.n)) }
    Ticker.initialState = { n: 0 }
    Ticker.model = { TICK: { STATE: s => ({ ...s, n: s.n + 1 }), EFFECT: (_s, _d, next) => next('TICK', null, 5) } }
    const t = renderComponent(Ticker)
    t.simulateAction('TICK')
    await expect(t.settle(200)).rejects.toThrow(/settle timed out after 200ms/)
    t.dispose()
  })
})
