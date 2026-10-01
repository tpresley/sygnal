import { ABORT, Collection } from 'sygnal'
import BookRow from './BookRow.jsx'
import { loadBooks, saveBooks } from './storage.js'

const byTitle = (a, b) => a.title.localeCompare(b.title)

function App({ state }) {
  return (
    <div className="reading-list">
      <header>
        <h1>Reading list</h1>
        <p className="summary">{`${state.toRead} to read · ${state.finishedCount} finished`}</p>
      </header>
      <div className="add-book">
        <input className="new-title" placeholder="Book title" value={state.draft} />
        <button className="add">Add</button>
      </div>
      <ul className="books">
        <Collection of={BookRow} from="books" sort={byTitle} />
      </ul>
    </div>
  )
}

const books = loadBooks()

App.initialState = {
  draft: '',
  nextId: Math.max(0, ...books.map((b) => b.id)) + 1,
  books,
}

App.calculated = {
  toRead: (state) => state.books.filter((b) => !b.finished).length,
  finishedCount: (state) => state.books.filter((b) => b.finished).length,
}

App.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.new-title').value(),
  ADD: DOM.click('.add'),
})

const added = (state) => [...state.books, { id: state.nextId, title: state.draft.trim(), finished: false }]

// MUTANT: the throttled STATE-stream save was replaced by an immediate save on
// ADD (the reported case), so finishing and removing books are never saved.
App.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: {
    STATE: (state) => {
      if (!state.draft.trim()) return ABORT
      return { ...state, draft: '', nextId: state.nextId + 1, books: added(state) }
    },
    EFFECT: (state) => {
      if (state.draft.trim()) saveBooks(added(state))
    },
  },
}

export default App
