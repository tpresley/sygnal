// A working part: ticks survive recomposing, because the tasks live in the root state (state="tasks").
function Checklist({ state }) {
  return (
    <ul className="checklist">
      {state.map((task) => (
        <li className={task.done ? 'done' : ''}>
          <label>
            <input type="checkbox" className="task-toggle" checked={task.done} data={{ id: task.id }} /> {task.text}
          </label>
        </li>
      ))}
    </ul>
  )
}

Checklist.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.task-toggle').data('id', Number),
})

Checklist.model = {
  TOGGLE: (tasks, id) => tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
}

export default Checklist
