// <Collection from="x"> pointing at a missing or non-array initialState field.
import { Collection } from 'sygnal'

function Item({ state }) {
  return <li className="item">{state.text}</li>
}

const BASE = { items: [], config: { pageSize: 10 } }

function List({ state }) {
  return (
    <ul className="list">
      <Collection of={Item} from="item" /> {/* expect: SYG401 */}
      <collection of={Item} from="config" /> {/* expect: SYG401 */}
      <Collection of={Item} from="items" />
      <Collection of={Item} from="visible" />
    </ul>
  )
}

List.initialState = { ...BASE, title: 'List' }
List.calculated = { visible: (state) => state.items.slice(0, 10) }

export default List
