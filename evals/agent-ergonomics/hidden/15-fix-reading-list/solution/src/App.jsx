import { ABORT, Collection, debounce, dropRepeats } from 'sygnal'
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
        {/* from a real state array: edits to a calculated field's items are discarded */}
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

App.intent = ({ DOM, STATE }) => ({
  DRAFT: DOM.input('.new-title').value(),
  ADD: DOM.click('.add'),
  // Save once the changes have paused for 300 ms: debounce emits the latest
  // books, so the last change of a burst is never lost.
  SAVE: STATE.stream
    .map((state) => state.books)
    .compose(dropRepeats())
    .drop(1)
    .compose(debounce(300)),
})

App.model = {
  DRAFT: (state, draft) => ({ ...state, draft }),
  ADD: (state) => {
    const title = state.draft.trim()
    if (!title) return ABORT
    return {
      ...state,
      draft: '',
      nextId: state.nextId + 1,
      books: [...state.books, { id: state.nextId, title, finished: false }],
    }
  },
  SAVE: { EFFECT: (state, books) => saveBooks(books) },
}

export default App
