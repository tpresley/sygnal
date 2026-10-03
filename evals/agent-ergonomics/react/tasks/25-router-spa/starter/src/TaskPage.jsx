export default function TaskPage({ task, onEdit }) {
  return (
    <section className="task-page">
      <h1>{task ? task.title : ''}</h1>
      <button className="edit" onClick={onEdit}>
        Edit
      </button>
    </section>
  )
}
