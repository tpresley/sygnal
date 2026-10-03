/** @jsxImportSource react */
import { memo, useReducer } from 'react'
import { createRoot } from 'react-dom/client'
import { buildRows, swapped } from './data.js'
import './harness.js'

// The scenario in idiomatic React 19: useReducer, a memoised keyed row
// (dispatch is stable, so an edit re-renders only the edited row).
function reducer(state, action) {
  switch (action.type) {
    case 'RUN':   return { rows: buildRows(1000, state.nextId), nextId: state.nextId + 1000 }
    case 'ADD':   return { rows: state.rows.concat(buildRows(1000, state.nextId)), nextId: state.nextId + 1000 }
    case 'SWAP':  return { ...state, rows: swapped(state.rows) }
    case 'CLEAR': return { ...state, rows: [] }
    case 'EDIT':  return { ...state, rows: state.rows.map((row) => (row.id === action.id ? { ...row, label: row.label + ' !!!' } : row)) }
    default:      return state
  }
}

const Row = memo(function Row({ row, dispatch }) {
  return (
    <div className="row" data-id={row.id}>
      <span className="id">{row.id}</span>
      <button type="button" className="lbl" onClick={() => dispatch({ type: 'EDIT', id: row.id })}>{row.label}</button>
    </div>
  )
})

function App() {
  const [state, dispatch] = useReducer(reducer, { rows: [], nextId: 1 })
  return (
    <div className="app">
      <div className="controls">
        <button type="button" id="run" onClick={() => dispatch({ type: 'RUN' })}>Create 1,000 rows</button>
        <button type="button" id="add" onClick={() => dispatch({ type: 'ADD' })}>Append 1,000 rows</button>
        <button type="button" id="swaprows" onClick={() => dispatch({ type: 'SWAP' })}>Swap rows</button>
        <button type="button" id="clear" onClick={() => dispatch({ type: 'CLEAR' })}>Clear</button>
      </div>
      <div className="rows">
        {state.rows.map((row) => <Row key={row.id} row={row} dispatch={dispatch} />)}
      </div>
    </div>
  )
}

createRoot(document.getElementById('app')).render(<App />)
