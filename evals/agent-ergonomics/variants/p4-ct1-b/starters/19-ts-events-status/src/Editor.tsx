import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { EditorState } from './types'
import { controls } from 'sygnal'

const { Draft, Save } = controls({ Draft: 'textarea', Save: 'button' })

const intent = ({ DOM }: IntentSources<EditorState>) => ({
  EDIT: DOM.input(Draft).value(),
  SAVE: DOM.click(Save),
})

type EditorActions = ActionsOf<typeof intent>

const Editor: Component<EditorState, any, {}, EditorActions> = ({ state }: { state: EditorState }) => (
  <section className="editor">
    <Draft className="draft" value={state.draft} placeholder="Write something..." />
    <Save className="save">Save</Save>
  </section>
)

Editor.intent = intent

Editor.model = {
  EDIT: (state, draft) => ({ ...state, draft }),
  SAVE: (state) => ({ ...state, saved: state.draft }),
}

export default Editor
