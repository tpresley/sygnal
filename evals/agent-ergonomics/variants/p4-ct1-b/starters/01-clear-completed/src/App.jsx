import { controls } from 'sygnal'

const { Toggle } = controls({ Toggle: 'input' })

function App({ state }) {
  const remaining = state.tasks.filter((task) => !task.done).length

  return (
    <div className="app">
      <h1>Tasks</h1>
      <ul className="task-list">
        {state.tasks.map((task) => (
          <li className={task.done ? 'task done' : 'task'} key={task.id}>
            <Toggle
              type="checkbox"
              className="toggle"
              aria-label="Done"
              checked={task.done}
              data-id={String(task.id)}
            />
            <span className="title">{task.title}</span>
          </li>
        ))}
      </ul>
      <p className="summary">{remaining} remaining</p>
    </div>
  )
}

App.initialState = {
  tasks: [
    { id: 1, title: 'Buy milk', done: true },
    { id: 2, title: 'Walk the dog', done: false },
    { id: 3, title: 'Write report', done: true },
  ],
}

App.intent = ({ DOM }) => ({
  TOGGLE: DOM.change(Toggle).data('id', Number),
})

App.model = {
  TOGGLE: (state, id) => ({
    ...state,
    tasks: state.tasks.map((task) =>
      task.id === id ? { ...task, done: !task.done } : task
    ),
  }),
}

export default App
