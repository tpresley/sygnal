// PLAN-7 C-1: imports ./Child.jsx, which exists only as an editor buffer in
// p7-c1-sources.vtest.js. Without it the selector matches nothing (SYG110);
// with it the button is inside the isolated child (SYG104).
import Child from './Child.jsx'

function Parent({ state }) {
  return <div className="parent"><Child state="child" /></div>
}

Parent.initialState = { child: {} }
Parent.intent = ({ DOM }) => ({ PRESS: DOM.click('.child-btn') })
Parent.model = { PRESS: (state) => state }

export default Parent
