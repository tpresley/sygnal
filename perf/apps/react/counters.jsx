import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { COUNTERS } from '../../lib/data.js'

function Counter() {
  const [n, setN] = useState(0)
  return (
    <div className="counter">
      <span className="val">{n}</span>
      <button className="inc" onClick={() => setN(n => n + 1)}>+</button>
    </div>
  )
}

function App() {
  const [ids, setIds] = useState([])
  return (
    <div>
      <button id="create" onClick={() => setIds(Array.from({ length: COUNTERS }, (_, i) => i + 1))}>Create counters</button>
      <button id="destroy" onClick={() => setIds([])}>Destroy counters</button>
      <div className="counters">{ids.map(id => <Counter key={id} />)}</div>
    </div>
  )
}
createRoot(document.getElementById('main')).render(<App />)
