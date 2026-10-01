import AccountStep from './AccountStep.jsx'
import PlanStep from './PlanStep.jsx'
import { PLAN_LABELS } from './validation.js'

function App({ state }) {
  if (state.step === 'done') {
    return (
      <div className="signup">
        <h1>Create your account</h1>
        <p className="summary">
          Account created for {state.account.email} on the {PLAN_LABELS[state.choice.plan]} plan.
        </p>
      </div>
    )
  }
  return (
    <div className="signup">
      <h1>Create your account</h1>
      <p className="step">Step {state.step === 'account' ? 1 : 2} of 2</p>
      {state.step === 'account' ? <AccountStep state="account" /> : <PlanStep state="choice" />}
    </div>
  )
}

App.initialState = {
  step: 'account',
  account: {
    email: '',
    password: '',
    touched: { email: false, password: false },
    attempted: false,
  },
  choice: { plan: 'free' },
}

App.intent = ({ CHILD }) => {
  const fromPlan$ = CHILD.select(PlanStep)
  return {
    TO_PLAN: CHILD.select(AccountStep).filter((msg) => msg.type === 'NEXT'),
    TO_ACCOUNT: fromPlan$.filter((msg) => msg.type === 'BACK'),
    FINISH: fromPlan$.filter((msg) => msg.type === 'CREATE'),
  }
}

App.model = {
  TO_PLAN: (state) => ({ ...state, step: 'plan' }),
  TO_ACCOUNT: (state) => ({ ...state, step: 'account' }),
  FINISH: (state) => ({ ...state, step: 'done' }),
}

export default App
