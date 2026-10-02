import { event } from 'sygnal'
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

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length

Editor.model = {
  EDIT: {
    STATE: (state, draft) => ({ ...state, draft }),
    EVENTS: event('DOC_EDITED'),
  },
  SAVE: {
    STATE: (state) => ({ ...state, saved: state.draft }),
    EVENTS: event('DOC_SAVED', (state) => ({ words: countWords(state.draft) })),
  },
}

export default Editor
