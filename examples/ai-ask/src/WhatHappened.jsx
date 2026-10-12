// "What happened": each card of the conversation, newest first. What the model asked for (its
// `need`), who composed the card and why (the chat model's plan, or a decision model's answers
// with their probabilities: the card's `ui.decisions`), the card's parts, and what went back to the
// model (the tool output).
import { toTree } from 'sygnal/ai'

const pct = (p) => `${Math.round((p ?? 0) * 100)}%`

/** a tree as text: `plan[plan=team], confirm` */
function treeText(tree) {
  return tree.map((n) => {
    const params = Object.entries(n.params || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(' | ') : v}`).join(', ')
    const kids = Array.isArray(n.children) ? `(${treeText(n.children)})` : ''
    return `${n.part}${params ? `[${params}]` : ''}${kids}`
  }).join(', ')
}

/** the backend's reasons: the LLM's plan, or the decision model's part picks */
function reasons(decisions) {
  if (!decisions) return null
  if (decisions.asked_for) {
    return <p className="why">Plan: {decisions.asked_for.length ? decisions.asked_for.join('; ') : 'nothing the parts show'}</p>
  }
  // compose.decisions() answers by question name: use_<part> (place the part or not),
  // rec_<part>__<n> (the n-th record of a record part, or none)
  const select = Object.entries(decisions.select || {})
  const parts = select.filter(([q]) => q.startsWith('use_')).map(([q, a]) => ({ name: q.slice(4), used: a.choice === 'use', p: a.probabilities?.use }))
  const records = select.filter(([q, a]) => q.startsWith('rec_') && a.choice !== 'none').map(([q, a]) => ({ name: `${q.slice(4).split('__')[0]}: ${a.choice}`, used: true, p: a.probabilities?.[a.choice] }))
  const picks = [...parts, ...records]
  if (!picks.length) return null
  return (
    <ul className="why picks">
      {picks.map((x) => <li className={x.used ? 'used' : 'muted'}>{x.name} <span>{pct(x.p)}</span></li>)}
    </ul>
  )
}

function output(p) {
  if (p.state === 'output-error') return <p className="output error">{p.errorText}</p>
  if (p.state === 'output-available') return <pre className="output">{JSON.stringify(p.output)}</pre>
  return <p className="output muted">(no answer yet)</p>
}

function entry(p, by) {
  const layout = p.ui?.layout
  return (
    <li className="happened" data={{ card: p.toolCallId }}>
      <p><span className="label">Asked</span> {p.input?.need}</p>
      <p><span className="label">Card</span> {layout ? treeText(toTree(layout)) : p.ui?.status}{layout && by ? <span className="muted"> · by {by}</span> : null}</p>
      {reasons(p.ui?.decisions)}
      <div><span className="label">Tool output</span> {output(p)}</div>
    </li>
  )
}

export function whatHappened(assistant, cardsBy = {}) {
  const cards = assistant.messages.flatMap((m) => m.parts.filter((p) => p.type === 'tool-ask_user')).reverse()
  return (
    <aside className="what-happened">
      <h2>What happened</h2>
      {cards.length === 0
        ? <p className="muted">Each card shows up here: what the model asked for, who built the card and why, and the answer that went back.</p>
        : <ol>{cards.map((p) => entry(p, cardsBy[p.toolCallId]))}</ol>}
    </aside>
  )
}
