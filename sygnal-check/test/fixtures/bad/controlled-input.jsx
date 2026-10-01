// SYG111: a controlled field (value/checked bound to state) whose component never
// updates that state while the user types, so any re-render resets the typed text.
import { xs } from 'sygnal'

function TitleEditor({ state }) {
  return (
    <div className="editor">
      <input className="title-input"
        value={state.title /* expect: SYG111 */}
      />
      <textarea id="notes"
        value={state.notes /* expect: SYG111 */}
      />
      <input type="checkbox" className="done"
        checked={state.done /* expect: SYG111 */}
      />
      <select className="kind"
        value={state.kind /* expect: SYG111 */}
      >
        <option value="a">A</option>
      </select>
      <button className="save">Save</button>
    </div>
  )
}

TitleEditor.initialState = { title: '', notes: '', done: false, kind: 'a' }

TitleEditor.intent = ({ DOM }) => ({
  // saves on blur / Enter only: typing is never written to state
  SAVE: xs.merge(
    DOM.blur('.title-input').map(e => e.target.value),
    DOM.keydown('.title-input').filter(e => e.key === 'Enter').map(e => e.target.value),
  ),
  NOTES: DOM.select('#notes').events('blur').map(e => e.target.value),
  // a click listener on another element doesn't count
  CLICK: DOM.click('.save'),
  PICK: DOM.select('.kind').events('focus'),
})

TitleEditor.model = {
  SAVE: (state, title) => ({ ...state, title }),
  NOTES: (state, notes) => ({ ...state, notes }),
  CLICK: (state) => state,
  PICK: (state) => state,
}

// literal values are controlled too (1H-8): each re-render resets the field to them
function Literals({ state }) {
  return (
    <div className="lit">
      <input className="search"
        value="" // expect: SYG111
      />
      <input type="email" className="mail"
        value="default@example.com" // expect: SYG111
      />
      <textarea className="body"
        value={'text' /* expect: SYG111 */}
      />
      <input type="number" className="qty"
        value={0 /* expect: SYG111 */}
      />
      <input type="checkbox" className="opt"
        checked // expect: SYG111
      />
      <input type="radio" name="r" className="r"
        checked={false /* expect: SYG111 */}
      />
      <select className="pick"
        value="a" // expect: SYG111
      >
        <option value="a">A</option>
      </select>
      <button className="tick">{state.count}</button>
    </div>
  )
}
Literals.initialState = { count: 0 }
Literals.intent = ({ DOM }) => ({ TICK: DOM.click('.tick') })
Literals.model = { TICK: (s) => ({ ...s, count: s.count + 1 }) }

// no intent at all
function Display({ state }) {
  return <input className="shown"
    value={state.text /* expect: SYG111 */}
  />
}
Display.initialState = { text: 'x' }

export default TitleEditor
