// The board's parts. Every card shows the arranger's reason (`why`) and the person's own controls:
// pin (always on top) and snooze (leave it off the board).
//
// Two kinds, on purpose:
// - IncidentCard is a component with its own model, bound to its incident record by a lens
//   (byId), so "Acknowledge" and the note edit app state. Its pin/snooze go up as PARENT values.
// - The others are view functions (`render`): they read the host's state, and their buttons are
//   heard by the host's own intent.
const SEV_TONE = { 1: 'red', 2: 'amber', 3: 'blue' }

/**
 * The frame around every part. A view helper, called as a function: a capitalized JSX tag
 * (<Card>) would be a child component, and the buttons inside it would be out of reach of the
 * part's (or the host's) intent.
 */
export function card({ node, title, size, why, tone, pinned }, body) {
  return (
    <article className={`card ${size} ${tone ?? ''}`} data-node={node}>
      <header>
        <h3>{title}</h3>
        <span className="tools">
          <button type="button" className={pinned ? 'pin on' : 'pin'} data={{ node }} aria-pressed={String(!!pinned)} title="Keep it at the top">{pinned ? 'Pinned' : 'Pin'}</button>
          <button type="button" className="snooze" data={{ node }} title="Take it off the board">Snooze</button>
        </span>
      </header>
      {why && <p className="why">{why}</p>}
      {size === 'full' && body}
    </article>
  )
}

export function IncidentCard({ state, node, size, why, pinned }) {
  if (!state) return <article className="card gone">Resolved</article>
  return card({ node, title: `SEV${state.sev} · ${state.title}`, size, why, tone: SEV_TONE[state.sev], pinned }, (
    <div>
      <dl>
        <dt>Service</dt><dd>{state.service}</dd>
        <dt>Open for</dt><dd>{state.minutes} min</dd>
        <dt>Status</dt><dd>{state.acked ? 'Acknowledged by you' : 'Nobody has acknowledged it'}</dd>
      </dl>
      {!state.acked && <button type="button" className="ack primary">Acknowledge</button>}
      <label className="note">
        <span>Notes</span>
        <textarea className="note-text" rows="2" value={state.note} placeholder="What you tried, who you paged…" />
      </label>
    </div>
  ))
}
IncidentCard.intent = ({ DOM }) => ({
  ACK: DOM.click('.ack'),
  NOTE: DOM.input('.note-text').value(),
  PIN: DOM.click('.pin').data('node'),
  SNOOZE: DOM.click('.snooze').data('node'),
})
IncidentCard.model = {
  ACK: (state) => ({ ...state, acked: true }),
  NOTE: (state, note) => ({ ...state, note }),
  PIN: { PARENT: (state, node) => ({ type: 'pin', node }) },
  SNOOZE: { PARENT: (state, node) => ({ type: 'snooze', node }) },
}

const STATUS_TONE = { ok: 'ok', degraded: 'amber', down: 'red' }
const pinnedIn = (state, node) => state.pins.includes(node)

export function Services({ state, node, size, why }) {
  const tone = state.services.some((s) => s.status === 'down') ? 'red' : state.services.some((s) => s.status !== 'ok') ? 'amber' : ''
  return card({ node, title: 'Services', size, why, tone, pinned: pinnedIn(state, node) }, (
    <ul className="grid">
      {state.services.map((s) => <li className={STATUS_TONE[s.status]}><b>{s.name}</b> {s.status}{s.status !== 'down' && <span className="muted"> · p99 {s.p99} ms</span>}</li>)}
    </ul>
  ))
}

export function Slo({ state, node, size, why }) {
  const burn = state.slo.burn
  const pct = Math.min(100, Math.round((burn / 8) * 100))
  return card({ node, title: 'Error budget', size, why, tone: burn >= 5 ? 'red' : burn >= 2 ? 'amber' : '', pinned: pinnedIn(state, node) }, (
    <div>
      <div className="meter" role="meter" aria-valuemin="0" aria-valuemax="8" aria-valuenow={burn} aria-label="Burn rate"><span style={{ width: `${pct}%` }} /></div>
      <p>Burning <b>{burn}×</b> the sustainable rate.</p>
    </div>
  ))
}

export function Queue({ state, node, size, why }) {
  const q = state.queue
  return card({ node, title: 'Job queue', size, why, tone: q.depth >= 1500 ? 'amber' : '', pinned: pinnedIn(state, node) }, (
    <p><b>{q.depth.toLocaleString('en-US')}</b> jobs waiting {q.trend > 0 ? '↑' : q.trend < 0 ? '↓' : '→'}</p>
  ))
}

export function Deploys({ state, node, size, why }) {
  const tone = state.deploys.some((d) => d.status === 'rolling back') ? 'amber' : ''
  return card({ node, title: 'Deploys', size, why, tone, pinned: pinnedIn(state, node) }, (
    <ul>{state.deploys.slice(0, 4).map((d) => <li>{d.service} {d.version} · {d.status} <span className="muted">{d.ago} min ago</span></li>)}</ul>
  ))
}

export function Reviews({ state, node, size, why }) {
  return card({ node, title: 'Reviews waiting on you', size, why, pinned: pinnedIn(state, node) }, (
    <ul>{state.reviews.map((r) => <li>{r.title} <span className="muted">· {r.author}, {r.hours} h</span></li>)}</ul>
  ))
}

export function Agenda({ state, node, size, why }) {
  return card({ node, title: 'Agenda', size, why, pinned: pinnedIn(state, node) }, (
    <ul>{state.agenda.map((a) => <li>{a.title} <span className="muted">{a.in >= 0 ? `in ${a.in} min` : 'now'}</span></li>)}</ul>
  ))
}

export function Oncall({ state, node, size, why }) {
  const o = state.oncall
  return card({ node, title: 'On call', size, why, pinned: pinnedIn(state, node) }, (
    <p>Primary: <b>{o.primary}</b> · secondary: {o.secondary}</p>
  ))
}

/** the `quiet` container: the calm parts, folded */
export function Quiet({ children, ui, control }) {
  const open = !!ui.open
  return (
    <section className="quiet">
      <button type="button" className="quiet-toggle link" aria-expanded={String(open)} {...control('open', !open)}>
        {open ? 'Hide' : 'Show'} the calm parts ({children.length})
      </button>
      {/* hidden, not removed: a folded part keeps its instance */}
      <div className="quiet-body" hidden={!open}>{children.map((c) => c.vnode)}</div>
    </section>
  )
}
