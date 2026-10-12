import { undo } from 'sygnal'
export function Editor({ state }) {
  return (
    <div>
      <label>Note <textarea className="note" value={state.doc.text} /></label>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
    </div>
  )
}
Editor.initialState = { doc: { text: '' } }
Editor.uses = { history: undo({ key: 'doc', undo: '.undo', redo: '.redo' }) }
Editor.intent = ({ DOM }) => ({ TYPE: DOM.input('.note').value() })
Editor.model = { TYPE: (state, text) => ({ ...state, doc: { ...state.doc, text } }) }
