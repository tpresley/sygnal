// Real bug (evals task 07): the parent selects `.remove`, which is rendered
// inside the isolated Collection child, so the parent never sees the click.
import { Collection } from 'sygnal'
import TodoItem from './parts/TodoItem.jsx'

function Panel({ state }) {
  return <section className="panel">{state.title}</section>
}

function App({ state }) {
  return (
    <div className="app">
      <Collection of={TodoItem} from="todos" />
      <Panel state="panel">
        <button className="panel-close">close</button>
      </Panel>
    </div>
  )
}

App.initialState = { todos: [], panel: { title: 'P' } }

App.intent = ({ DOM }) => ({
  REMOVE: DOM.click('.remove').map(e => e.target.dataset.id), // expect: SYG104
  BADGE: DOM.click('.badge'), // expect: SYG104
  CLOSE: DOM.click('.panel-close'), // expect: SYG104
  PANEL: DOM.click('.panel'), // expect: SYG104
})

App.model = {
  REMOVE: (state, id) => ({ ...state, todos: state.todos.filter(t => t.id !== id) }),
  BADGE: (s) => s,
  CLOSE: (s) => s,
  PANEL: (s) => s,
}

export default App
