import type { Component } from 'sygnal'

type State = {
  id: number
  text: string
  done: boolean
}

type Actions = {
  TOGGLE: Event
  DELETE: Event
}

type TaskItem = Component<State, {}, {}, Actions>

const TaskItem: TaskItem = function ({ state }) {
  return (
    <div className={`task-item ${state.done ? 'done' : ''}`}>
      <button className="toggle">{state.done ? '\u2713' : '\u25CB'}</button>
      <span className="task-text">{state.text}</span>
      <button className="delete">x</button>
    </div>
  )
}

TaskItem.intent = ({ DOM }) => ({
  TOGGLE: DOM.click('.toggle'),
  DELETE: DOM.click('.delete'),
})

TaskItem.model = {
  TOGGLE: {
    PARENT: (state) => state.id,
  },
  DELETE: () => undefined,
}

export default TaskItem
