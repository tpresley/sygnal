import { memo, useReducer, useState, useRef, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core'
import { buildData } from '../../lib/data.js'

// PLAN-5 V-1: React 19 + TanStack Virtual (virtual-core 3.17.11, the version Sygnal bundles).
// useVirtualizer is @tanstack/react-virtual's hook in its essentials (the package isn't installed
// here): one Virtualizer per component, options set every render, mount / update in layout
// effects, a re-render on change (flushSync while scrolling, as react-virtual does)
function useVirtualizer(options) {
  const [, rerender] = useReducer(() => ({}), {})
  const opts = {
    observeElementRect, observeElementOffset, scrollToFn: elementScroll, ...options,
    onChange: (v, sync) => { if (sync) flushSync(rerender); else rerender() },
  }
  const [v] = useState(() => new Virtualizer(opts))
  v.setOptions(opts)
  useLayoutEffect(() => v._didMount(), [])
  useLayoutEffect(() => v._willUpdate())
  return v
}

const Row = memo(function Row({ row, index, measure }) {
  return (
    <div className="row" data-index={index} ref={measure}>
      <span className="col-id">{row.id}</span>
      <span className="lbl">{row.label}</span>
    </div>
  )
})

function App() {
  const [rows, setRows] = useState([])
  const box = useRef(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => box.current, estimateSize: () => 32, overscan: 5, getItemKey: (i) => rows[i].id })
  const items = v.getVirtualItems()
  return (
    <div className="container">
      <div className="controls">
        <button id="run10k" onClick={() => setRows(buildData(10000))}>Create 10,000 rows</button>
        <button id="run100k" onClick={() => setRows(buildData(100000))}>Create 100,000 rows</button>
        <button id="clear" onClick={() => setRows([])}>Clear</button>
        <button id="jump" onClick={() => v.scrollToIndex(9000, { align: 'start' })}>Jump to row 9,000</button>
      </div>
      <div className="rows" ref={box} role="list" aria-label="Rows" style={{ overflowAnchor: 'none' }}>
        <div style={{ height: v.getTotalSize(), position: 'relative', width: '100%' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${items[0]?.start ?? 0}px)` }}>
            {items.map(it => <Row key={it.key} row={rows[it.index]} index={it.index} measure={v.measureElement} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('main')).render(<App />)
