import { event } from 'sygnal'
import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { TaskState, AppContext } from './types'

const intent = ({ DOM }: IntentSources<TaskState>) => ({
  TOGGLE: DOM.change('.toggle'),
  DELETE: DOM.click('.delete'),
  SELECT: DOM.click('.title'),
})

type TaskRowActions = ActionsOf<typeof intent>

const TaskRow: Component<TaskState, {}, {}, TaskRowActions, {}, AppContext> = ({ state, context }) => {
  const classes = ['task-row']
  if (state.done) classes.push('done')
  if (context?.selectedTaskId === state.id) classes.push('selected')
  return (
    <div className={classes.join(' ')}>
      <input type="checkbox" className="toggle" checked={state.done} />
      <span className="task-title">{state.title}</span>
      <span className="assignee">{state.assignee}</span>
      <button className="delete">Delete</button>
    </div>
  )
}

TaskRow.intent = intent

TaskRow.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
  // Selection lives at the top of the tree; tell it which task was picked.
  SELECT: {
    EVENTS: event('SELECT_TASK', (state) => state.id),
  },
}

export default TaskRow
