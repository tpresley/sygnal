import { useEffect, useState } from 'react'

const IDLE = { status: 'idle', results: [] }

export default function App() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState(IDLE)

  useEffect(() => {
    if (query === '') {
      setSearch(IDLE)
      return undefined
    }
    // Responses to anything but the latest query are ignored via `stale`.
    let stale = false
    const timer = setTimeout(async () => {
      setSearch((current) => ({ ...current, status: 'searching' }))
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = await response.json()
        if (!stale) setSearch({ status: 'done', results: body.results })
      } catch {
        if (!stale) setSearch({ status: 'error', results: [] })
      }
    }, 300)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="search">
      <h1>Find a book</h1>
      <input
        type="search"
        className="search-input"
        placeholder="Search books"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {search.status === 'searching' && <p className="status">Searching…</p>}
      {search.status === 'error' && <p className="status">Search failed.</p>}
      {search.status === 'done' && search.results.length === 0 && <p className="status">No results</p>}
      <ul className="results">
        {search.results.map((book) => (
          <li key={book.id}>{book.title}</li>
        ))}
      </ul>
    </div>
  )
}
