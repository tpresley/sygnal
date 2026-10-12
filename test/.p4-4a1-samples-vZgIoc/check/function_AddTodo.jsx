import { ABORT, set, toggle } from 'sygnal'
function AddTodo({ state }) {
  return (
    <div>
      <input className="draft" aria-label="New todo" value={state.draft} />
      <button className="add">Add</button>
      <button className="help">?</button>
      {state.showHelp && <p className="hint">Type, then Add</p>}
    </div>
  )
}
AddTodo.initialState = { draft: '', todos: [], nextId: 1, showHelp: false }
AddTodo.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.draft').value(),   // a bound value={...} needs an input listener (SYG111)
  ADD:   DOM.click('.add'),
  HELP:  DOM.click('.help'),
})
AddTodo.model = {
  DRAFT: set((state, draft) => ({ draft })),           // merges: ({ ...state, draft }); never set('draft') (SYG221)
  ADD: (state) => {
    const text = state.draft.trim()
    if (!text) return ABORT                              // "no change" (returning the same `state` works too)
    return { ...state, draft: '', nextId: state.nextId + 1, todos: [...state.todos, { id: state.nextId, text }] }
  },
  HELP: toggle('showHelp'),
}
