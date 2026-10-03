import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { TaskState } from './types'
import { controls } from 'sygnal'

const { Toggle, Delete } = controls({ Toggle: 'input', Delete: 'button' })

const intent = ({ DOM }: IntentSources<TaskState>) => ({
  TOGGLE: DOM.change(Toggle),
  DELETE: DOM.click(Delete),
})

type TaskRowActions = ActionsOf<typeof intent>

const TaskRow: Component<TaskState, {}, {}, TaskRowActions> = ({ state }) => (
  <div className={state.done ? 'task-row done' : 'task-row'}>
    <Toggle type="checkbox" className="toggle" checked={state.done} />
    <span className="task-title">{state.title}</span>
    <span className="assignee">{state.assignee}</span>
    <Delete className="delete">Delete</Delete>
  </div>
)

TaskRow.intent = intent

TaskRow.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default TaskRow
