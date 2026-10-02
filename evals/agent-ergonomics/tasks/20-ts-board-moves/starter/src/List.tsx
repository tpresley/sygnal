import { Collection } from 'sygnal'
import type { Component } from 'sygnal'
import Card from './Card'
import type { ListState } from './types'

const CardCollection = Collection<{ className?: string }, ListState>

const List: Component<ListState> = ({ state }) => (
  <section className="list">
    <h2 className="list-title">{state.title}</h2>
    {state.cards.length === 0 && <p className="empty">No cards</p>}
    <CardCollection of={Card} from="cards" className="cards" />
  </section>
)

export default List
