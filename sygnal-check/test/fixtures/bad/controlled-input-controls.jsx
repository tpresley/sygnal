// SYG111 through controls (G-203): a control for an input/textarea/select is checked like the
// element it renders, and a listener on another control doesn't count.
import { controls, xs } from 'sygnal'

const { Draft, Notes, Kind, Done, Save, Row } = controls({
  Draft: 'input', Notes: 'textarea', Kind: 'select', Done: 'input', Save: 'button', Row: 'div',
})
const Form = controls({ Title: 'input' })

function Editor({ state }) {
  return (
    <div className="editor">
      <Draft
        value={state.draft /* expect: SYG111 */}
        aria-label="draft" />
      <Notes
        value={state.notes /* expect: SYG111 */}
        aria-label="notes" />
      <Kind
        value={state.kind /* expect: SYG111 */}
        aria-label="kind">
        <option value="a">A</option>
      </Kind>
      <Done type="checkbox"
        checked={state.done /* expect: SYG111 */}
        aria-label="done" />
      <Form.Title
        value="" // expect: SYG111
        aria-label="title" />
      <Row>
        <input className="inner"
          value={state.inner /* expect: SYG111 */}
          aria-label="inner" />
      </Row>
      <Save>Save</Save>
    </div>
  )
}
Editor.initialState = { draft: '', notes: '', kind: 'a', done: false, inner: '' }
Editor.intent = ({ DOM }) => ({
  // Draft is saved on blur only; the input/change listeners sit on other controls
  SAVE: xs.merge(DOM.blur(Draft).map(e => e.target.value), DOM.click(Save)),
  NOTES: DOM.input(Save),
  KIND: DOM.select(Save).events('change'),
  // focus doesn't update the value
  FOCUS: xs.merge(DOM.focus(Notes), DOM.focus(Kind), DOM.focus(Done), DOM.focus(Row), DOM.focus(Form.Title)),
})
Editor.model = {
  SAVE: (s) => s,
  NOTES: (s) => s,
  KIND: (s) => s,
  FOCUS: (s) => s,
}

export default Editor
