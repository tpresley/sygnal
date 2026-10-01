import { ABORT, Collection, dropRepeats } from 'sygnal'
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
        <Collection of={BookRow} from="sortedBooks" />
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
  sortedBooks: (state) => [...state.books].sort(byTitle),
  toRead: (state) => state.books.filter((b) => !b.finished).length,
  finishedCount: (state) => state.books.filter((b) => b.finished).length,
}

App.intent = ({ DOM, STATE }) => ({
  DRAFT: DOM.input('.new-title').value(),
  ADD: DOM.click('.add'),
  BOOKS_CHANGED: STATE.stream
    .map((state) => state.books)
    .compose(dropRepeats())
    .drop(1),
})

let saveTimer = null

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
  // Save at most once every 500 ms, so a burst of changes is one write.
  BOOKS_CHANGED: {
    EFFECT: (state, changedBooks) => {
      if (saveTimer) return
      saveTimer = setTimeout(() => {
        saveTimer = null
        saveBooks(changedBooks)
      }, 500)
    },
  },
}

export default App
