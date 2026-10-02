import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { CardState, CardMove } from './types'

const intent = ({ DOM }: IntentSources<CardState>) => ({
  TOGGLE: DOM.change('.toggle'),
  DELETE: DOM.click('.delete'),
  MOVE_PREV: DOM.click('.prev-list'),
  MOVE_NEXT: DOM.click('.next'),
})

type CardActions = ActionsOf<typeof intent>

const Card: Component<CardState, {}, {}, CardActions, {}, {}, { PARENT: CardMove }> = ({ state }) => (
  <div className={state.done ? 'card done' : 'card'}>
    <input type="checkbox" className="toggle" checked={state.done} />
    <span className="title">{state.title}</span>
    <button className="prev-list">Previous list</button>
    <button className="next-list">Next list</button>
    <button className="delete">Delete</button>
  </div>
)

Card.intent = intent

// Moving a card changes two lists, which only the board owns, so the card
// just asks; its List adds which list it is in and passes the request on.
Card.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
  MOVE_PREV: {
    PARENT: (state) => ({ cardId: state.id, offset: -1 }),
  },
  MOVE_NEXT: {
    PARENT: (state) => ({ cardId: state.id, offset: 1 }),
  },
}

export default Card
