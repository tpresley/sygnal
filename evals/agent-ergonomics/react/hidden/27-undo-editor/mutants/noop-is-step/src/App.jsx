import { useEffect, useReducer } from 'react'

const MIN_SIZE = 16
const MAX_SIZE = 32
const GROUP_MS = 1000

const INITIAL = {
  poster: { headline: 'Summer sale', size: 28, bold: false },
  past: [],
  future: [],
  typingAt: null, // time of the latest Headline edit while the newest step is a typing group
}

function change(state, patch, typingAt = null) {
  const next = { ...state.poster, ...patch }
  const p = state.poster
  // MUTANT: a change that changes nothing still records a step
  const grouped = typingAt !== null && state.typingAt !== null && typingAt - state.typingAt < GROUP_MS
  return { poster: next, past: grouped ? state.past : [...state.past, p], future: [], typingAt }
}

function reducer(state, action) {
  switch (action.type) {
    case 'smaller':
      return change(state, { size: Math.max(MIN_SIZE, state.poster.size - 2) })
    case 'larger':
      return change(state, { size: Math.min(MAX_SIZE, state.poster.size + 2) })
    case 'bold':
      return change(state, { bold: action.bold })
    case 'headline':
      return change(state, { headline: action.value }, action.at)
    case 'undo':
      if (state.past.length === 0) return state
      return { poster: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [state.poster, ...state.future], typingAt: null }
    case 'redo':
      if (state.future.length === 0) return state
      return { poster: state.future[0], past: [...state.past, state.poster], future: state.future.slice(1), typingAt: null }
    default:
      return state
  }
}

function shortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && e.ctrlKey && !e.shiftKey) return 'redo'
  return null
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const { headline, size, bold } = state.poster

  useEffect(() => {
    const onKey = (e) => {
      const which = shortcut(e)
      if (!which) return
      e.preventDefault()
      dispatch({ type: which })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main className="poster-editor">
      <h1>Poster</h1>
      <div className="toolbar">
        <button className="smaller" onClick={() => dispatch({ type: 'smaller' })}>
          Smaller
        </button>
        <button className="larger" onClick={() => dispatch({ type: 'larger' })}>
          Larger
        </button>
        <label className="bold-option">
          <input type="checkbox" name="bold" checked={bold} onChange={(e) => dispatch({ type: 'bold', bold: e.target.checked })} />
          <span>Bold</span>
        </label>
        <button className="undo" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>
          Undo
        </button>
        <button className="redo" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })}>
          Redo
        </button>
      </div>
      <label className="field">
        <span>Headline</span>
        <input name="headline" value={headline} onChange={(e) => dispatch({ type: 'headline', value: e.target.value, at: Date.now() })} />
      </label>
      <p className="preview">{`${headline} (${size}px${bold ? ', bold' : ''})`}</p>
    </main>
  )
}
