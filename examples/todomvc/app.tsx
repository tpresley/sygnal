import { processForm, classes } from 'sygnal'
import TODO from './components/todos'

interface TodoItem {
  id: number
  title: string
  completed: boolean
}

interface AppState {
  visibility: string
  todos: TodoItem[]
}

interface AppCalc {
  total: number
  remaining: number
  completed: number
  allDone: boolean
}

// filter functions for each visibility option
// - the key names will also get used as names in the UI
const FILTER_LIST: Record<string, (todo: TodoItem) => boolean> = {
  all: () => true,
  active: (todo) => !todo.completed,
  completed: (todo) => todo.completed,
}

export default function APP({ state }: { state: AppState & AppCalc }) {
  const { visibility, total, remaining, completed, allDone } = state

  // use the key names of the filter functions to make links to change the view mode
  const links = Object.keys(FILTER_LIST)

  const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

  // this could be a standalone component, but when no state or other component
  // functionality is needed then it makes sense to just keep it inline
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
            {/* use Sygnal's built-in collection element to create multiple todos from the 'todos'
                array in state and filter the array based on the currently selected visibility */}
            <collection of={TODO} from="todos" filter={FILTER_LIST[visibility]} />
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

// values that can be derived from the current state, and are used in multiple places
// can be added as calculated fields, and will automatically be added wherever state
// is used in the component. This is useful for reducing redundant code.
APP.calculated = {
  total: (state: AppState) => state.todos.length,
  remaining: (state: AppState) => state.todos.filter((todo) => !todo.completed).length,
  completed: (state: AppState) => state.todos.filter((todo) => todo.completed).length,
  allDone: (state: AppState) => state.todos.every((todo) => todo.completed),
}

APP.model = {
  // the special BOOTSTRAP action is called once when a component is instantiated
  // - this is similar to onMount or useEffect(() => {...}, []) in React
  BOOTSTRAP: {
    LOG: (_state: any, _data: any, next: any) => {
      Object.keys(FILTER_LIST).forEach((filter) => next('ADD_ROUTE', filter))
      return 'Starting application...'
    },
  },

  // change which todos are shown based on currently selected option (All, Active, Completed)
  VISIBILITY: (state: AppState, visibility: string) => ({
    ...state,
    visibility,
  }),

  // add todos fetched from local storage to state
  FROM_STORE: (state: AppState, data: TodoItem[]) => ({ ...state, todos: data }),

  NEW_TODO: (state: AppState, data: string, next: any) => {
    // calculate next id
    // - must be unique even after a browser page refresh
    // - using timestamp for simplicity, but could be UUID or something else
    const nextId = Date.now()

    const newTodo: TodoItem = {
      id: nextId,
      title: data,
      completed: false,
    }

    // send a new action to clear the new todo field
    next('CLEAR_FORM')

    // add the new todo to the state
    return {
      ...state,
      todos: [...state.todos, newTodo],
    }
  },

  TOGGLE_ALL: (state: AppState) => {
    const allDone = state.todos.every((todo) => todo.completed)
    const todos = state.todos.map((todo) => ({ ...todo, completed: !allDone }))
    return { ...state, todos }
  },

  CLEAR_COMPLETED: (state: AppState) => {
    const todos = state.todos.filter((todo) => !todo.completed)
    return { ...state, todos }
  },

  // it's a subjective matter whether DOM actions like setting focus or input values are
  // side-effects that need to be isolated from components, but we are taking the strictest
  // view here and using a DOMFX driver sink to handle them
  CLEAR_FORM: { DOMFX: { type: 'SET_VALUE', data: { selector: '.new-todo', value: '' } } },

  // setting a driver sink entry to 'true' sends data from triggering actions directly on
  ADD_ROUTE: { ROUTER: true },

  // save the todos to local storage
  TO_STORE: {
    STORE: (state: AppState) => {
      // sanitize todo objects
      const todos = state.todos.map(({ id, title, completed }) => ({ id, title, completed }))
      return { key: 'todos', value: todos }
    },
  },
}

APP.intent = ({ STATE, DOM, ROUTER, STORE }: { STATE: any; DOM: any; ROUTER: any; STORE: any }) => {
  // fetch stored todos from local storage
  // - init to an empty array if no todos were found
  const store$ = STORE.get('todos', [])

  const toggleAll$ = DOM.select('.toggle-all').events('click')
  const clearCompleted$ = DOM.select('.clear-completed').events('click')

  // get the form containing the new todo input
  const newTodoForm = DOM.select('.new-todo-form')

  // use Sygnal's processForm() helper to grab 'submit' events (user hits enter)
  // extract the new todo's title from the form values, and trim any white space
  // filter out blank titles
  const newTodo$ = processForm(newTodoForm, { events: 'submit' })
    .map((values: any) => values['new-todo'].trim())
    .filter((title: string) => title !== '')

  // save todos to localStorage whenever the app state changes
  // - ignore the first two state events to prevent storing the initialization data
  const toStore$ = STATE.stream.drop(2)

  return {
    // the ROUTER source fires whenever the hash changes, and returns the new hash
    VISIBILITY: ROUTER,
    FROM_STORE: store$,
    NEW_TODO: newTodo$,
    TOGGLE_ALL: toggleAll$,
    CLEAR_COMPLETED: clearCompleted$,
    TO_STORE: toStore$,
  }
}
