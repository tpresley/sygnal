// Markup for the second signup step. Not wired up yet.
const PLANS = [
  { id: 'free', label: 'Free' },
  { id: 'pro', label: 'Pro' },
  { id: 'team', label: 'Team' },
]

export default function PlanStep({ plan }) {
  return (
    <div className="plan-step">
      <fieldset className="plans">
        <legend>Choose a plan</legend>
        {PLANS.map((option) => (
          <label key={option.id} className="plan">
            <input type="radio" name="plan" value={option.id} checked={plan === option.id} readOnly />
            {option.label}
          </label>
        ))}
      </fieldset>
      <button className="back">Back</button>
      <button className="create">Create account</button>
    </div>
  )
}
