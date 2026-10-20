// WebMCP: the browser's own agent gets tools from the page. This reading list declares what an
// agent may do with `agent` statics (here, Book.jsx and Goal.jsx), and index.js offers them all
// with one call, `experimentalExposeWebMcp(app)`. The "Add a book" form is a tool too: `formTool`
// writes the WebMCP attributes (`toolname`, `toolparamdescription`, ...) on the `<form>`.
//
// The registrations follow the app: `books_clear_finished` exists only while a book is finished
// (`when`), and adding or removing a book registers `book_move` / `book_remove` again with the new
// ids. The console below (consoleView.jsx) shows them as they change and calls them as an agent.
import { z } from 'zod'
import { Collection, form, ABORT } from 'sygnal'
import { formTool } from 'sygnal/ai'
import Book, { SHELVES } from './Book.jsx'
import Goal from './Goal.jsx'
import { consoleView } from './consoleView.jsx'
import { exampleArgs } from './agentConsole.js'

const BOOKS = [
  { id: 1, title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', shelf: 'reading' },
  { id: 2, title: 'Piranesi', author: 'Susanna Clarke', shelf: 'want' },
  { id: 3, title: 'Project Hail Mary', author: 'Andy Weir', shelf: 'finished' },
  { id: 4, title: 'The Dispossessed', author: 'Ursula K. Le Guin', shelf: 'want' },
]

const bookSchema = z.object({
  title: z.string().trim().min(1, 'Give the title'),
  author: z.string().trim().min(1, 'Give the author'),
  shelf: z.enum(Object.keys(SHELVES)),
})

const EMPTY = { title: '', author: '', shelf: 'want' }

const finished = (state) => state.books.filter((b) => b.shelf === 'finished').length

// the goal's own slice: its target, and the finished count it shows (read-only)
const goalLens = {
  get: (state) => ({ target: state.goal, finished: finished(state) }),
  set: (state, goal) => ({ ...state, goal: goal.target }),
}

export default function ReadingList({ state }) {
  const f = state.form.fields
  return (
    <div className="w reading-list">
      <div className="w-grid">
        <section className="panel shelf-panel" aria-label="Reading list">
          <h3 className="panel-title">
            Reading list
            <button type="button" className="btn ghost small clear-finished" disabled={finished(state) === 0}>Clear finished</button>
          </h3>
          <ul className="books"><Collection of={Book} from="books" /></ul>
          {state.books.length === 0 && <p className="empty">No books. Add one, or let an agent do it.</p>}
        </section>

        <div className="side">
          <form className="panel add-book">
            <h3 className="panel-title">Add a book <code className="tool-tag">toolname="add_book"</code></h3>
            <label>Title <input name="title" value={f.title.value} aria-invalid={f.title.invalid} /></label>
            {f.title.error && <small className="error-text">{f.title.error}</small>}
            <label>Author <input name="author" value={f.author.value} aria-invalid={f.author.invalid} /></label>
            {f.author.error && <small className="error-text">{f.author.error}</small>}
            <label>Shelf
              <select name="shelf" value={f.shelf.value}>
                {Object.entries(SHELVES).map(([id, label]) => <option value={id}>{label}</option>)}
              </select>
            </label>
            <button type="submit" className="btn small">Add book</button>
          </form>
          <div className="panel"><Goal state={goalLens} /></div>
        </div>
      </div>

      {consoleView(state)}
    </div>
  )
}

ReadingList.initialState = {
  books: BOOKS,
  nextId: 5,
  goal: 12,
  // the agent console: what is registered (the WEBMCP source), and the call being made
  webmcp: { native: false, tools: [], log: [] },
  picked: null,
  args: '',
  call: { id: 0, status: 'idle', result: null, error: null },
}

ReadingList.intent = ({ DOM, WEBMCP }) => ({
  CLEAR_FINISHED: DOM.click('.clear-finished'),
  REGISTERED: WEBMCP.select(),
  PICK_TOOL: DOM.click('.tool-item').data('tool'),
  ARGS: DOM.input('.args').value(),
  CALL: DOM.select('.call-form').events('submit', { preventDefault: true }),
})

/** the console's arguments as an object, or undefined when the text isn't a JSON object */
function parsedArgs(text) {
  try {
    const v = JSON.parse(text || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined
  } catch {
    return undefined
  }
}

ReadingList.model = {
  CLEAR_FINISHED: (state) => ({ ...state, books: state.books.filter((b) => b.shelf !== 'finished') }),
  // the form's submit, with the schema's output; then the form starts over, empty
  ADD_BOOK: {
    STATE: (state, book) => ({ ...state, books: [...state.books, { id: state.nextId, ...book }], nextId: state.nextId + 1 }),
    EFFECT: (state, book, next) => next('form.RESET', EMPTY),
  },

  REGISTERED: (state, webmcp) => ({ ...state, webmcp }),
  PICK_TOOL: (state, name) => {
    const tool = state.webmcp.tools.find((t) => t.name === name)
    return { ...state, picked: name, args: JSON.stringify(exampleArgs(tool?.inputSchema), null, 2), call: { ...state.call, status: 'idle', result: null, error: null } }
  },
  ARGS: (state, args) => ({ ...state, args }),
  CALL: {
    STATE: (state) => {
      const id = state.call.id + 1
      return parsedArgs(state.args)
        ? { ...state, call: { id, status: 'calling', result: null, error: null } }
        : { ...state, call: { id, status: 'idle', result: null, error: 'The arguments must be a JSON object' } }
    },
    AGENT_CALL: (state) => {
      const args = parsedArgs(state.args)
      return args && state.picked ? { value: { id: state.call.id, name: state.picked, args }, ok: 'CALLED', error: 'CALL_FAILED' } : ABORT
    },
  },
  // only the newest call's answer counts (a form tool's call may still wait for your submit)
  CALLED: (state, { id, result }) => (id === state.call.id ? { ...state, call: { ...state.call, status: 'done', result } } : ABORT),
  CALL_FAILED: (state, { error, request }) => (request.value.id === state.call.id ? { ...state, call: { ...state.call, status: 'idle', error: error.message } } : ABORT),
}

ReadingList.agent = {
  name: 'books',
  description: 'The reading list: books on three shelves (want, reading, finished)',
  untrusted: true,   // titles and authors are text users typed
  read: (state) => ({ books: state.books.map(({ id, title, author, shelf }) => ({ id, title, author, shelf })) }),
  actions: {
    CLEAR_FINISHED: {
      description: 'Remove every finished book from the list',
      consequential: true,
      when: (state) => finished(state) > 0,
    },
  },
}

ReadingList.uses = {
  form: form(bookSchema, {
    form: '.add-book',
    values: EMPTY,
    submit: 'ADD_BOOK',
    tool: formTool({ name: 'add_book', description: 'Add a book to the reading list. The fields are filled in for the user, who reviews them and presses Add book.' }),
  }),
}
