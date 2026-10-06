import { Collection } from 'sygnal'
import type { Component, IntentSources, ActionsOf } from 'sygnal'
import Card from './Card'
import type { ListState, ListMove } from './types'

const CardCollection = Collection<{}, ListState>

const intent = ({ CHILD }: IntentSources<ListState>) => ({
  MOVE_CARD: CHILD.select(Card),
})

type ListActions = ActionsOf<typeof intent>

const List: Component<ListState, {}, {}, ListActions, {}, {}, { PARENT: ListMove }> = ({ state }) => (
  <section className="list">
    <h2 className="list-title">
      {state.title} ({state.cards.length})
    </h2>
    {state.cards.length === 0 && <p className="empty">No cards</p>}
    <div className="cards">
      <CardCollection of={Card} from="cards" />
    </div>
  </section>
)

List.intent = intent

List.model = {
  MOVE_CARD: {
    PARENT: (state, { cardId, offset }) => ({ cardId, offset }),
  },
}

export default List
