import { z } from 'zod'

function Item({ state }) {
  return (
    <li className="item">
      <label>
        <input type="checkbox" className="packed" checked={state.packed} /> {state.name}
      </label>
      <span className="quantity">{`×${state.quantity}`}</span>
      <button type="button" className="remove" aria-label={`Remove ${state.name}`}>Remove</button>
    </li>
  )
}

Item.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.packed'),
  REMOVE: DOM.click('.remove'),
})

Item.model = {
  TOGGLE: (state) => ({ ...state, packed: !state.packed }),
  SET_PACKED: (state, { packed }) => ({ ...state, packed }),
  REMOVE: () => undefined,
}

Item.agent = {
  name: 'item',
  label: (state) => state.name,
  actions: {
    SET_PACKED: { description: 'Mark the item as packed (true) or not packed (false)', input: z.object({ packed: z.boolean() }), idempotent: true },
    REMOVE: { description: 'Remove the item from the list', consequential: true },
  },
}

export default Item
