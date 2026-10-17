import { event } from 'sygnal'
export default function CartLine({ state }) {
  return <li>{state.name}<button className="remove">×</button></li>
}
CartLine.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
CartLine.model = { REMOVE: { EVENTS: event('REMOVE_ITEM', state => state.id) } }
