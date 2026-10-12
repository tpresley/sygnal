import { ABORT } from 'sygnal'
const validate = (s) => (s.email.includes('@') ? {} : { email: 'Enter an email address' })
export function Signup({ state }) {
  return (
    <div>
      <label>Email <input className="email" value={state.email} /></label>
      <button className="submit">Sign up</button>
      <ul><li className="row">one</li></ul>
      <dialog className="help"><p>Help</p><button className="done">Done</button></dialog>
      <p className="status">{state.status}</p>
    </div>
  )
}
Signup.initialState = { email: '', errors: {}, status: '' }
Signup.intent = ({ DOM }) => ({
  EMAIL: DOM.input('.email').value(),
  SUBMIT: DOM.click('.submit'),
  CLOSE_HELP: DOM.click('.done'),
  HELP_CLOSED: DOM.close('.help'),
})
Signup.model = {
  EMAIL: (state, email) => ({ ...state, email }),
  SUBMIT: { STATE: (s) => ({ ...s, errors: validate(s) }), ELEMENT: (s) => (validate(s).email ? { focus: '.email' } : ABORT) },
  OPEN_HELP: { ELEMENT: { showModal: '.help' } },
  SHOW_ROW: { ELEMENT: { scrollIntoView: '.row', block: 'nearest' } },
  CLOSE_HELP: { ELEMENT: { close: '.help', returnValue: 'done' } },
  HELP_CLOSED: (state) => ({ ...state, status: 'closed' }),
}
