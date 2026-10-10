import { z } from 'zod'
import { COLUMNS, COLUMN_IDS } from './columns.js'

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
  // the same data from the select and from an agent's card_move call
  MOVE: DOM.change('.move').value().map((column) => ({ column })),
  REMOVE: DOM.click('.remove'),
})

Card.model = {
  MOVE: (state, { column }) => ({ ...state, column }),
  REMOVE: () => undefined,
}

Card.agent = {
  name: 'card',
  label: (state) => state.title,
  actions: {
    MOVE: {
      description: 'Move the card to another column',
      input: z.object({ column: z.enum(COLUMN_IDS).describe('The column: todo, doing or done') }),
    },
    REMOVE: { description: 'Remove the card from the board', consequential: true },
  },
}

export default Card
