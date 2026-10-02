import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { EditorState } from './types'

const intent = ({ DOM }: IntentSources<EditorState>) => ({
  EDIT: DOM.input('.draft').value(),
  SAVE: DOM.click('.save'),
})

type EditorActions = ActionsOf<typeof intent>

const Editor: Component<EditorState, any, {}, EditorActions> = ({ state }: { state: EditorState }) => (
  <section className="editor">
    <textarea className="draft" value={state.draft} placeholder="Write something..." />
    <button className="save">Save</button>
  </section>
)

Editor.intent = intent

Editor.model = {
  EDIT: (state, draft) => ({ ...state, draft }),
  SAVE: (state) => ({ ...state, saved: state.draft }),
}

export default Editor
