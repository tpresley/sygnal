import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { Task } from './types'

const intent = ({ DOM }: IntentSources<Task>) => ({
  TOGGLE: DOM.change('.toggle'),
})

type TaskItemActions = ActionsOf<typeof intent>

const TaskItem: Component<Task, {}, {}, TaskItemActions> = ({ state }) => (
  <div className={state.done ? 'task done' : 'task'}>
    <input type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
    <span className="title">{state.title}</span>
  </div>
)

TaskItem.intent = intent

TaskItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
}

export default TaskItem
