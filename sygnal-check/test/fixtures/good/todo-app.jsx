// A correctly wired app exercising most recognized shapes. Expect: no diagnostics.
import { xs, Collection, Switchable, Portal, classes, emit, event, set } from 'sygnal'

const ACTIVE = 'is-active'

function renderFilter(name, current) {
  return <a className={classes('filter', { selected: name === current })}>{name}</a>
}

function TodoItem({ state }) {
  return (
    <li className={`todo ${state.done ? 'done' : ''}`}>
      <input className="toggle" type="checkbox" checked={state.done} />
      <span className="title">{state.title}</span>
      <button className="remove">x</button>
    </li>
  )
}

TodoItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.toggle'),
  REMOVE: DOM.select('.remove').events('click'),
})

TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: {
    PARENT: (state) => state.id,
    EVENTS: (state) => ({ type: 'TODO_REMOVED', data: state.id }),
  },
}

function Card({ state, slots }) {
  return <div className="card">{...(slots.default || [])}</div>
}

Card.intent = ({ DOM }) => ({
  // rendered by the parent as slot content, inside Card's scope
  PING: DOM.click('.card-action'),
})

Card.model = {
  'PING | EVENTS': () => ({ type: 'CARD_PING' }),
}

function Home() { return <div className="home">home</div> }
function About() { return <div className="about">about</div> }

function App({ state }) {
  const headerClass = 'header' + (state.busy ? ' busy' : '')
  return (
    <div className="app">
      <header className={headerClass}>
        <input className="new-todo" value={state.input} />
        <button className={['add-btn', state.input && ACTIVE].filter(Boolean).join(' ')}>Add</button>
      </header>
      <ul className="filters">{['all', 'done'].map(f => renderFilter(f, state.filter))}</ul>
      <Collection of={TodoItem} from="todos" className="todo-list" />
      <Switchable of={{ home: Home, about: About }} current={state.page} />
      <Card>
        <button className="card-action">ping</button>
      </Card>
      {state.modal && (
        <Portal target="#modals">
          <div id="modal" className="modal">
            <button className="close-modal">close</button>
          </div>
        </Portal>
      )}
      <span id="status">{state.status}</span>
    </div>
  )
}

App.initialState = { input: '', todos: [], filter: 'all', page: 'home', modal: false, status: '' }

App.intent = ({ DOM, EVENTS, CHILD }) => {
  const input$ = DOM.input('.new-todo').map(e => e.target.value)
  const add$ = xs.merge(DOM.click('.add-btn'), DOM.keydown('.new-todo').filter(e => e.key === 'Enter'))
  return {
    INPUT: input$,
    ADD: add$,
    FILTER: DOM.click('.filters .filter'),
    CLOSE: DOM.click('#modal .close-modal'),
    STATUS: DOM.select('#status').events('click'),
    ACTIVE_CLICK: DOM.click('.is-active'),
    KEY: DOM.select('document').events('keydown'),
    REMOVE: CHILD.select(TodoItem),
    REMOVED: EVENTS.select('TODO_REMOVED'),
    PINGED: EVENTS.select('CARD_PING'),
    SAVED: EVENTS.select('SAVED'),
    SAVED2: EVENTS.select('SAVED_TOO'),
  }
}

App.model = {
  BOOTSTRAP: { EFFECT: (_s, _d, next) => next('LOAD') },
  LOAD: (state) => state,
  INPUT: set((_s, input) => ({ input })),
  ADD: {
    STATE: (state) => ({ ...state, todos: [...state.todos, { id: Date.now(), title: state.input, done: false }] }),
    EVENTS: event('SAVED', (state) => state.todos.length),
  },
  FILTER: (state, e) => ({ ...state, filter: e.target.textContent }),
  CLOSE: set({ modal: false }),
  STATUS: (state) => state,
  ACTIVE_CLICK: (state) => state,
  KEY: (state, e, next) => { next('CLOSE'); return state },
  REMOVE: (state, id) => ({ ...state, todos: state.todos.filter(t => t.id !== id) }),
  REMOVED: (state) => state,
  PINGED: (state) => state,
  SAVED: emit('SAVED_TOO', (state) => state),
  SAVED2: (state) => state,
}

export default App
