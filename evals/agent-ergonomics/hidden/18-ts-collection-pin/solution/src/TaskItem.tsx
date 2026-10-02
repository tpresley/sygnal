import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { Task } from './types'

const intent = ({ DOM }: IntentSources<Task>) => ({
  TOGGLE: DOM.change('.toggle'),
  PIN: DOM.click('.pin'),
})

type TaskItemActions = ActionsOf<typeof intent>

/** What a row sends its parent when its Pin button is clicked. */
export type PinRequest = { taskId: number }

const TaskItem: Component<Task, {}, {}, TaskItemActions, {}, {}, { PARENT: PinRequest }> = ({ state }) => (
  <div className={state.done ? 'task done' : 'task'}>
    <input type="checkbox" className="toggle" checked={state.done} />
    <span className="title">{state.title}</span>
    <button className="pin">Pin</button>
  </div>
)

TaskItem.intent = intent

TaskItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  PIN: {
    PARENT: (state) => ({ taskId: state.id }),
  },
}

export default TaskItem
