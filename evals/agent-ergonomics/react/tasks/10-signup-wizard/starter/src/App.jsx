import { useState } from 'react'
import AccountStep from './AccountStep.jsx'

export default function App() {
  const [account, setAccount] = useState({ email: '', password: '' })

  return (
    <div className="signup">
      <h1>Create your account</h1>
      <AccountStep account={account} onChange={(changes) => setAccount((current) => ({ ...current, ...changes }))} />
    </div>
  )
}
