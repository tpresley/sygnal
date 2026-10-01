export default function AccountStep({ account, onChange }) {
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
        />
      </label>
      <label className="field">
        Password
        <input
          type="password"
          name="password"
          className="password"
          value={account.password}
          onChange={(e) => onChange({ password: e.target.value })}
        />
      </label>
      <button className="next">Next</button>
    </div>
  )
}
