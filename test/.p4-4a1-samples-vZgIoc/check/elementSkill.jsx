import { ABORT } from 'sygnal'
const validate = (s) => (s.email.includes('@') ? {} : { email: 'Enter an email address' })
export function Signup({ state }) {
  return <label>Email <input className="email" value={state.email} /></label>
}
Signup.initialState = { email: '' }
Signup.intent = ({ DOM }) => ({ EMAIL: DOM.input('.email').value() })
Signup.model = {
  EMAIL: (state, email) => ({ ...state, email }),
  SUBMIT: { ELEMENT: (s) => (validate(s).email ? { focus: '.email' } : ABORT) },
}
