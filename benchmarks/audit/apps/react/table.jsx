import { memo, useReducer, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { buildData } from '../../lib/data.js'

function reducer(state, action) {
  switch (action.type) {
    case 'RUN': return { rows: buildData(1000), selected: 0 }
    case 'RUNLOTS': return { rows: buildData(10000), selected: 0 }
    case 'ADD': return { ...state, rows: state.rows.concat(buildData(1000)) }
    case 'UPDATE': return { ...state, rows: state.rows.map((r, i) => (i % 10 === 0 ? { ...r, label: r.label + ' !!!' } : r)) }
    case 'CLEAR': return { rows: [], selected: 0 }
    case 'SWAP': {
      if (state.rows.length < 999) return state
      const rows = state.rows.slice(); const t = rows[1]; rows[1] = rows[998]; rows[998] = t
      return { ...state, rows }
    }
    case 'SELECT': return { ...state, selected: action.id }
    case 'REMOVE': return { ...state, rows: state.rows.filter(r => r.id !== action.id) }
  }
  return state
}

const Row = memo(function Row({ row, selected, dispatch }) {
  return (
    <div className={selected ? 'row danger' : 'row'}>
      <span className="col-id">{row.id}</span>
      <a className="lbl" onClick={() => dispatch({ type: 'SELECT', id: row.id })}>{row.label}</a>
      <a className="remove" onClick={() => dispatch({ type: 'REMOVE', id: row.id })}>x</a>
    </div>
  )
})

function App() {
  const [state, dispatch] = useReducer(reducer, { rows: [], selected: 0 })
  return (
    <div className="container">
      <div className="controls">
        <button id="run" onClick={() => dispatch({ type: 'RUN' })}>Create 1,000 rows</button>
        <button id="runlots" onClick={() => dispatch({ type: 'RUNLOTS' })}>Create 10,000 rows</button>
        <button id="add" onClick={() => dispatch({ type: 'ADD' })}>Append 1,000 rows</button>
        <button id="update" onClick={() => dispatch({ type: 'UPDATE' })}>Update every 10th row</button>
        <button id="clear" onClick={() => dispatch({ type: 'CLEAR' })}>Clear</button>
        <button id="swaprows" onClick={() => dispatch({ type: 'SWAP' })}>Swap Rows</button>
      </div>
      <div className="table">
        {state.rows.map(row => <Row key={row.id} row={row} selected={row.id === state.selected} dispatch={dispatch} />)}
      </div>
    </div>
  )
}
createRoot(document.getElementById('main')).render(<App />)
