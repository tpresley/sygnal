// What the decision model answered: the probability behind every pick, so a layout can be explained.
import { PARTS } from './parts.js'

const pct = (p) => `${Math.round(p * 100)}%`
const title = (id) => PARTS.find((p) => p.id === id)?.title ?? id

function Bar({ p, on }) {
  return <span className={on ? 'bar on' : 'bar'}><span style={{ width: pct(p) }} /></span>
}

function DecisionLog({ selectAnswers, layoutAnswers, usage }) {
  if (!selectAnswers) {
    return <aside className="decisions muted">The decision model's answers appear here.</aside>
  }
  const pairs = Object.entries(layoutAnswers || {}).filter(([name]) => name.startsWith('above_'))
  const places = Object.entries(layoutAnswers || {}).filter(([name]) => name.startsWith('place_'))
  return (
    <aside className="decisions">
      <h3>1 · Which parts?</h3>
      <ul className="picks">
        {PARTS.map(({ id }) => {
          const a = selectAnswers[`use_${id}`]
          return (
            <li className={a.choice === 'use' ? 'pick used' : 'pick'}>
              <Bar p={a.probabilities.use} on={a.choice === 'use'} /> <span className="name">{title(id)}</span> <span className="muted">{pct(a.probabilities.use)}</span>
            </li>
          )
        })}
        <li className="pick gate">
          <Bar p={selectAnswers.row.noul} on={selectAnswers.row.noul >= 0.5} /> <span className="name">Side by side?</span> <span className="muted">{pct(selectAnswers.row.noul)}</span>
        </li>
      </ul>
      {layoutAnswers && (
        <div>
          <h3>2 · In what order?</h3>
          <ul className="pairs">
            {pairs.map(([, a]) => {
              const [first, second] = Object.keys(a.probabilities)
              const winner = a.choice
              const loser = winner === first ? second : first
              return <li><b>{title(winner)}</b> above {title(loser)} <span className="muted">{pct(a.probabilities[winner])}</span></li>
            })}
            {places.map(([name, a]) => (
              <li>{title(name.slice(6))} → {a.choice === 'row' ? 'the row' : 'the page'} <span className="muted">{pct(a.probabilities[a.choice])}</span></li>
            ))}
          </ul>
        </div>
      )}
      {usage > 0 && <p className="muted tokens">{usage.toLocaleString('en-US')} input tokens</p>}
    </aside>
  )
}

export default DecisionLog
