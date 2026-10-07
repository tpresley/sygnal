import { useId } from 'react'
import { ROLES } from './pipeline.js'

export default function AddCandidateForm({ draft, onChange, onAdd }) {
  const id = useId()
  function handleSubmit(e) {
    e.preventDefault()
    onAdd()
  }
  return (
    <form className="add-candidate" onSubmit={handleSubmit}>
      <h2>Add a candidate</h2>
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} name="name" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
      <label htmlFor={`${id}-role`}>Role</label>
      <select id={`${id}-role`} name="role" value={draft.role} onChange={(e) => onChange({ role: e.target.value })}>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
      <button type="submit">Add candidate</button>
      {draft.error && <p className="error">{draft.error}</p>}
    </form>
  )
}
