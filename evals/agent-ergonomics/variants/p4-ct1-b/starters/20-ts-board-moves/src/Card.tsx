import type { Component, IntentSources, ActionsOf } from 'sygnal'
import type { CardState } from './types'
import { controls } from 'sygnal'

const { Toggle, Delete } = controls({ Toggle: 'input', Delete: 'button' })

const intent = ({ DOM }: IntentSources<CardState>) => ({
  TOGGLE: DOM.change(Toggle),
  DELETE: DOM.click(Delete),
})

type CardActions = ActionsOf<typeof intent>

const Card: Component<CardState, {}, {}, CardActions> = ({ state }) => (
  <div className={state.done ? 'card done' : 'card'}>
    <Toggle type="checkbox" className="toggle" aria-label="Done" checked={state.done} />
    <span className="title">{state.title}</span>
    <Delete className="delete">Delete</Delete>
  </div>
)

Card.intent = intent

Card.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default Card
