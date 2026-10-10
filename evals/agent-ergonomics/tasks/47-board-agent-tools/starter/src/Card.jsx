import { COLUMNS } from './columns.js'

function Card({ state }) {
  return (
    <li className="card">
      <span className="title">{state.title}</span>
      <select className="move" aria-label={`Move ${state.title}`} value={state.column}>
        {COLUMNS.map((c) => <option value={c.id}>{c.label}</option>)}
      </select>
      <button type="button" className="remove" aria-label={`Remove ${state.title}`}>Remove</button>
    </li>
  )
}

Card.intent = ({ DOM }) => ({
  MOVE: DOM.change('.move').value(),
  REMOVE: DOM.click('.remove'),
})

Card.model = {
  MOVE: (state, column) => ({ ...state, column }),
  REMOVE: () => undefined,
}

export default Card
