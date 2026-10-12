import { debounce } from 'sygnal'
export function Notes({ state }) {
  return <div><label>Notes <textarea className="notes" value={state.text} /></label><p className="saved">{state.saved}</p></div>
}
Notes.initialState = { text: '', saved: '' }
Notes.intent = ({ DOM, STATE }) => ({
  EDIT: DOM.input('.notes').value(),
  SAVE: STATE.watch(state => state.text).compose(debounce(1000)),
})
Notes.model = {
  EDIT: (state, text) => ({ ...state, text }),
  SAVE: (state, text) => ({ ...state, saved: text }),
}
