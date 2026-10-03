import { useState } from 'react'

const QUOTE_IDS = [101, 102, 103]

export default function App() {
  const [selected, setSelected] = useState(null)

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
            <button className="refresh">Refresh</button>
            <p className="status"></p>
            <blockquote className="quote-text"></blockquote>
            <p className="quote-author"></p>
          </div>
        )}
      </section>
    </div>
  )
}
