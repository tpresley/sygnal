// SYG111 through controls (G-203): a control for a field whose intent listens to it (directly,
// through a namespace, or on an ancestor control) is not reported; spec-object controls are
// skipped (their element isn't known statically).
import { controls } from 'sygnal'

const { Draft, Done, Kind, Row, Picker } = controls({
  Draft: 'input', Done: 'input', Kind: 'select', Row: 'div',
  Picker: { kind: 'picker', vnode: (props, children, h) => h('input', props, ...children) },
})
const Form = controls({ Title: 'input' })

function Editor({ state }) {
  return (
    <div className="editor">
      <Draft value={state.draft} aria-label="draft" />
      <Done type="checkbox" checked={state.done} aria-label="done" />
      <Kind value={state.kind} aria-label="kind"><option value="a">A</option></Kind>
      <Form.Title value={state.title} aria-label="title" />
      <Row><input className="inner" value={state.inner} aria-label="inner" /></Row>
      <Draft value={state.draft} readOnly aria-label="draft copy" />
      <Picker value={state.picked} aria-label="picker" />
    </div>
  )
}
Editor.initialState = { draft: '', done: false, kind: 'a', title: '', inner: '', picked: '' }
Editor.intent = ({ DOM }) => ({
  DRAFT: DOM.input(Draft).value(),
  DONE: DOM.change(Done).checked(),
  KIND: DOM.select(Kind).events('change'),
  TITLE: DOM.input(Form.Title).value(),
  INNER: DOM.select(Row).events('input'),
  PICKED: DOM.blur(Picker),
})
Editor.model = {
  DRAFT: (s, draft) => ({ ...s, draft }),
  DONE: (s, done) => ({ ...s, done }),
  KIND: (s) => s,
  TITLE: (s, title) => ({ ...s, title }),
  INNER: (s) => s,
  PICKED: (s) => s,
}

export default Editor
