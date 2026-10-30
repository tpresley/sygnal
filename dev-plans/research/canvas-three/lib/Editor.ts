/**
 * <Editor>: CodeMirror 6 as a widget with a controlled value (defineWidget's `value`, experimental).
 *
 *   <Editor className="code" value={state.text} strict />
 *   intent: EDIT: DOM.select('.code').events('change').value()      // or .map(e => e.detail)
 *
 * - The user's edits: `dispatch('change', text)`; the widget runtime records each one, so its
 *   echo (the same text coming back as the prop) is never written.
 * - The app's value (a reset, a clamp, a load): `value.write`, as one minimal change, so the
 *   selection maps through it. It carries an annotation and the listener ignores it: no event.
 * - `strict`: an edit the model didn't take (ABORT) is written back after the app's turn.
 */
import {EditorState, Annotation} from '@codemirror/state'
import {EditorView} from '@codemirror/view'
import {defineWidget} from 'sygnal'

const External = Annotation.define<boolean>()

export const Editor = defineWidget({
  name: 'Editor',
  events: ['change'],
  mount(el: any, props: any, dispatch: any) {
    const listener = EditorView.updateListener.of(u => {
      if (u.docChanged && !u.transactions.some(t => t.annotation(External))) dispatch('change', u.state.doc.toString())
    })
    return new EditorView({parent: el, state: EditorState.create({doc: props.value ?? '', extensions: [listener, ...(props.extensions || [])]})})
  },
  value: {
    write(view: EditorView, v: string) {
      const cur = view.state.doc.toString()
      // the smallest change: common prefix and suffix kept (the cursor maps through it)
      let a = 0, b = 0
      while (a < cur.length && a < v.length && cur[a] == v[a]) a++
      while (b < cur.length - a && b < v.length - a && cur[cur.length - 1 - b] == v[v.length - 1 - b]) b++
      view.dispatch({changes: {from: a, to: cur.length - b, insert: v.slice(a, v.length - b)}, annotations: External.of(true)})
    },
    read: (view: EditorView) => view.state.doc.toString(),
  },
  unmount: (view: EditorView) => view.destroy(),
})
