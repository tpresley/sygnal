import { useState } from 'react'

export default function App() {
  const [query, setQuery] = useState('')

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
      <ul className="results"></ul>
    </div>
  )
}
