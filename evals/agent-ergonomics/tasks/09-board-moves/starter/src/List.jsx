import { Collection } from 'sygnal'
import Card from './Card.jsx'

function List({ state }) {
  return (
    <section className="list">
      <h2 className="list-title">{state.title}</h2>
      {state.cards.length === 0 && <p className="empty">No cards</p>}
      <Collection of={Card} from="cards" className="cards" />
    </section>
  )
}

export default List
