import { ABORT } from 'sygnal'
import { COMMANDS } from './commands.js'

const matches = (query) => {
  const q = query.trim().toLowerCase()
  return q ? COMMANDS.filter((c) => c.label.toLowerCase().includes(q)) : COMMANDS
}

function App({ state, uid }) {
  const shown = matches(state.query)
  const active = shown[state.active]
  return (
    <main className="editor-page">
      <header>
        <h1>Untitled document</h1>
        <p className="last-command">{state.lastCommand ? `Ran: ${state.lastCommand}` : 'No command run yet.'}</p>
      </header>
      <section className="palette">
        <input
          className="search"
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={uid('list')}
          aria-activedescendant={active ? uid(active.id) : null}
          autoComplete="off"
          value={state.query}
        />
        <ul id={uid('list')} role="listbox" aria-label="Commands">
          {shown.map((c) => (
            <li id={uid(c.id)} role="option" tabIndex={-1} className={c === active ? 'option active' : 'option'} aria-selected={String(c === active)} data-id={c.id}>
              {c.label}
            </li>
          ))}
        </ul>
        {shown.length === 0 ? <p className="empty">No commands found.</p> : null}
      </section>
      <textarea className="document" aria-label="Document" value={state.text}></textarea>
    </main>
  )
}

App.initialState = {
  lastCommand: null,
  text: '',
  query: '',
  active: 0,
}

const KEYS = { ArrowDown: 1, ArrowUp: -1, Enter: 0, Escape: 0 }

App.intent = ({ DOM }) => {
  const keys = DOM.keydown('.search').filter((e) => e.key in KEYS)
  return {
    EDIT: DOM.input('.document').value(),
    QUERY: DOM.input('.search').value(),
    MOVE: keys.filter((e) => e.key === 'ArrowDown' || e.key === 'ArrowUp').map((e) => {
      e.preventDefault()
      return KEYS[e.key]
    }),
    RUN_ACTIVE: keys.filter((e) => e.key === 'Enter').map((e) => e.preventDefault()),
    CLEAR: keys.filter((e) => e.key === 'Escape'),
    RUN: DOM.click('.option').map((e) => e.target.closest('[data-id]').dataset.id),
  }
}

const run = (state, command) => (command ? { ...state, lastCommand: command.label, query: '', active: 0 } : ABORT)

App.model = {
  EDIT: (state, text) => ({ ...state, text }),
  QUERY: (state, query) => ({ ...state, query, active: Math.min(state.active, Math.max(0, matches(query).length - 1)) }),
  MOVE: (state, step) => {
    const n = matches(state.query).length
    return n ? { ...state, active: (state.active + step + n) % n } : ABORT
  },
  RUN_ACTIVE: (state) => run(state, matches(state.query)[state.active]),
  RUN: (state, id) => run(state, COMMANDS.find((c) => c.id === id)),
  CLEAR: (state) => ({ ...state, query: '', active: 0 }),
}

export default App
