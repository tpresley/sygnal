// PLAN-6 E-1: the dev MCP endpoint's end-to-end fixture (test/vite-plugin-mcp.test.js)
import { jsonSchema } from 'sygnal'

export default function App({ state }) {
  return (
    <main>
      <p className="count">{state.count}</p>
      <button className="inc">+1</button>
      <ul>{state.todos.map((t) => <li key={t.id}>{t.text}</li>)}</ul>
    </main>
  )
}

App.initialState = { count: 0, todos: [{ id: 1, text: 'water plants' }], nextId: 2 }

App.intent = ({ DOM }) => ({
  INC: DOM.click('.inc'),
  // on purpose: a selector the view never renders (SYG103), for get_diagnostics
  RESET: DOM.click('.reset'),
})

App.model = {
  INC: (state) => ({ ...state, count: state.count + 1 }),
  RESET: (state) => ({ ...state, count: 0 }),
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text }], nextId: state.nextId + 1 }),
  CLEAR: (state) => ({ ...state, todos: [] }),
}

App.agent = {
  name: 'todos',
  description: 'the todo list',
  read: (state) => ({ count: state.count, todos: state.todos }),
  actions: {
    ADD: { description: 'Add a todo with this text', input: jsonSchema({ type: 'string', minLength: 1 }) },
    CLEAR: { description: 'Delete every todo', consequential: true },
  },
}
