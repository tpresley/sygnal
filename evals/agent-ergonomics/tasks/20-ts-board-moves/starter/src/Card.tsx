import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { CardState } from './types'

const intent = ({ DOM }: IntentSources<CardState>) => ({
  TOGGLE: DOM.change('.toggle'),
  DELETE: DOM.click('.delete'),
})

type CardActions = ActionsOf<typeof intent>

const Card: Component<CardState, {}, {}, CardActions> = ({ state }) => (
  <div className={state.done ? 'card done' : 'card'}>
    <input type="checkbox" className="toggle" checked={state.done} />
    <span className="title">{state.title}</span>
    <button className="delete">Delete</button>
  </div>
)

Card.intent = intent

Card.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default Card
