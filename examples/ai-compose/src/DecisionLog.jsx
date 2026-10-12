// Why the page looks the way it does: `state.page.decisions`, whatever the backend.
//   compose.decisions(): the raw answers of each step, `{ select, layout? }`, every one with its
//     probabilities (use_<part>, param_<part>__<name>, row; first_<a>_vs_<b>, beside_<k>, …)
//   compose.llm(): the model's plan, `{ asked_for, repairs? }`
import { catalog } from './catalog.js'

const pct = (p) => `${Math.round((p ?? 0) * 100)}%`
/** a node key's name: the noun of its part's description ("Revenue chart") */
const name = (key) => catalog.get(String(key).split(/[~:]/)[0])?.description.split(' (')[0] ?? key

const bar = (p, on) => <span className={on ? 'bar on' : 'bar'}><span style={{ width: pct(p) }} /></span>
const sure = (a) => a.probabilities?.[a.choice]

/** one select answer as a line */
function selectLine(q, a) {
  if (q.startsWith('use_')) {
    const used = a.choice === 'use'
    return <li className={used ? 'pick used' : 'pick'}>{bar(a.probabilities?.use, used)} <span className="name">{name(q.slice(4))}</span> <span className="muted">{pct(a.probabilities?.use)}</span></li>
  }
  if (q === 'row') {
    return <li className="pick gate">{bar(a.noul, a.noul >= 0.5)} <span className="name">Side by side?</span> <span className="muted">{pct(a.noul)}</span></li>
  }
  if (q.startsWith('param_')) {
    const [part, param] = q.slice(6).split('__')
    return <li className="pick param"><span className="name">{name(part)} · {catalog.get(part)?.params[param]?.label ?? param}: <b>{a.choice}</b></span> <span className="muted">{pct(sure(a))}</span></li>
  }
  return <li className="pick"><span className="name">{q}: <b>{a.choice ?? a.noul}</b></span> <span className="muted">{pct(sure(a) ?? a.noul)}</span></li>
}

/** one layout answer as a line */
function layoutLine(q, a) {
  const [kind, ...rest] = q.split('_')
  const [x, y] = rest.join('_').split('_vs_')
  if (kind === 'first') return <li><b>{name(a.choice)}</b> before {name(a.choice === x ? y : x)} <span className="muted">{pct(sure(a))}</span></li>
  if (kind === 'left') return <li><b>{name(a.choice)}</b> left of {name(a.choice === x ? y : x)} <span className="muted">{pct(sure(a))}</span></li>
  if (kind === 'beside') return <li>{name(x)} beside {a.choice === 'none' ? 'nothing' : <b>{name(a.choice)}</b>} <span className="muted">{pct(sure(a))}</span></li>
  if (kind === 'parent') return <li>{name(x)} → {a.choice} <span className="muted">{pct(sure(a))}</span></li>
  return <li>{q}: {a.choice} <span className="muted">{pct(sure(a))}</span></li>
}

function DecisionLog({ decisions, composer }) {
  if (!decisions) {
    return <aside className="decisions muted">The model's decisions appear here: a decision model's answers with their probabilities, or a chat model's plan.</aside>
  }
  const by = composer ? <p className="muted by">{composer.label}</p> : null
  if (decisions.select || decisions.layout) {
    // a param answer of a part that wasn't used says nothing: leave it out
    const select = Object.entries(decisions.select || {}).filter(([q]) => !q.startsWith('param_') || decisions.select[`use_${q.slice(6).split('__')[0]}`]?.choice !== 'omit')
    return (
      <aside className="decisions">
        {by}
        {decisions.select && <h3>1 · Which parts?</h3>}
        {decisions.select && <ul className="picks">{select.map(([q, a]) => selectLine(q, a))}</ul>}
        {decisions.layout && <h3>2 · In what order?</h3>}
        {decisions.layout && <ul className="pairs">{Object.entries(decisions.layout).map(([q, a]) => layoutLine(q, a))}</ul>}
      </aside>
    )
  }
  return (
    <aside className="decisions">
      {by}
      <h3>The model's plan</h3>
      {decisions.asked_for?.length
        ? <ol className="plan">{decisions.asked_for.map((item) => <li>{item}</li>)}</ol>
        : <p className="muted">It asked for nothing the parts show.</p>}
      {decisions.repairs?.length > 0 && <h3>Repaired</h3>}
      {decisions.repairs?.length > 0 && <ul className="repairs">{decisions.repairs.map((r) => <li><b>{r.kind}</b> {r.detail}</li>)}</ul>}
    </aside>
  )
}

export default DecisionLog
