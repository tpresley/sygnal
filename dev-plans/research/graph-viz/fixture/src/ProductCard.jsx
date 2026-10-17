import { event } from 'sygnal'
export default function ProductCard({ state, context }) {
  return (
    <div className="card">
      <h3>{state.name}</h3>
      <span>{state.price} {context.currency}</span>
      <button className="add">Add</button>
      <button className="fav">♥</button>
    </div>
  )
}
ProductCard.intent = ({ DOM }) => ({
  ADD: DOM.click('.add'),
  FAV: DOM.click('.favourite'),
})
ProductCard.model = {
  ADD: { EVENTS: event('ADD_TO_CART', state => state) },
  FAV: state => ({ ...state, fav: !state.fav }),
}
