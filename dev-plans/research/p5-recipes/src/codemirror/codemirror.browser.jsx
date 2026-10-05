import { renderComponent } from 'sygnal'
import { Snippet } from './Snippet.jsx'
import { CodeEditor } from './CodeEditor.js'
import { assert, equal, waitFor, pw } from '../browser-util.js'

// a translated label (G-442)
function Labelled({ state }) {
  return (
    <section>
      <CodeEditor className="labelled" label={state.label} code="x" />
      <button type="button" className="french">FR</button>
    </section>
  )
}
Labelled.initialState = { label: 'Snippet' }
Labelled.intent = ({ DOM }) => ({ FRENCH: DOM.click('.french') })
Labelled.model = { FRENCH: (state) => ({ ...state, label: 'Extrait' }) }

export const tests = {
  async 'CodeMirror: the focus command, typing reaches the state, Reset replaces the document, unmount destroys'() {
    const t = renderComponent(Snippet, { dom: 'real' })
    await t.ready()
    await waitFor(() => t.query('.code .cm-content'), 'editor mounted')
    equal(t.query('.code .cm-content').getAttribute('aria-label'), 'Snippet', 'content is labelled')
    const view = t.widget('.code').instance

    // the declared focus command wins over the host <div>'s own focus()
    await pw('click', '.edit-code')
    await waitFor(() => view.hasFocus, 'focused by the command')

    view.dispatch({ selection: { anchor: view.state.doc.length } })
    await pw('keyboard', null, 'answer')
    await t.waitForState((state) => state.code === 'const answer = 42\nanswer')
    equal(t.query('.lines').textContent, '2 lines')

    await pw('click', '.reset')
    await waitFor(() => view.state.doc.toString() === 'const answer = 42\n', 'document reset from state')
    await t.settle()
    equal(t.state.code, 'const answer = 42\n', 'state after reset')

    t.dispose()
    assert(!view.dom.isConnected, 'destroyed on unmount')
  },

  async 'CodeMirror: a new label prop reaches .cm-content (a compartment), the document stays'() {
    const t = renderComponent(Labelled, { dom: 'real' })
    await t.ready()
    await waitFor(() => t.query('.labelled .cm-content'), 'editor mounted')
    const view = t.widget('.labelled').instance
    equal(t.query('.labelled .cm-content').getAttribute('aria-label'), 'Snippet')
    await pw('click', '.french')
    await waitFor(() => t.query('.labelled .cm-content').getAttribute('aria-label') === 'Extrait', 'label updated')
    assert(t.widget('.labelled').instance === view, 'same view')
    equal(view.state.doc.toString(), 'x')
    t.dispose()
  },
}
