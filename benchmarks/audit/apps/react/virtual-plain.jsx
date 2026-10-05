import { memo, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { buildData } from '../../lib/data.js'

// PLAN-5 V-1: the virtual scenario with every row rendered (React 19, no virtualization)
const Row = memo(function Row({ row, index }) {
  return (
    <div className="row" data-index={index}>
      <span className="col-id">{row.id}</span>
      <span className="lbl">{row.label}</span>
    </div>
  )
})

function App() {
  const [rows, setRows] = useState([])
  const box = useRef(null)
  return (
    <div className="container">
      <div className="controls">
        <button id="run10k" onClick={() => setRows(buildData(10000))}>Create 10,000 rows</button>
        <button id="run100k" onClick={() => setRows(buildData(100000))}>Create 100,000 rows</button>
        <button id="clear" onClick={() => setRows([])}>Clear</button>
        <button id="jump" onClick={() => box.current.scrollTo({ top: 9000 * 32 })}>Jump to row 9,000</button>
      </div>
      <div className="rows" ref={box}>
        {rows.map((r, i) => <Row key={r.id} row={r} index={i} />)}
      </div>
    </div>
  )
}

createRoot(document.getElementById('main')).render(<App />)
