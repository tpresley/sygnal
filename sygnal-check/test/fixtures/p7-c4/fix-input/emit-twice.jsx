import { emit, Collection } from 'sygnal'
import Row from './parts/Row.jsx'

function List({ state }) {
  return <div><button className="a">a</button><button className="b">b</button><Collection of={Row} from="rows" /></div>
}
List.initialState = { rows: [] }
List.intent = ({ DOM, CHILD }) => ({
  A: DOM.click('.a'),
  B: DOM.click('.b'),
  PICK: CHILD.select('Row'),
})
List.model = {
  A: emit('A_DONE'),
  B: emit('B_DONE', (state) => state.rows.length),
  PICK: (state) => state,
}
export default List
