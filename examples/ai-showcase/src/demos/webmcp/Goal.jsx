// The yearly reading goal. Its `read` holds only numbers (`untrusted: false`), so WebMCP puts a
// summary of it at the end of its tools' descriptions ("Current state: ..."), registered again
// whenever it changes: finish a book and watch `goal_set_goal` update in the console.
import { z } from 'zod'

export default function Goal({ state }) {
  const { target, finished } = state
  const pct = Math.min(100, Math.round((finished / target) * 100))
  return (
    <section className="goal" aria-label="Reading goal">
      <div className="goal-row">
        <span>Goal this year</span>
        <button type="button" className="goal-step" aria-label="Lower the goal" data={{ target: target - 1 }} disabled={target <= 1}>−</button>
        <b className="goal-count">{target}</b>
        <button type="button" className="goal-step" aria-label="Raise the goal" data={{ target: target + 1 }}>+</button>
      </div>
      <div className="track" role="progressbar" aria-label="Books finished" aria-valuemin="0" aria-valuemax={target} aria-valuenow={finished}>
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <small>{finished} of {target} finished</small>
    </section>
  )
}

Goal.intent = ({ DOM }) => ({
  SET_GOAL: DOM.click('.goal-step').data('target', Number),
})

Goal.model = {
  SET_GOAL: (state, target) => ({ ...state, target }),
}

Goal.agent = {
  name: 'goal',
  description: 'The yearly reading goal',
  untrusted: false,
  read: (state) => ({ goal: state.target, finished: state.finished }),
  actions: {
    SET_GOAL: { description: 'Set how many books to read this year', input: z.number().int().min(1).max(100), idempotent: true },
  },
}
