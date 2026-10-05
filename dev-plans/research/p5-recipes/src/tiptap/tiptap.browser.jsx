import { renderComponent } from 'sygnal'
import { Notes } from './Notes.jsx'
import { assert, equal, waitFor, pw } from '../browser-util.js'

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
}
