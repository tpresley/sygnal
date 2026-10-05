// RichText.js
import { defineWidget } from 'sygnal'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

const editorProps = (props) => ({ attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.label } })

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
    // the state gets the HTML as Tiptap writes it ('Hi' → '<p>Hi</p>'), so update() doesn't
    // see a difference and reset the content on the next prop change
    if (editor.getHTML() !== props.html) dispatch('edit', editor.getHTML())
    return editor
  },
  update: (editor, props) => {
    if (props.html !== editor.getHTML()) editor.commands.setContent(props.html, { emitUpdate: false })
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
