import { useEffect, useMemo, useRef, useState } from 'react'
import BookRow from './BookRow.jsx'
import { loadBooks, saveBooks } from './storage.js'

const byTitle = (a, b) => a.title.localeCompare(b.title)

export default function App() {
  const [books, setBooks] = useState(loadBooks)
  const [draft, setDraft] = useState('')
  const firstRender = useRef(true)

  const sortedBooks = useMemo(() => [...books].sort(byTitle), [books])
  const toRead = books.filter((b) => !b.finished).length
  const finishedCount = books.length - toRead

  // Save once the changes have paused for 300 ms. Each run of the effect
  // replaces the previous timer, so the latest books are the ones saved.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return undefined
    }
    const timer = setTimeout(() => saveBooks(books), 300)
    return () => clearTimeout(timer)
  }, [books])

  const add = () => {
    const title = draft.trim()
    if (!title) return
    const nextId = Math.max(0, ...books.map((b) => b.id)) + 1
    setBooks((current) => [...current, { id: nextId, title, finished: false }])
    setDraft('')
  }

  // By id: the rows are rendered from the sorted copy, so their index is not
  // an index into `books`.
  const setFinished = (id, finished) =>
    setBooks((current) => current.map((b) => (b.id === id ? { ...b, finished } : b)))

  const remove = (id) => setBooks((current) => current.filter((b) => b.id !== id))

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
