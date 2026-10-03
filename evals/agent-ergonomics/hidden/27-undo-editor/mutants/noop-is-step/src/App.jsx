import { ABORT, xs } from 'sygnal'

const MIN_SIZE = 16
const MAX_SIZE = 32
const GROUP_MS = 1000

function App({ state }) {
  return (
    <main className="poster-editor">
      <h1>Poster</h1>
      <div className="toolbar">
        <button className="smaller">Smaller</button>
        <button className="larger">Larger</button>
        <label className="bold-option">
          <input type="checkbox" name="bold" checked={state.bold} />
          <span>Bold</span>
        </label>
        <button className="undo" disabled={state.past.length === 0}>
          Undo
        </button>
        <button className="redo" disabled={state.future.length === 0}>
          Redo
        </button>
      </div>
      <label className="field">
        <span>Headline</span>
        <input name="headline" value={state.headline} />
      </label>
      <p className="preview">{`${state.headline} (${state.size}px${state.bold ? ', bold' : ''})`}</p>
    </main>
  )
}

// past / future: snapshots of the poster ({ headline, size, bold }).
// typingAt: time of the latest Headline edit while the newest step is a typing group, else null.
App.initialState = {
  headline: 'Summer sale',
  size: 28,
  bold: false,
  past: [],
  future: [],
  typingAt: null,
}

const snapshot = ({ headline, size, bold }) => ({ headline, size, bold })

// Apply a change as a new step (or, for typing, into the current group).
function change(state, patch, typingAt = null) {
  const next = { ...snapshot(state), ...patch }
  // MUTANT: a change that changes nothing still records a step
  const grouped = typingAt !== null && state.typingAt !== null && typingAt - state.typingAt < GROUP_MS
  const past = grouped ? state.past : [...state.past, snapshot(state)]
  return { ...state, ...next, past, future: [], typingAt }
}

// Ctrl/⌘+Z → 'undo'; Ctrl/⌘+Shift+Z, Ctrl+Y → 'redo'; anything else → null.
function shortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && e.ctrlKey && !e.shiftKey) return 'redo'
  return null
}

App.intent = ({ DOM }) => {
  // preventDefault must happen while the event is dispatched, so it is done here.
  const shortcut$ = DOM.keydown('document')
    .map((e) => {
      const which = shortcut(e)
      if (which) e.preventDefault()
      return which
    })
    .filter(Boolean)
  return {
    SMALLER: DOM.click('.smaller'),
    LARGER: DOM.click('.larger'),
    BOLD: DOM.change('input[name="bold"]').checked(),
    HEADLINE: DOM.input('input[name="headline"]').map((e) => ({ value: e.target.value, at: Date.now() })),
    UNDO: xs.merge(DOM.click('.undo'), shortcut$.filter((s) => s === 'undo')),
    REDO: xs.merge(DOM.click('.redo'), shortcut$.filter((s) => s === 'redo')),
  }
}

App.model = {
  SMALLER: (state) => change(state, { size: Math.max(MIN_SIZE, state.size - 2) }),
  LARGER: (state) => change(state, { size: Math.min(MAX_SIZE, state.size + 2) }),
  BOLD: (state, bold) => change(state, { bold }),
  HEADLINE: (state, { value, at }) => change(state, { headline: value }, at),
  UNDO: (state) => {
    if (state.past.length === 0) return ABORT
    const previous = state.past[state.past.length - 1]
    return { ...state, ...previous, past: state.past.slice(0, -1), future: [snapshot(state), ...state.future], typingAt: null }
  },
  REDO: (state) => {
    if (state.future.length === 0) return ABORT
    const [following, ...rest] = state.future
    return { ...state, ...following, past: [...state.past, snapshot(state)], future: rest, typingAt: null }
  },
}

export default App
