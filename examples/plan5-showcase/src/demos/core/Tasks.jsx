import { run, makeRouter, Switchable } from 'sygnal'

// hash mode keeps the demo's routes in the fragment (#/tasks/2), next to the showcase's ?s=
const router = makeRouter({ routes: { home: '/', task: '/tasks/:id', notFound: '*' }, mode: 'hash', scroll: false, focus: false })
const { href } = router

const TASKS = { 1: 'Write the spec', 2: 'Build it', 3: 'Ship it' }

// A second route declarer, below the root: it gets each route in the same flush as the root
// (before the page is patched), so its reset never wipes text typed right after a navigation.
function Editor({ state }) {
  return (
    <div className="editor">
      <label>Notes on task {state.taskId} <input className="draft" value={state.draft} /></label>
      <p className="muted">Editor saw {state.routes} routes; its draft resets on each one.</p>
    </div>
  )
}
Editor.route = 'ROUTE'
Editor.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value() })
Editor.model = {
  ROUTE: (state, route) => ({ ...state, taskId: route.params.id, draft: '', routes: state.routes + 1 }),
  DRAFT: (state, draft) => ({ ...state, draft }),
}

function Home() {
  return <ul>{Object.entries(TASKS).map(([id, title]) => <li><a href={href('task', { id })}>{title}</a></li>)}</ul>
}

function TaskPage({ state }) {
  const id = state.route.params.id
  return (
    <article>
      <h4>{TASKS[id] || 'Unknown task'}</h4>
      <Editor state="editor" />
      <div className="row">
        {id > 1 ? <a href={href('task', { id: Number(id) - 1 })}>← Previous</a> : null}
        {id < 3 ? <a href={href('task', { id: Number(id) + 1 })}>Next →</a> : null}
      </div>
    </article>
  )
}

function NotFound() {
  return <p>No such page.</p>
}

export function Tasks({ state }) {
  return (
    <div>
      <nav className="row">
        <a href={href('home')}>All tasks</a>
        <a href="#/nowhere">A broken link</a>
        <button className="back">Back (command)</button>
      </nav>
      <p className="muted">Route: {state.route.name} {state.route.path}</p>
      <Switchable of={{ home: Home, task: TaskPage, notFound: NotFound }} current={state.route.name} />
    </div>
  )
}

Tasks.route = 'ROUTE'
Tasks.initialState = { route: router.current(), editor: { taskId: null, draft: '', routes: 0 } }
Tasks.intent = ({ DOM }) => ({ BACK: DOM.click('.back') })
Tasks.model = {
  ROUTE: (state, route) => ({ ...state, route }),
  BACK: { ROUTER: { back: true } },
}

export const start = (mountPoint, uid) => run(Tasks, { ROUTER: router.driver }, { mountPoint, uid })
