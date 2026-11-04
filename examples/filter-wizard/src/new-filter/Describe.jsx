import { SOURCES } from '../filters.js'

// Step 1. It only writes the shared draft: `state.draft` is the flow's, shared by every step.
function Describe({ state }) {
  const { name, source } = state.draft
  return (
    <div className="step">
      <h2 data-router-focus="">Describe the filter</h2>
      <label>Name <input className="name" value={name} /></label>
      <fieldset>
        <legend>What does it watch?</legend>
        {Object.entries(SOURCES).map(([value, label]) => (
          <label><input type="radio" name="source" className="source" value={value} checked={source === value} /> {label}</label>
        ))}
      </fieldset>
    </div>
  )
}

Describe.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  SOURCE: DOM.change('.source').value(),
})

Describe.model = {
  NAME: (state, name) => ({ ...state, draft: { ...state.draft, name } }),
  SOURCE: (state, source) => ({ ...state, draft: { ...state.draft, source } }),
}

export default Describe
