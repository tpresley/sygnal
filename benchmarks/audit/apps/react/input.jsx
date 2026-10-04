import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { items as makeItems } from '../../lib/data.js'

const items = makeItems()
function App() {
  const [draft, setDraft] = useState('')
  return (
    <div>
      <input className="draft" value={draft} onChange={e => setDraft(e.target.value)} />
      <p className="echo">{draft}</p>
      <ul>{items.map(item => <li key={item.id}>{item.text}</li>)}</ul>
    </div>
  )
}
createRoot(document.getElementById('main')).render(<App />)
