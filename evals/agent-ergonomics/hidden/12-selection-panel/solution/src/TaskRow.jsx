import { emit } from 'sygnal'

function TaskRow({ state, context }) {
  const classes = ['task-row']
  if (state.done) classes.push('done')
  if (context.selectedTaskId === state.id) classes.push('selected')
  return (
    <div className={classes.join(' ')}>
      <input type="checkbox" className="toggle" checked={state.done} />
      <span className="task-title">{state.title}</span>
      <span className="assignee">{state.assignee}</span>
      <button className="delete">Delete</button>
    </div>
  )
}

TaskRow.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.toggle'),
  DELETE: DOM.click('.delete'),
  SELECT: DOM.click('.task-title'),
})

TaskRow.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
  // Selection lives at the top of the tree; tell it which task was picked.
  SELECT: emit('SELECT_TASK', (state) => state.id),
}

export default TaskRow
