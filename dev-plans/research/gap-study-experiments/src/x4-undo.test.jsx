// @vitest-environment jsdom
import { it, expect, afterEach } from 'vitest'
import { renderComponent, ABORT } from 'sygnal'

// undoable(): wraps STATE reducers so `key` keeps past/future snapshots. UNDO/REDO are plain actions.
function undoable(model, { key = 'doc', limit = 50, track } = {}) {
  const out = {}
  for (const [name, entry] of Object.entries(model)) {
    const reducer = typeof entry === 'function' ? entry : entry.STATE
    if (!reducer || (track && !track.includes(name))) { out[name] = entry; continue }
    const wrapped = (s, d, n, p) => {
      const r = reducer(s, d, n, p)
      if (r === ABORT || r === undefined || r[key] === s[key]) return r
      return { ...r, history: { past: [...(s.history?.past ?? []), s[key]].slice(-limit), future: [] } }
    }
    out[name] = typeof entry === 'function' ? wrapped : { ...entry, STATE: wrapped }
  }
  out.UNDO = (s) => { const past = s.history?.past ?? []; if (!past.length) return ABORT
    return { ...s, [key]: past.at(-1), history: { past: past.slice(0, -1), future: [s[key], ...s.history.future] } } }
  out.REDO = (s) => { const fut = s.history?.future ?? []; if (!fut.length) return ABORT
    return { ...s, [key]: fut[0], history: { past: [...s.history.past, s[key]], future: fut.slice(1) } } }
  return out
}

function Editor({ state }) {
  return <div><span className="n">{state.doc.n}</span><button className="inc">+</button>
    <button className="undo" disabled={!state.history?.past.length}>undo</button><button className="redo">redo</button></div>
}
Editor.initialState = { doc: { n: 0 } }
Editor.intent = ({ DOM }) => ({ INC: DOM.click('.inc'), UNDO: DOM.click('.undo'), REDO: DOM.click('.redo') })
Editor.model = undoable({ INC: (s) => ({ ...s, doc: { n: s.doc.n + 1 } }) })

let t; afterEach(() => t?.dispose())
it('undo/redo as a model wrapper', async () => {
  t = renderComponent(Editor, { dom: 'real' })
  await t.ready()
  t.simulateEvent('.inc', 'click'); await t.next(s => s.doc.n === 1)
  t.simulateEvent('.inc', 'click'); await t.next(s => s.doc.n === 2)
  t.simulateEvent('.undo', 'click'); await t.next(s => s.doc.n === 1)
  t.simulateEvent('.redo', 'click'); await t.next(s => s.doc.n === 2)
  t.expectNoDiagnostics()
})
