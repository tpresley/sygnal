function Card({ state }) {
  return (
    <div className={state.done ? 'card done' : 'card'}>
      <input type="checkbox" className="toggle" checked={state.done} />
      <span className="title">{state.title}</span>
      <button className="prev-list">Previous list</button>
      <button className="next-list">Next list</button>
      <button className="delete">Delete</button>
    </div>
  )
}

Card.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.toggle'),
  DELETE: DOM.click('.delete'),
  MOVE_PREV: DOM.click('.prev-list'),
  MOVE_NEXT: DOM.click('.next-list'),
})

// Moving a card changes two lists, which only the board owns, so the card
// just asks; its List adds which list it is in and passes the request on.
Card.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
  MOVE_PREV: {
    PARENT: (state) => ({ type: 'MOVE', cardId: state.id, offset: -1 }),
  },
  MOVE_NEXT: {
    PARENT: (state) => ({ type: 'MOVE', cardId: state.id, offset: 1 }),
  },
}

export default Card
