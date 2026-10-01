import { useState } from 'react'
import AccountStep from './AccountStep.jsx'
import PlanStep from './PlanStep.jsx'
import { isValidEmail, isValidPassword, PLAN_LABELS } from './validation.js'

export default function App() {
  const [step, setStep] = useState('account')
  const [account, setAccount] = useState({ email: '', password: '' })
  const [touched, setTouched] = useState({ email: false, password: false })
  const [attempted, setAttempted] = useState(false)
  const [plan, setPlan] = useState('free')

  const next = () => {
    setAttempted(true)
    if (isValidEmail(account.email) && isValidPassword(account.password)) setStep('plan')
  }

  if (step === 'done') {
    return (
      <div className="signup">
        <h1>Create your account</h1>
        <p className="summary">
          Account created for {account.email} on the {PLAN_LABELS[plan]} plan.
        </p>
      </div>
    )
  }

  return (
    <div className="signup">
      <h1>Create your account</h1>
      <p className="step">Step {step === 'account' ? 1 : 2} of 2</p>
      {step === 'account' ? (
        <AccountStep
          account={account}
          showErrors={{ email: attempted || touched.email, password: attempted || touched.password }}
          onChange={(changes) => setAccount((current) => ({ ...current, ...changes }))}
          onLeave={(field) => setTouched((current) => ({ ...current, [field]: true }))}
          onNext={next}
        />
      ) : (
        <PlanStep plan={plan} onChoose={setPlan} onBack={() => setStep('account')} onCreate={() => setStep('done')} />
      )}
    </div>
  )
}
