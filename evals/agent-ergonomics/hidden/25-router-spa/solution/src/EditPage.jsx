import { href, taskOf } from './routes.js'

function EditPage({ state }) {
  const task = taskOf(state)
  if (!task) return <section className="edit-page"></section>
  return (
    <section className="edit-page">
      <h1>Edit task</h1>
      <input name="title" value={state.draft ?? task.title} />
      <button className="save">Save</button>
      <a href={href('task', { id: task.id })}>Cancel</a>
      {state.leaving && (
        <div className="confirm">
          <p>Discard your changes?</p>
          <button className="leave">Leave</button>
          <button className="stay">Stay</button>
        </div>
      )}
    </section>
  )
}

EditPage.intent = ({ DOM }) => ({
  TYPE: DOM.input('input[name="title"]').value(),
  SAVE: DOM.click('.save'),
  LEAVE: DOM.click('.leave'),
  STAY: DOM.click('.stay'),
})

// The router blocks navigation while the field differs from the saved title; an attempt
// arrives as CONFIRM_LEAVE with the navigation to make (`proceed`).
EditPage.model = {
  TYPE: {
    STATE: (state, draft) => ({ ...state, draft }),
    ROUTER: (state, draft) => (draft !== taskOf(state).title ? { block: 'CONFIRM_LEAVE' } : { block: false }),
  },
  CONFIRM_LEAVE: (state, attempt) => ({ ...state, leaving: attempt.proceed }),
  STAY: (state) => ({ ...state, leaving: null }),
  LEAVE: {
    STATE: (state) => ({ ...state, draft: null, leaving: null }),
    ROUTER: (state) => ({ ...state.leaving, block: false }),
  },
  SAVE: {
    STATE: (state) => ({
      ...state,
      draft: null,
      tasks: state.tasks.map((t) => (t === taskOf(state) ? { ...t, title: state.draft ?? t.title } : t)),
    }),
    ROUTER: (state) => ({ to: 'task', params: { id: taskOf(state).id }, block: false }),
  },
}

export default EditPage
