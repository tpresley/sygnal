import { controls } from 'sygnal'

const { Toggle, Delete } = controls({ Toggle: 'input', Delete: 'button' })

function Card({ state }) {
  return (
    <div className={state.done ? 'card done' : 'card'}>
      <Toggle type="checkbox" className="toggle" checked={state.done} />
      <span className="title">{state.title}</span>
      <Delete className="delete">Delete</Delete>
    </div>
  )
}

Card.intent = ({ DOM }) => ({
  TOGGLE: DOM.change(Toggle),
  DELETE: DOM.click(Delete),
})

Card.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  DELETE: () => undefined,
}

export default Card
