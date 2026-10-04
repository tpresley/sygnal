function EditPage({ state }) {
  return (
    <section className="edit-page">
      <h1>Edit task</h1>
      <input name="title" aria-label="Title" value={state.draft} />
      <button className="save">Save</button>
      <button className="cancel">Cancel</button>
    </section>
  )
}

EditPage.intent = ({ DOM }) => ({
  TYPE: DOM.input('input[name="title"]').value(),
  SAVE: DOM.click('.save'),
  CANCEL: DOM.click('.cancel'),
})

EditPage.model = {
  TYPE: (state, draft) => ({ ...state, draft }),
  SAVE: (state) => ({
    ...state,
    page: 'task',
    tasks: state.tasks.map((t) => (t.id === state.taskId ? { ...t, title: state.draft } : t)),
  }),
  CANCEL: (state) => ({ ...state, page: 'task' }),
}

export default EditPage
