// "How the model decided": `state.page.decisions`, whatever the backend.
//   compose.decisions(): the answers of each step by question name, each with its probabilities.
//     A new page: `select` (use_<part>, param_<part>__<param>, row) and `layout` (first_<a>_vs_<b>,
//     left_…, beside_<part>). An edit: `edit` (remove_<node>, set_<node>__<param>, add_<part>) and
//     `where` (where_<node>).
//   compose.llm(): the model's plan (`asked_for`), an edit's operations (`ops`), and `repairs`.
import { classes } from 'sygnal'
import { catalog } from './catalog.js'

const pct = (p) => `${Math.round((p ?? 0) * 100)}%`
/** a part's name: the noun of its description ("Traffic chart") */
const name = (key) => catalog.get(String(key).split(/[~:]/)[0])?.description.split(' (')[0] ?? key
const sure = (a) => a.probabilities?.[a.choice] ?? a.confidence

const line = (text, p, on = true) => (
  <li className={classes({ off: !on })}>
    <span className="hd-bar"><span style={{ width: pct(p) }} /></span>
    <span className="hd-text">{text}</span>
    <span className="hd-pct">{pct(p)}</span>
  </li>
)

/** a new page: the parts picked (and the two nearest misses), their settings, the order */
function selectStep(select = {}, layout = {}) {
  const uses = Object.entries(select).filter(([q]) => q.startsWith('use_')).map(([q, a]) => ({ part: q.slice(4), p: a.probabilities?.use ?? 0, used: a.choice === 'use' }))
  const used = uses.filter((u) => u.used).sort((a, b) => b.p - a.p)
  const missed = uses.filter((u) => !u.used).sort((a, b) => b.p - a.p).slice(0, 2)
  const settings = Object.entries(select).filter(([q, a]) => q.startsWith('param_') && a.choice !== 'not_stated' && used.some((u) => q.startsWith(`param_${u.part}__`)))
  const order = Object.entries(layout).filter(([q]) => /^(first|left|beside)_/.test(q))
  return [
    <h5>Which parts? <small>“use it?” per part</small></h5>,
    <ul className="hd-lines">
      {used.map((u) => line(name(u.part), u.p))}
      {missed.map((u) => line(name(u.part), u.p, false))}
    </ul>,
    settings.length > 0 && <h5>Settings</h5>,
    settings.length > 0 && <ul className="hd-lines">{settings.map(([q, a]) => {
      const [part, param] = q.slice(6).split('__')
      return line(<>{name(part)} · {catalog.get(part)?.params[param]?.label ?? param}: <b>{a.choice}</b></>, sure(a))
    })}</ul>,
    select.row && <ul className="hd-lines">{line('Side by side?', select.row.noul, select.row.noul >= 0.5)}</ul>,
    order.length > 0 && <h5>In what order?</h5>,
    order.length > 0 && <ul className="hd-lines">{order.map(([q, a]) => {
      const [kind, rest] = [q.split('_')[0], q.slice(q.indexOf('_') + 1)]
      if (kind === 'beside') return line(<>{name(rest)} beside <b>{a.choice === 'none' ? 'nothing' : name(a.choice)}</b></>, sure(a))
      const [x, y] = rest.split('_vs_')
      return line(<><b>{name(a.choice)}</b> {kind === 'left' ? 'left of' : 'before'} {name(a.choice === x ? y : x)}</>, sure(a))
    })}</ul>,
  ]
}

/** a place: `top`, or `above:<node>` */
const place = (where) => (where.includes(':') ? `${where.split(':')[0]} ${name(where.split(':')[1])}` : where)

/** an edit: only the answers that changed something */
function editStep(edit = {}, where = {}) {
  const changes = Object.entries(edit).flatMap(([q, a]) => {
    if (q.startsWith('remove_') && a.noul >= 0.5) return [line(<>Remove <b>{name(q.slice(7))}</b></>, a.noul)]
    if (q.startsWith('add_') && a.choice === 'use') return [line(<>Add <b>{name(q.slice(4))}</b></>, sure(a))]
    if (q.startsWith('set_') && a.choice !== 'keep') {
      const [node, param] = q.slice(4).split('__')
      return [line(<>{name(node)} · {catalog.get(node.split(/[~:]/)[0])?.params[param]?.label ?? param} → <b>{a.choice}</b></>, sure(a))]
    }
    return []
  })
  const places = Object.entries(where).filter(([q, a]) => q.startsWith('where_') && a.choice !== 'not_stated')
    .map(([q, a]) => line(<>{name(q.slice(6))} → <b>{place(a.choice)}</b></>, sure(a)))
  return [
    <h5>What changes? <small>“remove it?”, “add it?”, “change it?” per part</small></h5>,
    <ul className="hd-lines">{[...changes, ...places]}</ul>,
    changes.length + places.length === 0 && <p className="hd-none">No change it was sure of.</p>,
  ]
}

const opText = (o) => [o.op, o.part ?? '', o.node && `(${o.node})`, o.params && JSON.stringify(o.params), o.where].filter(Boolean).join(' ')

/** a chat model: its plan, or the operations of an edit */
function llmStep(d) {
  return [
    d.asked_for && <h5>Its plan <small>what the request asks for, in its words</small></h5>,
    d.asked_for && (d.asked_for.length ? <ol className="hd-plan">{d.asked_for.map((x) => <li>{x}</li>)}</ol> : <p className="hd-none">Nothing the parts show.</p>),
    d.ops && <h5>Its operations</h5>,
    d.ops && (d.ops.length ? <ol className="hd-plan hd-ops">{d.ops.map((o) => <li><code>{opText(o)}</code></li>)}</ol> : <p className="hd-none">None: nothing to change.</p>),
    d.repairs?.length > 0 && <h5>Repaired</h5>,
    d.repairs?.length > 0 && <ul className="hd-plan">{d.repairs.map((r) => <li><b>{r.kind}</b> {r.detail}</li>)}</ul>,
  ]
}

export function howItDecided(page) {
  const d = page.decisions
  const count = d && Object.values(d).reduce((n, step) => n + (step && typeof step === 'object' && !Array.isArray(step) ? Object.keys(step).length : 0), 0)
  return (
    <aside className="panel how-decided">
      <h3 className="panel-title">How the model decided{d && (d.select || d.edit) && <span className="badge">{count} answers</span>}</h3>
      {!d && <p className="hd-none">A decision model's answers, with their probabilities, or a chat model's plan.</p>}
      {d?.select && selectStep(d.select, d.layout)}
      {d?.edit && editStep(d.edit, d.where)}
      {d && !d.select && !d.edit && llmStep(d)}
    </aside>
  )
}
