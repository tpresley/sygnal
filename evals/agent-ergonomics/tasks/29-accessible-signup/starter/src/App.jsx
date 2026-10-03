function App({ state }) {
  return (
    <main className="signup-page">
      <h1>Create your account</h1>
      <form className="signup" noValidate>
        <div className="field">
          <span>Name</span>
          <input name="name" value={state.name} />
        </div>
        <div className="field">
          <span>Email</span>
          <input name="email" type="email" value={state.email} />
        </div>
        <div className="field">
          <span>Password</span>
          <input name="password" type="password" value={state.password} />
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
            <input name="email" type="email" value={state.newsletterEmail} />
          </div>
          <button type="submit">Subscribe</button>
        </form>
        <p className="subscribed"></p>
      </footer>
    </main>
  )
}

App.initialState = {
  name: '',
  email: '',
  password: '',
  newsletterEmail: '',
}

App.intent = ({ DOM }) => ({
  NAME: DOM.input('.signup input[name="name"]').value(),
  EMAIL: DOM.input('.signup input[name="email"]').value(),
  PASSWORD: DOM.input('.signup input[name="password"]').value(),
  NEWSLETTER_EMAIL: DOM.input('.newsletter input[name="email"]').value(),
})

App.model = {
  NAME: (state, name) => ({ ...state, name }),
  EMAIL: (state, email) => ({ ...state, email }),
  PASSWORD: (state, password) => ({ ...state, password }),
  NEWSLETTER_EMAIL: (state, newsletterEmail) => ({ ...state, newsletterEmail }),
}

export default App
