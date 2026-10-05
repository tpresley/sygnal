// CodeEditor.js
import { defineWidget } from 'sygnal'
import { EditorView, basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'

export const CodeEditor = defineWidget({
  name: 'CodeEditor',
  mount: (el, props, dispatch) => new EditorView({
    parent: el,
    doc: props.code,
    extensions: [
      basicSetup,
      javascript(),
      EditorView.contentAttributes.of({ 'aria-label': props.label }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) dispatch('edit', update.state.doc.toString())
      }),
    ],
  }),
  update: (view, props) => {
    const code = view.state.doc.toString()
    if (props.code !== code) view.dispatch({ changes: { from: 0, to: code.length, insert: props.code } })
  },
  unmount: (view) => view.destroy(),
  events: ['edit'],
  commands: { focus: (view) => view.focus() },
})
