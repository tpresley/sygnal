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

Editor.model = {
  EDIT: (state, draft) => ({ ...state, draft }),
  SAVE: (state) => ({ ...state, saved: state.draft }),
}

export default Editor
