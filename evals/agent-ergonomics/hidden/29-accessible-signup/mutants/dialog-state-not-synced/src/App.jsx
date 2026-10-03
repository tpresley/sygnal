import { createRef } from 'sygnal'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailError = (email) => (EMAIL.test(email) ? null : 'Enter a valid email address.')

// The signup form's errors, in form order (null = valid).
function signupErrors({ name, email, password }) {
  return {
    name: name.trim() ? null : 'Enter your name.',
    email: emailError(email),
    password: password.length >= 8 ? null : 'Use at least 8 characters.',
  }
}

const fields = { name: createRef(), email: createRef(), password: createRef(), newsletterEmail: createRef() }
const confirmDialog = createRef()

// aria-describedby from the ids that apply; false removes the attribute.
const describedBy = (...ids) => ids.filter(Boolean).join(' ') || false

function App({ state }) {
  const errors = state.submitted ? signupErrors(state) : {}
  const newsletterError = state.subscribeTried ? emailError(state.newsletterEmail) : null
  return (
    <main className="signup-page">
      <h1>Create your account</h1>
      <form className="signup" noValidate>
        <div className="field">
          <label for="signup-name">Name</label>
          <input
            id="signup-name"
            name="name"
            ref={fields.name}
            value={state.name}
            aria-invalid={errors.name ? 'true' : false}
            aria-describedby={describedBy(errors.name && 'signup-name-error')}
          />
          {errors.name && <p className="error" id="signup-name-error">{errors.name}</p>}
        </div>
        <div className="field">
          <label for="signup-email">Email</label>
          <input
            id="signup-email"
            name="email"
            type="email"
            ref={fields.email}
            value={state.email}
            aria-invalid={errors.email ? 'true' : false}
            aria-describedby={describedBy(errors.email && 'signup-email-error')}
          />
          {errors.email && <p className="error" id="signup-email-error">{errors.email}</p>}
        </div>
        <div className="field">
          <label for="signup-password">Password</label>
          <input
            id="signup-password"
            name="password"
            type="password"
            ref={fields.password}
            value={state.password}
            aria-invalid={errors.password ? 'true' : false}
            aria-describedby={describedBy('signup-password-hint', errors.password && 'signup-password-error')}
          />
          <p className="hint" id="signup-password-hint">At least 8 characters.</p>
          {errors.password && <p className="error" id="signup-password-error">{errors.password}</p>}
        </div>
        <button type="submit">Create account</button>
      </form>
      <p className="done">{state.done}</p>

      <dialog className="confirm" ref={confirmDialog}>
        <p>{`Create the account for ${state.email}?`}</p>
        <button className="confirm-yes">Confirm</button>
        <button className="confirm-no">Cancel</button>
      </dialog>

      <footer>
        <h2>Newsletter</h2>
        <form className="newsletter" noValidate>
          <div className="field">
            <label for="newsletter-email">Email</label>
            <input
              id="newsletter-email"
              name="email"
              type="email"
              ref={fields.newsletterEmail}
              value={state.newsletterEmail}
              aria-invalid={newsletterError ? 'true' : false}
              aria-describedby={describedBy(newsletterError && 'newsletter-email-error')}
            />
            {newsletterError && <p className="error" id="newsletter-email-error">{newsletterError}</p>}
          </div>
          <button type="submit">Subscribe</button>
        </form>
        <p className="subscribed">{state.subscribed}</p>
      </footer>
    </main>
  )
}

App.initialState = {
  name: '',
  email: '',
  password: '',
  newsletterEmail: '',
  submitted: false,
  subscribeTried: false,
  done: '',
  subscribed: '',
  confirmOpen: false,
}

App.intent = ({ DOM }) => ({
  NAME: DOM.input('.signup input[name="name"]').value(),
  EMAIL: DOM.input('.signup input[name="email"]').value(),
  PASSWORD: DOM.input('.signup input[name="password"]').value(),
  NEWSLETTER_EMAIL: DOM.input('.newsletter input[name="email"]').value(),
  SUBMIT: DOM.select('form.signup').events('submit', { preventDefault: true }),
  SUBSCRIBE: DOM.select('form.newsletter').events('submit', { preventDefault: true }),
  CONFIRM: DOM.click('.confirm-yes'),
  CANCEL: DOM.click('.confirm-no'),
})

const firstInvalid = (errors) => ['name', 'email', 'password'].find((key) => errors[key])

App.model = {
  NAME: (state, name) => ({ ...state, name }),
  EMAIL: (state, email) => ({ ...state, email }),
  PASSWORD: (state, password) => ({ ...state, password }),
  NEWSLETTER_EMAIL: (state, newsletterEmail) => ({ ...state, newsletterEmail }),
  // MUTANT: the dialog's open state is kept in state and only Cancel/Confirm clear it,
  // so a close by the browser (Escape) leaves the app thinking it is still open
  SUBMIT: {
    STATE: (state) => ({ ...state, submitted: true, confirmOpen: state.confirmOpen || !firstInvalid(signupErrors(state)) }),
    EFFECT: (state) => {
      const invalid = firstInvalid(signupErrors(state))
      if (invalid) fields[invalid].current?.focus()
      else if (!state.confirmOpen) confirmDialog.current?.showModal()
    },
  },
  SUBSCRIBE: {
    STATE: (state) => ({
      ...state,
      subscribeTried: true,
      subscribed: emailError(state.newsletterEmail) ? '' : `Subscribed ${state.newsletterEmail}.`,
    }),
    EFFECT: (state) => {
      if (emailError(state.newsletterEmail)) fields.newsletterEmail.current?.focus()
    },
  },
  CONFIRM: {
    STATE: (state) => ({ ...state, confirmOpen: false, done: `Account created for ${state.name.trim()}.` }),
    EFFECT: () => confirmDialog.current?.close(),
  },
  CANCEL: {
    STATE: (state) => ({ ...state, confirmOpen: false }),
    EFFECT: () => confirmDialog.current?.close(),
  },
}

export default App
