import { useState } from 'react'

const MIN_SIZE = 16
const MAX_SIZE = 32

export default function App() {
  const [headline, setHeadline] = useState('Summer sale')
  const [size, setSize] = useState(28)
  const [bold, setBold] = useState(false)

  return (
    <main className="poster-editor">
      <h1>Poster</h1>
      <div className="toolbar">
        <button className="smaller" onClick={() => setSize((s) => Math.max(MIN_SIZE, s - 2))}>
          Smaller
        </button>
        <button className="larger" onClick={() => setSize((s) => Math.min(MAX_SIZE, s + 2))}>
          Larger
        </button>
        <label className="bold-option">
          <input type="checkbox" name="bold" checked={bold} onChange={(e) => setBold(e.target.checked)} />
          <span>Bold</span>
        </label>
      </div>
      <label className="field">
        <span>Headline</span>
        <input name="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
      </label>
      <p className="preview">{`${headline} (${size}px${bold ? ', bold' : ''})`}</p>
    </main>
  )
}
