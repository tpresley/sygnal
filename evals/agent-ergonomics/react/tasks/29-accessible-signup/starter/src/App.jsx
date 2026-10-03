import { useState } from 'react'

export default function App() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newsletterEmail, setNewsletterEmail] = useState('')

  return (
    <main className="signup-page">
      <h1>Create your account</h1>
      <form className="signup" noValidate>
        <div className="field">
          <span>Name</span>
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <span>Email</span>
          <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <span>Password</span>
          <input name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="hint">At least 8 characters.</p>
        </div>
        <button type="submit">Create account</button>
      </form>
      <p className="done"></p>

      <footer>
        <h2>Newsletter</h2>
        <form className="newsletter" noValidate>
          <div className="field">
            <span>Email</span>
            <input name="email" type="email" value={newsletterEmail} onChange={(e) => setNewsletterEmail(e.target.value)} />
          </div>
          <button type="submit">Subscribe</button>
        </form>
        <p className="subscribed"></p>
      </footer>
    </main>
  )
}
