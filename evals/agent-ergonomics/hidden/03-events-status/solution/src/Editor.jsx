function Editor({ state }) {
  return (
    <section className="editor">
      <textarea className="draft" value={state.draft} placeholder="Write something..." />
      <button className="save">Save</button>
    </section>
  )
}

Editor.intent = ({ DOM }) => ({
  EDIT: DOM.input('.draft').value(),
  SAVE: DOM.click('.save'),
})

const countWords = (text) => text.split(/\s+/).filter(Boolean).length

Editor.model = {
  EDIT: {
    STATE: (state, draft) => ({ ...state, draft }),
    EVENTS: () => ({ type: 'DOC_EDITED' }),
  },
  SAVE: {
    STATE: (state) => ({ ...state, saved: state.draft }),
    EVENTS: (state) => ({ type: 'DOC_SAVED', data: { words: countWords(state.draft) } }),
  },
}

export default Editor
