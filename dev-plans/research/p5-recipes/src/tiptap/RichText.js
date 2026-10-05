// RichText.js
import { defineWidget } from 'sygnal'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

const editorProps = (props) => ({ attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.label } })

// the state gets the HTML as Tiptap writes it ('Hi' → '<p>Hi</p>'), so update() doesn't see a
// difference and reset the content (and the selection) on the next prop change
const dispatches = new WeakMap()
const normalise = (editor, html) => {
  if (editor.getHTML() !== html) dispatches.get(editor)('edit', editor.getHTML())
}

export const RichText = defineWidget({
  name: 'RichText',
  mount: (el, props, dispatch) => {
    const editor = new Editor({
      element: el,
      extensions: [StarterKit],
      content: props.html,
      editorProps: editorProps(props),
      onUpdate: ({ editor }) => dispatch('edit', editor.getHTML()),
    })
    dispatches.set(editor, dispatch)
    normalise(editor, props.html)
    return editor
  },
  update: (editor, props) => {
    if (props.html !== editor.getHTML()) {
      editor.commands.setContent(props.html, { emitUpdate: false })
      normalise(editor, props.html)
    }
    // a new label (another language): Tiptap's options are read at mount, so set them again
    if (props.label !== editor.options.editorProps.attributes['aria-label']) editor.setOptions({ editorProps: editorProps(props) })
  },
  unmount: (editor) => editor.destroy(),
  events: ['edit'],
  commands: {
    bold: (editor) => editor.chain().focus().toggleBold().run(),
    italic: (editor) => editor.chain().focus().toggleItalic().run(),
  },
})
