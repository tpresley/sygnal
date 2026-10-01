const PLANS = [
  { id: 'free', label: 'Free' },
  { id: 'pro', label: 'Pro' },
  { id: 'team', label: 'Team' },
]

// State (lensed from the parent's `choice`): { plan }
function PlanStep({ state }) {
  return (
    <div className="plan-step">
      <fieldset className="plans">
        <legend>Choose a plan</legend>
        {PLANS.map((plan) => (
          <label className="plan">
            <input type="radio" name="plan" value={plan.id} checked={state.plan === plan.id} />
            {plan.label}
          </label>
        ))}
      </fieldset>
      <button className="back">Back</button>
      <button className="create">Create account</button>
    </div>
  )
}

PlanStep.intent = ({ DOM }) => ({
  CHOOSE: DOM.change('input[name="plan"]').value(),
  BACK: DOM.click('.back'),
  CREATE: DOM.click('.create'),
})

PlanStep.model = {
  CHOOSE: (state, plan) => ({ ...state, plan }),
  BACK: {
    PARENT: () => ({ type: 'BACK' }),
  },
  CREATE: {
    PARENT: () => ({ type: 'CREATE' }),
  },
}

export default PlanStep
