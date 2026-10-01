function AccountStep({ state }) {
  return (
    <div className="account-step">
      <label className="field">
        Email
        <input type="email" name="email" className="email" value={state.email} />
      </label>
      <label className="field">
        Password
        <input type="password" name="password" className="password" value={state.password} />
      </label>
      <button className="next">Next</button>
    </div>
  )
}

AccountStep.intent = ({ DOM }) => ({
  SET_EMAIL: DOM.input('.email').value(),
  SET_PASSWORD: DOM.input('.password').value(),
})

AccountStep.model = {
  SET_EMAIL: (state, email) => ({ ...state, email }),
  SET_PASSWORD: (state, password) => ({ ...state, password }),
}

export default AccountStep
