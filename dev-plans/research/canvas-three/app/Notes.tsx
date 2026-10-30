/** CodeMirror as an island with a controlled value (lib/Editor.ts): the app clamps and rejects edits. */
import {ABORT} from 'sygnal'
import {Editor} from '../lib/Editor'

export function Notes({state}: any) {
  return (
    <section>
      <Editor className="code" value={state.text} strict />
      <p className="count">{state.text.length} / 20</p>
      <button className="reset">Reset</button>
    </section>
  )
}
Notes.initialState = {text: 'hello', edits: 0}
Notes.intent = ({DOM}: any) => ({
  EDIT: DOM.select('.code').events('change').map((e: any) => e.detail),
  RESET: DOM.click('.reset'),
})
Notes.model = {
  // the app clamps (a transform) and rejects digits (a model that doesn't take the edit)
  EDIT: (s: any, text: string) => /\d/.test(text) ? ABORT : {...s, text: text.slice(0, 20), edits: s.edits + 1},
  RESET: (s: any) => ({...s, text: ''}),
}
