import { isValidEmail, isValidPassword } from './validation.js'

// State (lensed from the parent's `account`, so it survives unmounting):
// { email, password, touched: { email, password }, attempted }
function AccountStep({ state }) {
  const show = (field) => state.attempted || state.touched[field]
  const emailError = show('email') && !isValidEmail(state.email)
  const passwordError = show('password') && !isValidPassword(state.password)
  return (
    <div className="account-step">
      <label className="field">
        Email
        <input type="email" name="email" className="email" value={state.email} />
      </label>
      {emailError && <p className="error">Please enter a valid email address.</p>}
      <label className="field">
        Password
        <input type="password" name="password" className="password" value={state.password} />
      </label>
      {passwordError && <p className="error">Password must be at least 8 characters.</p>}
      <button className="next">Next</button>
    </div>
  )
}

AccountStep.intent = ({ DOM }) => ({
  SET_EMAIL: DOM.input('.email').value(),
  SET_PASSWORD: DOM.input('.password').value(),
  LEAVE_EMAIL: DOM.blur('.email'),
  LEAVE_PASSWORD: DOM.blur('.password'),
  NEXT: DOM.click('.next'),
})

AccountStep.model = {
  SET_EMAIL: (state, email) => ({ ...state, email }),
  SET_PASSWORD: (state, password) => ({ ...state, password }),
  LEAVE_EMAIL: (state) => ({ ...state, touched: { ...state.touched, email: true } }),
  LEAVE_PASSWORD: (state) => ({ ...state, touched: { ...state.touched, password: true } }),
  NEXT: {
    STATE: (state) => ({ ...state, attempted: true }),
    EFFECT: (state, _, next) => {
      if (isValidEmail(state.email) && isValidPassword(state.password)) next('ADVANCE')
    },
  },
  ADVANCE: {
    PARENT: () => ({ type: 'NEXT' }),
  },
}

export default AccountStep
