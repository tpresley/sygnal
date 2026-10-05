// CodeEditor.js
import { defineWidget } from 'sygnal'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'

// the label can change (another language): it lives in a compartment that update() reconfigures
const labelling = new Compartment()
const label = (props) => EditorView.contentAttributes.of({ 'aria-label': props.label })

export const CodeEditor = defineWidget({
  name: 'CodeEditor',
  mount: (el, props, dispatch) => new EditorView({
    parent: el,
    doc: props.code,
    extensions: [
      basicSetup,
      javascript(),
      labelling.of(label(props)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) dispatch('edit', update.state.doc.toString())
      }),
    ],
  }),
  update: (view, props) => {
    const code = view.state.doc.toString()
    if (props.code !== code) view.dispatch({ changes: { from: 0, to: code.length, insert: props.code } })
    if (props.label !== view.contentDOM.getAttribute('aria-label')) view.dispatch({ effects: labelling.reconfigure(label(props)) })
  },
  unmount: (view) => view.destroy(),
  events: ['edit'],
  commands: { focus: (view) => view.focus() },
})
