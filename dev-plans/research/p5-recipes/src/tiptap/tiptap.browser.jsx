import { renderComponent } from 'sygnal'
import { Notes } from './Notes.jsx'
import { RichText } from './RichText.js'
import { assert, equal, waitFor, pw } from '../browser-util.js'

// a translated label and an un-normalised draft (G-442)
function Draft({ state }) {
  return (
    <section>
      <RichText className="draft" label={state.label} html={state.html} />
      <button type="button" className="french">FR</button>
    </section>
  )
}
Draft.initialState = { label: 'Notes', html: 'Hello' }
Draft.intent = ({ DOM }) => ({ EDIT: DOM.select('.draft').events('edit').detail(), FRENCH: DOM.click('.french') })
Draft.model = { EDIT: (state, html) => ({ ...state, html }), FRENCH: (state) => ({ ...state, label: 'Notes (FR)' }) }

export const tests = {
  async 'Tiptap: typing reaches the state, Bold/Italic commands format the selection, state resets the content, unmount destroys'() {
    const t = renderComponent(Notes, { dom: 'real' })
    await t.ready()
    await waitFor(() => t.query('.body .ProseMirror'), 'editor mounted')
    const editable = t.query('.body .ProseMirror')
    equal(editable.getAttribute('aria-label'), 'Notes', 'editable is labelled')
    equal(editable.getAttribute('role'), 'textbox', 'editable role')
    const editor = t.widget('.body').instance

    await pw('click', '.body .ProseMirror')
    await pw('key', null, 'End')
    await pw('keyboard', null, ' world')
    await t.waitForState((state) => state.html === '<p>Hello world</p>')

    // select some text, then the toolbar buttons (focus moves to them; the commands refocus the editor)
    await pw('dblclick', '.body .ProseMirror p')
    await pw('click', '.make-bold')
    await t.waitForState((state) => /<strong>/.test(state.html))
    await pw('click', '.make-italic')
    await t.waitForState((state) => /<em>/.test(state.html))
    assert(editor.isFocused, 'the command focused the editor')

    // state → editor (no edit event echoed back for a content set from state)
    await pw('click', '.clear')
    await waitFor(() => editor.getHTML() === '<p></p>', 'content cleared')
    await t.settle()
    equal(t.state.html, '<p></p>', 'state after clear')
    equal(t.query('.saved').textContent, '7 characters saved')

    t.dispose()
    assert(editor.isDestroyed, 'destroyed on unmount')
  },

  async 'Tiptap: an un-normalised draft is normalised at mount; a new label reaches the editable without resetting the content'() {
    const t = renderComponent(Draft, { dom: 'real' })
    await t.ready()
    await waitFor(() => t.query('.draft .ProseMirror'), 'editor mounted')
    await t.waitForState((state) => state.html === '<p>Hello</p>')
    const editor = t.widget('.draft').instance
    editor.commands.setTextSelection(3)
    await pw('click', '.french')
    await waitFor(() => t.query('.draft .ProseMirror').getAttribute('aria-label') === 'Notes (FR)', 'label updated')
    equal(t.query('.draft .ProseMirror').getAttribute('role'), 'textbox', 'other attributes kept')
    equal(editor.state.selection.from, 3, 'content not reset by the label change')
    t.dispose()
  },
}
