import AccountStep from './AccountStep.jsx'

function App({ state }) {
  return (
    <div className="signup">
      <h1>Create your account</h1>
      <AccountStep state="account" />
    </div>
  )
}

App.initialState = {
  account: { email: '', password: '' },
}

export default App
