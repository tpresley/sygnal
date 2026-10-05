// RichText.js
import { defineWidget } from 'sygnal'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

export const RichText = defineWidget({
  name: 'RichText',
  mount: (el, props, dispatch) => new Editor({
    element: el,
    extensions: [StarterKit],
    content: props.html,
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.label } },
    onUpdate: ({ editor }) => dispatch('edit', editor.getHTML()),
  }),
  update: (editor, props) => {
    if (props.html !== editor.getHTML()) editor.commands.setContent(props.html, { emitUpdate: false })
  },
  unmount: (editor) => editor.destroy(),
  events: ['edit'],
  commands: {
    bold: (editor) => editor.chain().focus().toggleBold().run(),
    italic: (editor) => editor.chain().focus().toggleItalic().run(),
  },
})
