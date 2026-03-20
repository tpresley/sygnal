import { processForm, classes } from 'sygnal'
import type { Component, DriverSpec } from 'sygnal'
import type { Stream } from 'xstream'
import type { DOMfx } from './lib/DOMfxDriver'
import type { StoreSource, StoreEntry } from './lib/localStorageDriver'
import TODO from './components/todos'

// ─── State ──────────────────────────────────────────────────────────────────

type TodoItem = {
  id: number
  title: string
  completed: boolean
}

type AppState = {
  visibility: string
  todos: TodoItem[]
}

// ─── Calculated ─────────────────────────────────────────────────────────────

type AppCalc = {
  total: number
  remaining: number
  completed: number
  allDone: boolean
}

// ─── Custom Drivers ─────────────────────────────────────────────────────────
// Must use `type` (not `interface`) so TypeScript recognizes it as extending
// Record<string, DriverSpec> — interfaces lack implicit index signatures.

type AppDrivers = {
  DOMFX: DriverSpec<void, DOMfx>
  STORE: DriverSpec<StoreSource, StoreEntry>
  ROUTER: DriverSpec<Stream<string>, string>
}

// ─── Actions ────────────────────────────────────────────────────────────────
// Use `any` for DOM event actions where the event data isn't used in reducers.

type AppActions = {
  VISIBILITY: string
  FROM_STORE: TodoItem[]
  NEW_TODO: string
  TOGGLE_ALL: any
  CLEAR_COMPLETED: any
  TO_STORE: any
  CLEAR_FORM: never
  ADD_ROUTE: string
}

// ─── Sink Returns ───────────────────────────────────────────────────────────

type AppSinkReturns = {
  LOG: string
}

// ─── Component ──────────────────────────────────────────────────────────────

type App = Component<AppState, {}, AppDrivers, AppActions, AppCalc, {}, AppSinkReturns>

// Filter functions for each visibility option
const FILTER_LIST: Record<string, (todo: TodoItem) => boolean> = {
  all: () => true,
  active: (todo) => !todo.completed,
  completed: (todo) => todo.completed,
}

const APP: App = function ({ state }) {
  const { visibility, total, remaining, completed, allDone } = state!

  const links = Object.keys(FILTER_LIST)
  const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

  const renderLink = (link: string) => (
    <li>
      <a href={`#/${link}`} className={classes({ selected: visibility === link })}>
        {capitalize(link)}
      </a>
    </li>
  )

  return (
    <section className="todoapp">
      <header className="header">
        <h1>todos</h1>
        <form className="new-todo-form">
          <input
            className="new-todo"
            name="new-todo"
            autofocus
            autocomplete="off"
            placeholder="What needs to be done?"
          />
        </form>
      </header>

      {total > 0 && (
        <section className="main">
          <input id="toggle-all" className="toggle-all" type="checkbox" checked={allDone} />
          <label for="toggle-all">Mark all as complete</label>
          <ul className="todo-list">
            <collection of={TODO as any} from="todos" filter={FILTER_LIST[visibility]} />
          </ul>
        </section>
      )}

      {total > 0 && (
        <footer className="footer">
          <span className="todo-count">
            <strong>{remaining}</strong> {remaining === 1 ? 'item' : 'items'} left
          </span>
          <ul className="filters">{links.map(renderLink)}</ul>
          {completed > 0 && <button className="clear-completed">Clear completed</button>}
        </footer>
      )}
    </section>
  )
}

APP.initialState = {
  visibility: 'all',
  todos: [],
}

APP.calculated = {
  total: (state) => state.todos.length,
  remaining: (state) => state.todos.filter((todo) => !todo.completed).length,
  completed: (state) => state.todos.filter((todo) => todo.completed).length,
  allDone: (state) => state.todos.every((todo) => todo.completed),
}

APP.model = {
  BOOTSTRAP: {
    LOG: (_state, _data, next) => {
      Object.keys(FILTER_LIST).forEach((filter) => next('ADD_ROUTE', filter))
      return 'Starting application...'
    },
  },

  VISIBILITY: (state, visibility) => ({
    ...state,
    visibility,
  }),

  FROM_STORE: (state, data) => ({ ...state, todos: data }),

  NEW_TODO: (state, data, next) => {
    const nextId = Date.now()
    const newTodo: TodoItem = { id: nextId, title: data, completed: false }
    next('CLEAR_FORM')
    return { ...state, todos: [...state.todos, newTodo] }
  },

  TOGGLE_ALL: (state) => {
    const allDone = state.todos.every((todo) => todo.completed)
    const todos = state.todos.map((todo) => ({ ...todo, completed: !allDone }))
    return { ...state, todos }
  },

  CLEAR_COMPLETED: (state) => {
    const todos = state.todos.filter((todo) => !todo.completed)
    return { ...state, todos }
  },

  CLEAR_FORM: { DOMFX: () => ({ type: 'SET_VALUE', data: { selector: '.new-todo', value: '' } }) },

  ADD_ROUTE: { ROUTER: true },

  TO_STORE: {
    STORE: (state) => {
      const todos = state.todos.map(({ id, title, completed }) => ({ id, title, completed }))
      return { key: 'todos', value: todos }
    },
  },
}

APP.intent = ({ STATE, DOM, ROUTER, STORE }) => {
  const store$ = STORE.get('todos', [])
  const toggleAll$ = DOM.select('.toggle-all').events('click')
  const clearCompleted$ = DOM.select('.clear-completed').events('click')

  const newTodoForm = DOM.select('.new-todo-form')
  const newTodo$ = processForm(newTodoForm as any, { events: 'submit' })
    .map((values: any) => values['new-todo'].trim())
    .filter((title: string) => title !== '')

  const toStore$ = STATE.stream.drop(2)

  return {
    VISIBILITY: ROUTER,
    FROM_STORE: store$,
    NEW_TODO: newTodo$,
    TOGGLE_ALL: toggleAll$,
    CLEAR_COMPLETED: clearCompleted$,
    TO_STORE: toStore$,
  }
}

export default APP
