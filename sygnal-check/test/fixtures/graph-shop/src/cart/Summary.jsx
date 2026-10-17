// PLAN-10 A-3: one of two components called Summary (see checkout/Summary.jsx)
import { event } from 'sygnal'
export default function Summary({ state }) {
  return <div className="summary"><button className="shop-more">Keep shopping</button></div>
}
Summary.intent = ({ DOM }) => ({ MORE: DOM.click('.shop-more') })
Summary.model = { MORE: { EVENTS: event('NAVIGATE', () => 'shop') } }
