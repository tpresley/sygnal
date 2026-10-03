import { useId, useRef, useState } from 'react'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailError = (email) => (EMAIL.test(email) ? null : 'Enter a valid email address.')

function signupErrors({ name, email, password }) {
  return {
    name: name.trim() ? null : 'Enter your name.',
    email: emailError(email),
    password: password.length >= 8 ? null : 'Use at least 8 characters.',
  }
}

const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined

export default function App() {
  const id = useId()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [newsletterEmail, setNewsletterEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [subscribeTried, setSubscribeTried] = useState(false)
  const [done, setDone] = useState('')
  const [subscribed, setSubscribed] = useState('')
  const refs = { name: useRef(null), email: useRef(null), password: useRef(null) }
  const newsletterRef = useRef(null)
  const dialogRef = useRef(null)

  const errors = submitted ? signupErrors(form) : {}
  const newsletterError = subscribeTried ? emailError(newsletterEmail) : null
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const ids = {
    name: `${id}-name`,
    email: `${id}-email`,
    password: `${id}-password`,
    hint: `${id}-password-hint`,
    newsletter: `${id}-newsletter-email`,
  }

  const onSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)
    const now = signupErrors(form)
    const invalid = ['name', 'email', 'password'].find((key) => now[key])
    if (invalid) refs[invalid].current.focus()
    else if (!dialogRef.current.open) dialogRef.current.showModal()
  }

  const onSubscribe = (e) => {
    e.preventDefault()
    setSubscribeTried(true)
    if (emailError(newsletterEmail)) {
      setSubscribed('')
      newsletterRef.current.focus()
    } else {
      setSubscribed(`Subscribed ${newsletterEmail}.`)
    }
  }

  const confirm = () => {
    setDone(`Account created for ${form.name.trim()}.`)
    dialogRef.current.close()
  }

  return (
    <main className="signup-page">
      <h1>Create your account</h1>
      <form className="signup" noValidate onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={ids.name}>Name</label>
          <input
            id={ids.name}
            name="name"
            ref={refs.name}
            value={form.name}
            onChange={set('name')}
            aria-invalid={errors.name ? 'true' : undefined}
            aria-describedby={describedBy(errors.name && `${ids.name}-error`)}
          />
          {errors.name && (
            <p className="error" id={`${ids.name}-error`}>
              {errors.name}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={ids.email}>Email</label>
          <input
            id={ids.email}
            name="email"
            type="email"
            ref={refs.email}
            value={form.email}
            onChange={set('email')}
            aria-invalid={errors.email ? 'true' : undefined}
            aria-describedby={describedBy(errors.email && `${ids.email}-error`)}
          />
          {errors.email && (
            <p className="error" id={`${ids.email}-error`}>
              {errors.email}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={ids.password}>Password</label>
          <input
            id={ids.password}
            name="password"
            type="password"
            ref={refs.password}
            value={form.password}
            onChange={set('password')}
            aria-invalid={errors.password ? 'true' : undefined}
            aria-describedby={errors.password ? `${ids.password}-error` : ids.hint} // MUTANT
          />
          <p className="hint" id={ids.hint}>
            At least 8 characters.
          </p>
          {errors.password && (
            <p className="error" id={`${ids.password}-error`}>
              {errors.password}
            </p>
          )}
        </div>
        <button type="submit">Create account</button>
      </form>
      <p className="done">{done}</p>

      <dialog className="confirm" ref={dialogRef}>
        <p>{`Create the account for ${form.email}?`}</p>
        <button onClick={confirm}>Confirm</button>
        <button onClick={() => dialogRef.current.close()}>Cancel</button>
      </dialog>

      <footer>
        <h2>Newsletter</h2>
        <form className="newsletter" noValidate onSubmit={onSubscribe}>
          <div className="field">
            <label htmlFor={ids.newsletter}>Email</label>
            <input
              id={ids.newsletter}
              name="email"
              type="email"
              ref={newsletterRef}
              value={newsletterEmail}
              onChange={(e) => setNewsletterEmail(e.target.value)}
              aria-invalid={newsletterError ? 'true' : undefined}
              aria-describedby={describedBy(newsletterError && `${ids.newsletter}-error`)}
            />
            {newsletterError && (
              <p className="error" id={`${ids.newsletter}-error`}>
                {newsletterError}
              </p>
            )}
          </div>
          <button type="submit">Subscribe</button>
        </form>
        <p className="subscribed">{subscribed}</p>
      </footer>
    </main>
  )
}
