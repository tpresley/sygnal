import { xs, ABORT, onlineStatus$, createInstallPrompt } from 'sygnal'
import TaskItem from './components/TaskItem.jsx'

const installPrompt = createInstallPrompt()

function App({ state }) {
  return (
    <div className="app">
      {state.isOffline && (
        <div className="offline-bar">You are offline — changes will sync when reconnected</div>
      )}

      {state.updateAvailable && (
        <div className="update-bar">
          <span>A new version is available</span>
          <button className="update-btn">Update now</button>
        </div>
      )}

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

        {state.canInstall && (
          <div className="install-card">
            <button className="install-btn">Install App</button>
          </div>
        )}

        <footer className="footer">
          <p>
            Edit <code>src/App.jsx</code> to get started &mdash;{' '}
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
  isOffline: false,
  updateAvailable: false,
  canInstall: false,
}

App.calculated = {
  remaining: (state) => state.tasks.filter(t => !t.done).length,
}

App.intent = ({ DOM, CHILD, SW }) => ({
  UPDATE_INPUT:   DOM.input('.add-input').value(),
  ADD_TASK:       xs.merge(
    DOM.click('.add-btn'),
    DOM.keydown('.add-input').key().filter(key => key === 'Enter')
  ),
  TOGGLE_TASK:    CHILD.select(TaskItem),
  ONLINE_CHANGED: onlineStatus$,
  SW_WAITING:     SW.select('waiting'),
  SW_CONTROLLING: SW.select('controlling'),
  APPLY_UPDATE:   DOM.click('.update-btn'),
  INSTALL:        DOM.click('.install-btn'),
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

  ONLINE_CHANGED: (state, isOnline) => ({
    ...state,
    isOffline: !isOnline,
  }),

  SW_WAITING: (state) => ({
    ...state,
    updateAvailable: true,
  }),

  SW_CONTROLLING: (state) => ({
    ...state,
    updateAvailable: false,
  }),

  APPLY_UPDATE: {
    SW: () => ({ action: 'skipWaiting' }),
    EFFECT: () => {
      window.location.reload()
    },
  },

  INSTALL: {
    EFFECT: () => {
      installPrompt.prompt()
    },
    STATE: (state) => ({
      ...state,
      canInstall: false,
    }),
  },
}

export default App
