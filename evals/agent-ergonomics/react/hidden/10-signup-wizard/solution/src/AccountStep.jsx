import { isValidEmail, isValidPassword } from './validation.js'

export default function AccountStep({ account, showErrors, onChange, onLeave, onNext }) {
  const emailError = showErrors.email && !isValidEmail(account.email)
  const passwordError = showErrors.password && !isValidPassword(account.password)
  return (
    <div className="account-step">
      <label className="field">
        Email
        <input
          type="email"
          name="email"
          className="email"
          value={account.email}
          onChange={(e) => onChange({ email: e.target.value })}
          onBlur={() => onLeave('email')}
        />
      </label>
      {emailError && <p className="error">Please enter a valid email address.</p>}
      <label className="field">
        Password
        <input
          type="password"
          name="password"
          className="password"
          value={account.password}
          onChange={(e) => onChange({ password: e.target.value })}
          onBlur={() => onLeave('password')}
        />
      </label>
      {passwordError && <p className="error">Password must be at least 8 characters.</p>}
      <button className="next" onClick={onNext}>
        Next
      </button>
    </div>
  )
}
