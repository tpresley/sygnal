import { useEffect, useMemo, useRef, useState } from 'react'
import BookRow from './BookRow.jsx'
import { loadBooks, saveBooks } from './storage.js'

const byTitle = (a, b) => a.title.localeCompare(b.title)

export default function App() {
  const [books, setBooks] = useState(loadBooks)
  const [draft, setDraft] = useState('')
  const firstRender = useRef(true)
  const saveTimer = useRef(null)

  const sortedBooks = useMemo(() => [...books].sort(byTitle), [books])
  const toRead = books.filter((b) => !b.finished).length
  const finishedCount = books.length - toRead

  // Save at most once every 500 ms, so a burst of changes is one write.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (saveTimer.current) return
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      saveBooks(books)
    }, 500)
  }, [books])

  const add = () => {
    const title = draft.trim()
    if (!title) return
    const nextId = Math.max(0, ...books.map((b) => b.id)) + 1
    setBooks((current) => [...current, { id: nextId, title, finished: false }])
    setDraft('')
  }

  const setFinishedAt = (index, finished) =>
    setBooks((current) => current.map((b, i) => (i === index ? { ...b, finished } : b)))

  const removeAt = (index) => setBooks((current) => current.filter((_, i) => i !== index))

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
        {sortedBooks.map((book, index) => (
          <BookRow
            key={book.id}
            book={book}
            onFinishedChange={(finished) => setFinishedAt(index, finished)}
            onRemove={() => removeAt(index)}
          />
        ))}
      </ul>
    </div>
  )
}
