import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { TaskState } from './types'

const intent = ({ DOM }: IntentSources<TaskState>) => ({
  TOGGLE: DOM.change('.toggle'),
  DELETE: DOM.click('.delete'),
})

type TaskRowActions = ActionsOf<typeof intent>

const TaskRow: Component<TaskState, {}, {}, TaskRowActions> = ({ state }) => (
  <div className={state.done ? 'task-row done' : 'task-row'}>
    <input type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
    <span className="task-title">{state.title}</span>
    <span className="assignee">{state.assignee}</span>
    <button className="delete">Delete</button>
  </div>
)

TaskRow.intent = intent

TaskRow.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default TaskRow
