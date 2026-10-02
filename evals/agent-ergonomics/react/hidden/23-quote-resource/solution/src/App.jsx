import { useEffect, useState } from 'react'

const QUOTE_IDS = [101, 102, 103]

const STATUS_TEXT = { loading: 'Loading…', error: 'Could not load the quote.', done: '' }

export default function App() {
  const [selected, setSelected] = useState(null)
  // Bumped by Refresh, so the effect below runs again for the same quote.
  const [reloads, setReloads] = useState(0)
  const [result, setResult] = useState({ status: 'done', quote: null })

  // One request per (selected, reloads); the cleanup marks the previous one stale,
  // so its response or failure is ignored whenever it arrives.
  useEffect(() => {
    if (selected === null) return undefined
    let current = true
    setResult({ status: 'loading', quote: null })
    fetch(`/api/quotes/${selected}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then(
        (quote) => {
          if (current) setResult({ status: 'done', quote })
        },
        () => {
          if (current) setResult({ status: 'error', quote: null })
        }
      )
    return () => {
      current = false
    }
  }, [selected, reloads])

  const quote = result.status === 'done' ? result.quote : null

  return (
    <div className="quotes">
      <h1>Quotes</h1>
      <ul className="quote-list">
        {QUOTE_IDS.map((id) => (
          <li key={id}>
            <button className={id === selected ? 'pick selected' : 'pick'} onClick={() => setSelected(id)}>
              {`Quote ${id}`}
            </button>
          </li>
        ))}
      </ul>
      <section className="detail">
        {selected === null ? (
          <p className="placeholder">Select a quote.</p>
        ) : (
          <div className="quote">
            <h2>{`Quote ${selected}`}</h2>
            <button className="refresh" onClick={() => setReloads((n) => n + 1)}>
              Refresh
            </button>
            <p className="status">{STATUS_TEXT[result.status]}</p>
            <blockquote className="quote-text">{quote ? quote.text : ''}</blockquote>
            <p className="quote-author">{quote ? quote.author : ''}</p>
          </div>
        )}
      </section>
    </div>
  )
}
