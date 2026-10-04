import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEPTH } from '../../lib/data.js'

function Leaf({ count, onInc }) {
  return (
    <div className="leaf">
      <span className="val">{count}</span>
      <button className="inc" onClick={onInc}>+</button>
    </div>
  )
}
function Level({ depth, count, onInc }) {
  return <div className="lvl">{depth > 0 ? <Level depth={depth - 1} count={count} onInc={onInc} /> : <Leaf count={count} onInc={onInc} />}</div>
}
function App() {
  const [count, setCount] = useState(0)
  return <div><Level depth={DEPTH} count={count} onInc={() => setCount(c => c + 1)} /></div>
}
createRoot(document.getElementById('main')).render(<App />)
