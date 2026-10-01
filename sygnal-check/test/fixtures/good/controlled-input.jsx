// SYG111 must stay quiet for controlled fields that are updated as the user types,
// for uncontrolled fields, and for fields that cannot be typed into.
import { processForm } from 'sygnal'

function Form({ state }) {
  return (
    <div className="form">
      <input className="name" value={state.name} />
      <input className="email" value={state.email} />
      <input className="age" value={state.age} />
      <input className="code" value={state.code} />
      <input type="checkbox" className="agree" checked={state.agree} />
      <input type="radio" name="size" className="size" checked={state.size === 's'} />
      <select className="kind" value={state.kind}><option value="a">A</option></select>
      <input className="uncontrolled" />
      <input className="literal" value="fixed" />
      <input className="ro" readOnly value={state.name} />
      <input type="hidden" value={state.id} />
      <button type="submit" value={state.id}>Go</button>
      <form className="profile">
        <input name="city" value={state.city} />
      </form>
      <div className="wrap">
        <input className="inner" value={state.inner} />
      </div>
    </div>
  )
}

Form.initialState = { name: '', email: '', age: '', code: '', agree: false, size: 's', kind: 'a', id: 1, city: '', inner: '' }

Form.intent = ({ DOM }) => ({
  NAME: DOM.input('.name').value(),
  EMAIL: DOM.select('.email').events('input').map(e => e.target.value),
  AGE: DOM.change('input.age'),
  CODE: DOM.keyup('.code').map(e => e.target.value),
  AGREE: DOM.select('.agree').events('change'),
  SIZE: DOM.click('.size'),
  KIND: DOM.change('.kind'),
  CITY: processForm(DOM.select('.profile')),
  INNER: DOM.select('.wrap').events('input'),
})

Form.model = {
  NAME: (s, name) => ({ ...s, name }),
  EMAIL: (s, email) => ({ ...s, email }),
  AGE: (s) => s,
  CODE: (s, code) => ({ ...s, code }),
  AGREE: (s) => ({ ...s, agree: !s.agree }),
  SIZE: (s) => ({ ...s, size: 's' }),
  KIND: (s) => s,
  CITY: (s, f) => ({ ...s, city: f.city }),
  INNER: (s) => s,
}

// a dynamic selector might match: stay quiet
const SEL = window.sel
function Dyn({ state }) {
  return <input className="d" value={state.v} />
}
Dyn.intent = ({ DOM }) => ({ V: DOM.input(SEL) }) // expect: SYG110 info
Dyn.model = { V: (s) => s }

// a selector handed to a helper is an unknown listener: stay quiet
function Helped({ state }) {
  return <input className="h" value={state.v} />
}
Helped.intent = ({ DOM }) => ({ V: watch(DOM.select('.h')) })
Helped.model = { V: (s) => s }
function watch(sel) { return sel.events('input') }

export default Form
