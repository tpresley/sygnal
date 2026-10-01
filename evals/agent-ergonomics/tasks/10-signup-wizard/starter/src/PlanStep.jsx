// Markup for the second signup step. Not wired up yet.
const PLANS = [
  { id: 'free', label: 'Free' },
  { id: 'pro', label: 'Pro' },
  { id: 'team', label: 'Team' },
]

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

export default PlanStep
