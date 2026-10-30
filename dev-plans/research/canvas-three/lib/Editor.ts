/**
 * <Editor>: CodeMirror 6 as an island with a controlled value (controlled.ts).
 *
 *   <Editor className="code" value={state.text} strict />
 *   intent: EDIT: DOM.select('.code').events('change').map(e => e.detail)   // or .value()
 *
 * - The user's edits: a `change` event with the text as `detail` (the host's `value` reads it
 *   too, so `.value()` works as on a <textarea>).
 * - The app's value: written only when the prop changed to something the editor didn't emit
 *   itself (a reset, a clamp, a load), as one minimal change, so the selection maps through it.
 *   The write carries an annotation, and the listener ignores it: no echo event.
 * - `strict`: an edit the app didn't take (the prop didn't move: a model that returned ABORT) is
 *   reverted once the app has had its turn (a macrotask later).
 */
import {EditorState, Annotation} from '@codemirror/state'
import {EditorView} from '@codemirror/view'
import {defineIsland} from './island'
import {controlled} from './controlled'

const External = Annotation.define<boolean>()

export const Editor = defineIsland({
  name: 'editor',
  mount(el, props, emit) {
    const inst: any = {prop: props.value ?? '', edits: 0}
    const listener = EditorView.updateListener.of(u => {
      if (!u.docChanged || u.transactions.some(t => t.annotation(External))) return
      const v = u.state.doc.toString()
      inst.edits++
      inst.c.local(v)
      emit('change', v)
      if (props.strict) setTimeout(() => inst.c.settle(inst.prop), 0)
    })
    const view = inst.view = new EditorView({parent: el, state: EditorState.create({doc: inst.prop, extensions: [listener, ...(props.extensions || [])]})})
    inst.c = controlled<string>({
      write(v) {
        const cur = view.state.doc.toString()
        // the smallest change: common prefix and suffix kept (the cursor maps through it)
        let a = 0, b = 0
        while (a < cur.length && a < v.length && cur[a] == v[a]) a++
        while (b < cur.length - a && b < v.length - a && cur[cur.length - 1 - b] == v[v.length - 1 - b]) b++
        view.dispatch({changes: {from: a, to: cur.length - b, insert: v.slice(a, v.length - b)}, annotations: External.of(true)})
      },
    })
    inst.c.prop(inst.prop)
    Object.defineProperty(el, 'value', {get: () => view.state.doc.toString(), configurable: true})
    return inst
  },
  update(inst, props) {
    inst.prop = props.value ?? ''
    inst.c.prop(inst.prop)
  },
  unmount: (inst) => inst.view.destroy(),
})
