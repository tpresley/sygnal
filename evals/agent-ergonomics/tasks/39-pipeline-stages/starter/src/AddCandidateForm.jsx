import { ABORT, set } from 'sygnal'
import { ROLES } from './pipeline.js'

function AddCandidateForm({ state, uid }) {
  return (
    <form className="add-candidate">
      <h2>Add a candidate</h2>
      <label for={uid('name')}>Name</label>
      <input id={uid('name')} name="name" value={state.name} />
      <label for={uid('role')}>Role</label>
      <select id={uid('role')} name="role" value={state.role}>
        {ROLES.map((role) => (
          <option value={role}>{role}</option>
        ))}
      </select>
      <button type="submit">Add candidate</button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  )
}

AddCandidateForm.intent = ({ DOM }) => ({
  NAME: DOM.input('[name="name"]').value(),
  ROLE: DOM.change('[name="role"]').value(),
  SUBMIT: DOM.select('.add-candidate').events('submit', { preventDefault: true }),
})

AddCandidateForm.model = {
  NAME: set((state, name) => ({ name })),
  ROLE: set((state, role) => ({ role })),
  SUBMIT: {
    STATE: (state) => (state.name.trim() ? { ...state, name: '', error: '' } : { ...state, error: 'Enter a name.' }),
    // The parent adds the candidate.
    PARENT: (state) => (state.name.trim() ? { name: state.name.trim(), role: state.role } : ABORT),
  },
}

export default AddCandidateForm
