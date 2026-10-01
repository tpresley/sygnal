import { Collection } from 'sygnal'
import Card from './Card.jsx'

function List({ state }) {
  return (
    <section className="list">
      <h2 className="list-title">
        {state.title} ({state.cards.length})
      </h2>
      {state.cards.length === 0 && <p className="empty">No cards</p>}
      <Collection of={Card} from="cards" className="cards" />
    </section>
  )
}

List.intent = ({ CHILD }) => ({
  MOVE_CARD: CHILD.select(Card).filter((msg) => msg.type === 'MOVE'),
})

List.model = {
  MOVE_CARD: {
    PARENT: (state, { cardId, offset }) => ({ type: 'MOVE', listId: state.id, cardId, offset }),
  },
}

export default List
