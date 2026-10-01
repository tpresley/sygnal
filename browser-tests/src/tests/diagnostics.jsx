// Runtime diagnostics checks that need a real DOM (PLAN-1 1A):
//   SYG103 (selector never matched), SYG104 (isolation boundary),
//   plus a zero-false-positive run of the kanban example with every check on.
import { run, Collection, makeDragDriver, getDiagnostics, clearDiagnostics } from 'sygnal'
import { configureChecks, resetChecks, checkEventBus } from 'sygnal/diagnostics'
import KanbanRoot from '../../../examples/kanban/src/RootComponent.jsx'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Diagnostics (1A runtime checks)'

const diags = (code, component) =>
  getDiagnostics().filter(d => (!code || d.code === code) && (!component || d.component === component))

function fresh(timing = {}) {
  resetChecks()
  clearDiagnostics()
  configureChecks({ settleMs: 30, idleMs: 2000, minRenders: 3, ...timing })
}

const fire = (el, type, init = {}) => el.dispatchEvent(new Event(type, { bubbles: true, ...init }))

export async function diagnosticsTests() {
  // ── SYG104 ──────────────────────────────────────────────────────────────
  await runTest(CAT, 'SYG104: parent selector matching only Collection items names the child', async () => {
    fresh()
    const { id, el } = mount()
    function TodoItem({ state }) {
      return (
        <div className="todo">
          <span className="title">{state.title}</span>
          <button className="remove">×</button>
        </div>
      )
    }
    function App({ state }) {
      return <div className="app"><Collection of={TodoItem} from="todos" /><p className="count">{state.todos.length}</p></div>
    }
    App.initialState = { todos: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] }
    App.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') }) // sygnal-ignore SYG104 (deliberate bug: this test asserts the runtime reports SYG104)
    App.model = { REMOVE: (state) => state }
    const app = run(App, {}, { mountPoint: id, diagnostics: 'collect' })
    try {
      await waitFor(() => el.querySelectorAll('.remove').length === 2)
      await waitFor(() => diags('SYG104').length > 0, 1000)
      const [d] = diags('SYG104')
      assert(d.component === 'App', `component: ${d.component}`)
      assert(d.severity === 'warn', `severity: ${d.severity}`)
      assert(d.data.child === 'TodoItem', `child: ${d.data.child}`)
      assert(d.message.includes("DOM.select('.remove') in App matches elements inside TodoItem (isolated)"), d.message)
      assert(d.fix.includes('PARENT') && d.fix.includes('EVENTS'), d.fix)
      assert(diags('SYG104').length === 1, 'reported once')
      assert(diags('SYG103').length === 0, 'no SYG103 for a selector explained by SYG104')
    } finally { app.dispose() }
  })

  await runTest(CAT, 'SYG104: parent selector matching only a sub-component names it', async () => {
    fresh()
    const { id, el } = mount()
    function Toolbar() { return <div className="toolbar"><button className="save">Save</button></div> }
    function Editor() { return <div className="editor"><Toolbar state="toolbar" /></div> }
    Editor.initialState = { toolbar: {} }
    Editor.intent = ({ DOM }) => ({ SAVE: DOM.select('.save').events('click') }) // sygnal-ignore SYG104 (deliberate bug: this test asserts the runtime reports SYG104)
    Editor.model = { SAVE: (state) => state }
    const app = run(Editor, {}, { mountPoint: id, diagnostics: 'collect' })
    try {
      await waitFor(() => el.querySelector('.save'))
      await waitFor(() => diags('SYG104').length > 0, 1000)
      const [d] = diags('SYG104')
      assert(d.component === 'Editor' && d.data.child === 'Toolbar', JSON.stringify(d.data))
    } finally { app.dispose() }
  })

  await runTest(CAT, 'SYG104 negative: own elements match; the fixed version reports nothing', async () => {
    fresh({ idleMs: 200 })
    const { id, el } = mount()
    function TodoItem({ state }) {
      return <div className="todo"><span className="title">{state.title}</span><button className="remove">×</button></div>
    }
    TodoItem.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
    TodoItem.model = { REMOVE: { PARENT: (state) => state.id } }
    function App({ state }) {
      return (
        <div className="app">
          <button className="clear">Clear</button>
          <Collection of={TodoItem} from="todos" />
          <p className="count">{state.todos.length}</p>
        </div>
      )
    }
    App.initialState = { todos: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] }
    App.intent = ({ DOM, CHILD }) => ({
      CLEAR: DOM.click('.clear'),
      REMOVE: CHILD.select(TodoItem),
    })
    App.model = {
      CLEAR: (state) => ({ ...state, todos: [] }),
      REMOVE: (state, id) => ({ ...state, todos: state.todos.filter(t => t.id !== id) }),
    }
    const app = run(App, {}, { mountPoint: id, diagnostics: 'collect' })
    try {
      await waitFor(() => el.querySelectorAll('.remove').length === 2)
      el.querySelector('.remove').click()
      await waitFor(() => el.querySelector('.count')?.textContent === '1')
      await wait(350)
      const found = getDiagnostics().filter(d => d.component === 'App' || d.component === 'TodoItem')
      assert(found.length === 0, found.map(d => d.text).join(' | '))
    } finally { app.dispose() }
  })

  // ── SYG103 ──────────────────────────────────────────────────────────────
  await runTest(CAT, 'SYG103: selector not in the view is info, then warn after 3 renders + idle', async () => {
    fresh({ idleMs: 300 })
    const { id, el } = mount()
    function App({ state }) {
      return (
        <div className="app">
          <input className="new-todo-title" value={state.draft} />
          <button className="add-todo-btn">Add</button>
          <p className="draft">{state.draft}</p>
        </div>
      )
    }
    App.initialState = { draft: '' }
    App.intent = ({ DOM }) => ({
      SET_DRAFT: DOM.input('.new-todo-title').map(e => e.target.value),
      ADD: DOM.click('.add-todo-button'), // sygnal-ignore SYG110 (deliberate bug: this test asserts the runtime reports SYG110)
    })
    App.model = {
      SET_DRAFT: (state, draft) => ({ ...state, draft }),
      ADD: (state) => ({ ...state, draft: '' }),
    }
    const app = run(App, {}, { mountPoint: id, diagnostics: 'collect' })
    try {
      await waitFor(() => el.querySelector('.new-todo-title'))
      await waitFor(() => diags('SYG103').length > 0, 1000)
      const [info] = diags('SYG103')
      assert(info.severity === 'info', `first report is info, got ${info.severity}`)
      assert(info.data.selector === '.add-todo-button', info.data.selector)
      assert(!diags('SYG103').some(d => d.severity === 'warn'), 'not escalated yet')

      const input = el.querySelector('.new-todo-title')
      for (const text of ['m', 'mi', 'mil', 'milk']) {
        input.value = text
        fire(input, 'input')
        await wait(40)
      }
      await waitFor(() => el.querySelector('.draft')?.textContent === 'milk')
      await waitFor(() => diags('SYG103').some(d => d.severity === 'warn'), 1500)
      const warn = diags('SYG103').find(d => d.severity === 'warn')
      assert(warn.component === 'App' && warn.message.includes("DOM.select('.add-todo-button')"), warn.message)
      assert(diags('SYG103').filter(d => d.data.selector === '.new-todo-title').length === 0, 'matched selector not reported')
    } finally { app.dispose() }
  })

  await runTest(CAT, 'SYG103 negative: conditionally rendered elements in the view are not reported', async () => {
    fresh({ idleMs: 200, minRenders: 1 })
    const { id, el } = mount()
    function App({ state }) {
      return (
        <div className="app">
          <button className="toggle">Toggle</button>
          {state.editing ? <input className="edit-input" /> : <span className="label">{state.n}</span>}
        </div>
      )
    }
    App.initialState = { editing: false, n: 0 }
    App.intent = ({ DOM }) => ({
      BUMP: DOM.click('.toggle'),
      DONE: DOM.select('.edit-input').events('keydown'),
    })
    App.model = {
      BUMP: (state) => ({ ...state, n: state.n + 1 }),
      DONE: (state) => ({ ...state, editing: false }),
    }
    const app = run(App, {}, { mountPoint: id, diagnostics: 'collect' })
    try {
      await waitFor(() => el.querySelector('.toggle'))
      for (let i = 0; i < 4; i++) { el.querySelector('.toggle').click(); await wait(30) }
      await waitFor(() => el.querySelector('.label')?.textContent === '4')
      await wait(400)
      const found = diags(null, 'App')
      assert(found.length === 0, found.map(d => d.text).join(' | '))
    } finally { app.dispose() }
  })

  // ── Kanban example: zero false positives ───────────────────────────────
  await runTest(CAT, 'Kanban example: every check on, real interactions, zero diagnostics', async () => {
    fresh({ idleMs: 300 })
    const { id, el } = mount()
    const app = run(KanbanRoot, { DND: makeDragDriver() }, { mountPoint: id, diagnostics: 'collect' })
    const q = (s) => el.querySelector(s)
    const qa = (s) => el.querySelectorAll(s)
    try {
      await waitFor(() => qa('.lane').length === 3 && qa('.task-card').length === 3)

      // add a lane
      q('.add-lane-btn').click()
      await waitFor(() => qa('.lane').length === 4)

      // rename the first lane (dblclick → input → Enter)
      q('.lane-title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await waitFor(() => q('.lane-title-input'))
      const title = q('.lane-title-input')
      title.value = 'Backlog'
      title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await waitFor(() => q('.lane-title')?.textContent === 'Backlog')

      // add a task (button → input → Enter)
      q('.add-task-btn').click()
      await waitFor(() => q('.new-task-input'))
      const task = q('.new-task-input')
      task.value = 'Write tests'
      task.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await waitFor(() => qa('.task-card').length === 4)

      // delete a task (TaskCard → PARENT → Lane)
      q('.delete-task-btn').click()
      await waitFor(() => qa('.task-card').length === 3)

      // move lanes right and left, delete a lane (Lane → EVENTS → Root)
      q('.move-lane-right').click()
      await wait(80)
      q('.move-lane-left').click()
      await wait(80)
      qa('.delete-lane-btn')[3].click()
      await waitFor(() => qa('.lane').length === 3)

      await wait(450) // > settle + idle, so SYG103 escalation has had its chance
      const bus = checkEventBus()
      for (const type of ['DELETE_LANE', 'MOVE_LANE_LEFT', 'MOVE_LANE_RIGHT']) {
        assert(bus.selected.includes(type) && bus.emitted.includes(type), `bus registry for ${type}`)
      }
      const kanban = ['RootComponent', 'LaneComponent', 'TaskCard']
      const kanbanEvents = ['DELETE_LANE', 'MOVE_LANE_LEFT', 'MOVE_LANE_RIGHT']
      const found = getDiagnostics().filter(d =>
        kanban.includes(d.component) || d.code === 'SYG301' ||
        (d.code === 'SYG105' && kanbanEvents.includes(d.data && d.data.type)))
      assert(found.length === 0, `${found.length} diagnostics: ` + found.map(d => d.text).join(' | '))
    } finally { app.dispose() }
  }, 8000)
}
