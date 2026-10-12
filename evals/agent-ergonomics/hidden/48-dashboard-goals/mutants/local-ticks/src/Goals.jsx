// Mutant: the ticks live in the part's own state (`local`), not in the app's goals, so the
// header never follows and a new composition loses them.
function Goals({ state, goals, period }) {
  const shown = goals.filter((g) => g.period === period)
  return (
    <section className="goals">
      <h2>{period === 'month' ? "This month's goals" : "This week's goals"}</h2>
      <ul>
        {shown.map((g) => (
          <li>
            <label>
              <input type="checkbox" className="goal-toggle" checked={state.ticks[g.id] ?? g.done} data={{ id: g.id }} /> {g.text}
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}

Goals.intent = ({ DOM }) => ({
  TOGGLE: DOM.change('.goal-toggle').data('id', Number),
})

Goals.model = {
  TOGGLE: (state, id, next, props) => {
    const g = props.goals.find((x) => x.id === id)
    return { ...state, ticks: { ...state.ticks, [id]: !(state.ticks[id] ?? g.done) } }
  },
}

export default Goals
