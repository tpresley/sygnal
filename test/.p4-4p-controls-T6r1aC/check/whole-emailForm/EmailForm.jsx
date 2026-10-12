// EmailForm.jsx
import { ABORT, controls } from 'sygnal'

const { Email, Save } = controls({ Email: 'input', Save: 'button' })

export function EmailForm({ state }) {
  return (
    <form>
      <label>Email <Email type="email" value={state.email} /></label>
      <Save type="button">Save</Save>
    </form>
  )
}

EmailForm.initialState = { email: '' }
EmailForm.intent = ({ DOM }) => ({ EMAIL: DOM.input(Email).value(), SAVE: DOM.click(Save) })
EmailForm.model = {
  EMAIL: (state, email) => ({ ...state, email }),
  // an address without @: put the cursor back in the field
  SAVE: { ELEMENT: (state) => (state.email.includes('@') ? ABORT : { focus: Email }) },
}
