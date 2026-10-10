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
  REMOVE: () => undefined,
}

export default Item
