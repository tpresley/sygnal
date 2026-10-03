import { useState } from 'react'

export default function EditPage({ task, onSave, onCancel }) {
  const [draft, setDraft] = useState(task.title)

  return (
    <section className="edit-page">
      <h1>Edit task</h1>
      <input name="title" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button className="save" onClick={() => onSave(draft)}>
        Save
      </button>
      <button className="cancel" onClick={onCancel}>
        Cancel
      </button>
    </section>
  )
}
