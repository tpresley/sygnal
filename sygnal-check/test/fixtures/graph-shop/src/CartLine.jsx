import { event } from 'sygnal'
export default function CartLine({ state }) {
  return <li>{state.name}<button className="qty">+1</button><button className="remove">×</button></li>
}
CartLine.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove'), QTY: DOM.click('.qty') })
CartLine.model = {
  REMOVE: { EVENTS: event('REMOVE_ITEM', state => state.id) },
  QTY: { PARENT: state => state.id },
}
