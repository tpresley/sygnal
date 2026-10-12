import { ABORT, defineBehavior } from 'sygnal'
const disclosure = defineBehavior({ initialState: { open: false }, intent: ({ DOM }, { toggle }) => ({ TOGGLE: DOM.click(toggle) }), model: { TOGGLE: (slice) => ({ ...slice, open: !slice.open }) } })
export function Product({ state }) {
  return (
    <section>
      <button className="more" aria-expanded={String(state.more.open)}>Details</button>
      {state.more.open && <p>{state.text}</p>}
      <p className="opened">{state.opened}</p>
    </section>
  )
}
Product.initialState = { text: 'Warm light.', opened: 0 }
Product.uses = { more: disclosure({ toggle: '.more' }) }
Product.intent = ({ DOM }) => ({ 'more.TOGGLE': DOM.keydown('document').key().filter(key => key === 'Enter') })
Product.model = { 'more.TOGGLE': (state) => (state.more.open ? { ...state, opened: state.opened + 1 } : ABORT) }
