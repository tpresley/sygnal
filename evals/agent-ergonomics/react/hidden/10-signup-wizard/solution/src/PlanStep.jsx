const PLANS = [
  { id: 'free', label: 'Free' },
  { id: 'pro', label: 'Pro' },
  { id: 'team', label: 'Team' },
]

export default function PlanStep({ plan, onChoose, onBack, onCreate }) {
  return (
    <div className="plan-step">
      <fieldset className="plans">
        <legend>Choose a plan</legend>
        {PLANS.map((option) => (
          <label key={option.id} className="plan">
            <input
              type="radio"
              name="plan"
              value={option.id}
              checked={plan === option.id}
              onChange={() => onChoose(option.id)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <button className="back" onClick={onBack}>
        Back
      </button>
      <button className="create" onClick={onCreate}>
        Create account
      </button>
    </div>
  )
}
