// The goals part: the team goals of one period. Its state is the app's goals (the catalog gives
// it the lens `state: 'goals'`), so ticks are app state and survive any recomposition.
function Goals({ state, period }) {
  const goals = state
  return (
    <section className="goals">
      <h2>{period === 'month' ? "This month's goals" : "This week's goals"}</h2>
      <ul>
        {goals.map((g) => (
          <li>
            <label>
              <input type="checkbox" className="goal-toggle" checked={g.done} data={{ id: g.id }} /> {g.text}
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
  TOGGLE: (goals, id) => goals.map((g) => (g.id === id ? { ...g, done: !g.done } : g)),
}

export default Goals
