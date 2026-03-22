import { xs, ABORT } from 'sygnal'
import type { Component } from 'sygnal'
import TaskItem from './TaskItem'

type State = {
  inputValue: string
  nextId: number
  tasks: Array<{ id: number; text: string; done: boolean }>
}

type Actions = {
  UPDATE_INPUT: string
  ADD_TASK: Event
  TOGGLE_TASK: number
}

type Calculated = {
  remaining: number
}

type App = Component<State, {}, {}, Actions, Calculated>

const App: App = function ({ state }) {
  return (
    <div className="app">
      <header className="header">
        <div className="logo-row">
          <img src="/favicon.svg" alt="Sygnal" className="logo" />
          <div>
            <h1>Sygnal</h1>
            <p className="tagline">Reactive components with pure functions</p>
          </div>
        </div>
      </header>

      <main>
        <div className="card">
          <div className="card-header">
            <h2>Task Tracker</h2>
            <span className="badge">{state.remaining} remaining</span>
          </div>

          <div className="add-form">
            <input
              type="text"
              className="add-input"
              placeholder="Add a new task..."
              value={state.inputValue}
            />
            <button className="add-btn" attrs={{ disabled: !state.inputValue.trim() }}>Add</button>
          </div>

          {state.tasks.length === 0
            ? <div className="empty"><p>No tasks yet. Add one above!</p></div>
            : <collection of={TaskItem} from="tasks" className="tasks" />
          }
        </div>

        <footer className="footer">
          <p>
            Edit <code>src/components/App.tsx</code> to get started &mdash;{' '}
            <a href="https://sygnal.js.org" target="_blank" rel="noopener">Docs</a>
          </p>
        </footer>
      </main>
    </div>
  )
}

App.initialState = {
  inputValue: '',
  nextId: 4,
  tasks: [
    { id: 1, text: 'Learn about Sygnal components', done: true },
    { id: 2, text: 'Explore intent and model', done: false },
    { id: 3, text: 'Build something awesome', done: false },
  ],
}

App.calculated = {
  remaining: (state) => state.tasks.filter(t => !t.done).length,
}

App.intent = ({ DOM, CHILD }) => ({
  UPDATE_INPUT: DOM.input('.add-input').value(),
  ADD_TASK:     xs.merge(
    DOM.click('.add-btn'),
    DOM.keydown('.add-input').key().filter(key => key === 'Enter')
  ),
  TOGGLE_TASK:  CHILD.select(TaskItem),
})

App.model = {
  UPDATE_INPUT: (state, value) => ({
    ...state,
    inputValue: value,
  }),

  ADD_TASK: (state) => {
    const text = state.inputValue.trim()
    if (!text) return ABORT
    return {
      ...state,
      inputValue: '',
      nextId: state.nextId + 1,
      tasks: [...state.tasks, { id: state.nextId, text, done: false }],
    }
  },

  TOGGLE_TASK: (state, id) => ({
    ...state,
    tasks: state.tasks.map(task =>
      task.id === id ? { ...task, done: !task.done } : task
    ),
  }),
}

export default App
