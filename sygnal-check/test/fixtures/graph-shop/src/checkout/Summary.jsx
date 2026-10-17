// PLAN-10 A-3: the other Summary; its selector has a typo (SYG110, attached by component id)
import { event } from 'sygnal'
export default function Summary({ state }) {
  return <div className="summary"><button className="edit-cart">Edit</button></div>
}
Summary.intent = ({ DOM }) => ({ EDIT: DOM.click('.edit-crt') })
Summary.model = { EDIT: { EVENTS: event('NAVIGATE', () => 'cart') } }
