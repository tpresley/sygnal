// Intent action names that don't line up with model keys.
import { set } from 'sygnal'

function Form({ state }) {
  return (
    <form className="form">
      <input className="name" value={state.name} aria-label="field" />
      <button className="save">Save</button>
      <button className="reset">Reset</button>
    </form>
  )
}

Form.initialState = { name: '', saved: false }

Form.intent = ({ DOM }) => ({
  SET_NAME: DOM.input('.name').map(e => e.target.value),
  SAVE: DOM.click('.save'), // expect: SYG101
  RESET: DOM.click('.reset'),
})

Form.model = {
  SET_NAME: set((_s, name) => ({ name })),
  SAV: set({ saved: true }), // expect: SYG102
  'RESET | EFFECT': (_s, _d, next) => next('CLEAR'),
  CLEAR: set({ name: '' }),
  'LOG_IT | LOG': () => 'never fires', // expect: SYG102
  DISPOSE: { EFFECT: () => {} },
  READY: { READY: () => true },
}

// No model at all: every intent action is a no-op.
function Orphan() {
  return <button className="go">go</button>
}
Orphan.intent = ({ DOM }) => ({ GO: DOM.click('.go') }) // expect: SYG101

// No intent: model entries are unreachable unless next() targets them.
function Silent() {
  return <div className="silent" />
}
Silent.model = {
  BOOTSTRAP: (s, _d, n) => { n('START'); return s },
  START: (s) => s,
  STOP: (s) => s, // expect: SYG102
}

export default Form
