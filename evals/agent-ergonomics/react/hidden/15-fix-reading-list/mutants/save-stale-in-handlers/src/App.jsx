import { useMemo, useState } from 'react'
import BookRow from './BookRow.jsx'
import { loadBooks, saveBooks } from './storage.js'

const byTitle = (a, b) => a.title.localeCompare(b.title)

// MUTANT: rows fixed (by id), but saving moved into the handlers, where
// `books` is the value from the last render, so each save misses its own change.
export default function App() {
  const [books, setBooks] = useState(loadBooks)
  const [draft, setDraft] = useState('')

  const sortedBooks = useMemo(() => [...books].sort(byTitle), [books])
  const toRead = books.filter((b) => !b.finished).length
  const finishedCount = books.length - toRead

  const add = () => {
    const title = draft.trim()
    if (!title) return
    const nextId = Math.max(0, ...books.map((b) => b.id)) + 1
    setBooks((current) => [...current, { id: nextId, title, finished: false }])
    setDraft('')
    saveBooks(books)
  }

  const setFinished = (id, finished) => {
    setBooks((current) => current.map((b) => (b.id === id ? { ...b, finished } : b)))
    saveBooks(books)
  }

  const remove = (id) => {
    setBooks((current) => current.filter((b) => b.id !== id))
    saveBooks(books)
  }

  return (
    <div className="reading-list">
      <header>
        <h1>Reading list</h1>
        <p className="summary">{`${toRead} to read · ${finishedCount} finished`}</p>
      </header>
      <div className="add-book">
        <input className="new-title" placeholder="Book title" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="add" onClick={add}>
          Add
        </button>
      </div>
      <ul className="books">
        {sortedBooks.map((book) => (
          <BookRow
            key={book.id}
            book={book}
            onFinishedChange={(finished) => setFinished(book.id, finished)}
            onRemove={() => remove(book.id)}
          />
        ))}
      </ul>
    </div>
  )
}
