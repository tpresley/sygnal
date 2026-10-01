function DetailsPanel({ context }) {
  const task = context.selectedTask
  if (!task) {
    return (
      <aside className="details">
        <h2>Details</h2>
        <p className="placeholder">Select a task to see its details.</p>
      </aside>
    )
  }
  return (
    <aside className="details">
      <h2>Details</h2>
      <h3 className="details-title">{task.title}</h3>
      {/* One text child per line: patching the placeholder <p> into a <p> with
          several children leaves its old text behind (framework bug). */}
      <p className="details-project">{`Project: ${task.projectName}`}</p>
      <p className="details-assignee">{`Assignee: ${task.assignee}`}</p>
      <p className="details-status">{`Status: ${task.done ? 'Done' : 'Open'}`}</p>
    </aside>
  )
}

export default DetailsPanel
