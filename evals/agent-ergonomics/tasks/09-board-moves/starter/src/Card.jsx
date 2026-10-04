function Card({ state }) {
  return (
    <div className={state.done ? 'card done' : 'card'}>
      <input type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
      <span className="title">{state.title}</span>
      <button className="delete">Delete</button>
    </div>
  )
}

Card.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.toggle'),
  DELETE: DOM.click('.delete'),
})

Card.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default Card
