// The parts a model may place: working components with the app's own data. Every number, label and
// row on a composed page comes from here, never from a model; a model only picks a part and, where
// the catalog allows it, a param from a fixed list (catalog.js).
import { classes } from 'sygnal'

/** a part's frame: a plain view helper, so each part is one instance with its own title */
const card = (part, title, sub, body) => (
  <section className={classes('ca-card', `ca-${part}`)}>
    <header><h4>{title}</h4>{sub && <span className="ca-sub">{sub}</span>}</header>
    {body}
  </section>
)

/** a smooth-ish SVG path through points (straight segments are fine at this size) */
const pathOf = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

/** a deterministic series: a trend with a weekly rhythm (no randomness, so tests and screenshots agree) */
const series = (n, from, to, wobble) => Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / (n - 1) + wobble * Math.sin(i * 1.7) + wobble * 0.5 * Math.cos(i * 0.6)))

// ---- KPI cards -------------------------------------------------------------------------------

const KPIS = {
  activeUsers: { title: 'Active users', value: '18.4k', delta: '+8.2%', good: true, note: 'daily, vs last week', spark: series(14, 15200, 18400, 600) },
  revenue: { title: 'Revenue', value: '$284k', delta: '+5.1%', good: true, note: 'MRR, vs last month', spark: series(14, 251, 284, 6) },
  conversion: { title: 'Conversion', value: '4.6%', delta: '−0.3 pt', good: false, note: 'trial → paid, 30 days', spark: series(14, 50, 46, 2) },
}

function spark(values) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 26 - ((v - min) / (max - min || 1)) * 22])
  return <svg className="ca-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d={pathOf(pts)} /></svg>
}

export function Kpi({ metric }) {
  const k = KPIS[metric]
  return card(metric, k.title, k.note,
    <div className="ca-kpi">
      <b className="ca-value">{k.value}</b>
      <span className={classes('ca-delta', k.good ? 'good' : 'bad')}>{k.delta}</span>
      {spark(k.spark)}
    </div>)
}

// ---- traffic: an area chart with a range param ------------------------------------------------

const RANGES = {
  week: { title: 'last 7 days', values: series(7, 16900, 18400, 700), labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
  month: { title: 'last 30 days', values: series(30, 14800, 18400, 650), labels: (i) => (i % 7 === 0 ? `${30 - i}d` : '') },
  quarter: { title: 'last 3 months', values: series(13, 12100, 18400, 500), labels: (i) => (i % 4 === 0 ? ['Jul', 'Aug', 'Sep', 'Oct'][i / 4] : '') },
  year: { title: 'last 12 months', values: series(12, 6200, 18400, 450), labels: ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'] },
}

export function TrafficChart({ range }) {
  const { title, values, labels } = RANGES[range] ?? RANGES.month
  const w = 560
  const h = 170
  const top = Math.ceil(Math.max(...values) / 5000) * 5000
  const x = (i) => 36 + (i / (values.length - 1)) * (w - 48)
  const y = (v) => h - 24 - (v / top) * (h - 40)
  const pts = values.map((v, i) => [x(i), y(v)])
  const label = (i) => (typeof labels === 'function' ? labels(i) : labels[i])
  return card('traffic', 'Traffic', `active users · ${title}`,
    <svg className="ca-area" data-range={range} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Active users, ${title}`}>
      <defs>
        <linearGradient id="ca-area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" /><stop offset="1" /></linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g className="ca-grid">
          <line x1="36" x2={w - 12} y1={y(top * f)} y2={y(top * f)} />
          <text x="30" y={y(top * f) + 4} text-anchor="end">{`${Math.round((top * f) / 1000)}k`}</text>
        </g>
      ))}
      <path className="ca-fill" d={`${pathOf(pts)} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} />
      <path className="ca-line" d={pathOf(pts)} />
      <circle className="ca-dot" cx={x(values.length - 1)} cy={y(values.at(-1))} r="4" />
      {values.map((_, i) => label(i) ? <text className="ca-tick" x={x(i)} y={h - 6} text-anchor="middle">{label(i)}</text> : null)}
    </svg>)
}

// ---- the signup funnel --------------------------------------------------------------------------

const FUNNEL = [['Visited', 42180], ['Signed up', 6320], ['Activated', 3910], ['Started a trial', 1480], ['Paid', 290]]

export function Funnel() {
  return card('funnel', 'Signup funnel', 'last 30 days',
    <ol className="ca-funnel">
      {FUNNEL.map(([step, n], i) => (
        <li>
          <span className="ca-step">{step}</span>
          <span className="ca-track"><span style={{ width: `${Math.max(2, (n / FUNNEL[0][1]) * 100)}%` }} /></span>
          <span className="ca-n">{n.toLocaleString('en-US')}</span>
          <span className="ca-rate">{i ? `${((n / FUNNEL[i - 1][1]) * 100).toFixed(0)}%` : ''}</span>
        </li>
      ))}
    </ol>)
}

// ---- top pages: a table with a limit param ----------------------------------------------------

const PAGES = [
  ['/pricing', 48210, 31], ['/docs/getting-started', 39870, 22], ['/blog/funnels-v2', 27450, 44], ['/features/replay', 21300, 36],
  ['/changelog', 16920, 28], ['/docs/api', 14480, 19], ['/integrations', 11230, 41], ['/customers', 9870, 47],
  ['/careers', 6420, 52], ['/security', 4110, 33],
]

export function TopPages({ limit }) {
  const rows = PAGES.slice(0, limit)
  return card('pages', 'Top pages', `top ${rows.length} by views`,
    <table className="ca-table" data-limit={String(limit)}>
      <thead><tr><th>Page</th><th>Views</th><th>Bounce</th></tr></thead>
      <tbody>{rows.map(([path, views, bounce]) => <tr><td><code>{path}</code></td><td>{views.toLocaleString('en-US')}</td><td>{bounce}%</td></tr>)}</tbody>
    </table>)
}

// ---- countries: a bar list --------------------------------------------------------------------

const COUNTRIES = [['🇺🇸', 'United States', 31], ['🇩🇪', 'Germany', 12], ['🇬🇧', 'United Kingdom', 10], ['🇮🇳', 'India', 9], ['🇧🇷', 'Brazil', 7], ['🇯🇵', 'Japan', 6]]

export function Countries() {
  return card('countries', 'Visitors by country', 'share of sessions',
    <ul className="ca-bars">
      {COUNTRIES.map(([flag, name, pct]) => (
        <li><span className="ca-flag">{flag}</span><span className="ca-name">{name}</span><span className="ca-track"><span style={{ width: `${(pct / COUNTRIES[0][2]) * 100}%` }} /></span><span className="ca-n">{pct}%</span></li>
      ))}
    </ul>)
}

// ---- incidents: a list with a severity param ----------------------------------------------------

const INCIDENTS = [
  { severity: 'critical', title: 'Checkout API p95 latency above 2 s', service: 'payments', ago: '6 min' },
  { severity: 'warning', title: 'Event ingestion lag at 4 minutes', service: 'pipeline', ago: '22 min' },
  { severity: 'critical', title: 'Login errors spiking in eu-west', service: 'auth', ago: '41 min' },
  { severity: 'info', title: 'Scheduled maintenance of the replay store', service: 'replay', ago: '2 h' },
]

export function Incidents({ severity }) {
  const rows = INCIDENTS.filter((i) => severity === 'any' || i.severity === severity)
  return card('incidents', severity === 'critical' ? 'Critical incidents' : 'Incidents', `${rows.length} open`,
    <ul className="ca-incidents" data-severity={severity}>
      {rows.map((i) => (
        <li className={i.severity}><span className="ca-sev">{i.severity}</span><span className="ca-title">{i.title}</span><span className="ca-meta">{i.service} · {i.ago} ago</span></li>
      ))}
    </ul>)
}

// ---- release notes ----------------------------------------------------------------------------

const RELEASES = [
  { version: '4.2', date: 'Oct 9', title: 'Funnels v2', notes: ['Break down any step by plan or country', 'Compare two date ranges'] },
  { version: '4.1.3', date: 'Oct 2', title: 'Faster replays', notes: ['Session replays load 3× faster'] },
  { version: '4.1', date: 'Sep 24', title: 'Alerts in Slack', notes: ['Route incidents to a channel by severity'] },
]

export function Releases() {
  return card('releases', 'Release notes', 'latest',
    <ol className="ca-releases">
      {RELEASES.map((r) => (
        <li><span className="ca-version">v{r.version}</span><div><b>{r.title}</b> <span className="ca-meta">{r.date}</span><ul>{r.notes.map((n) => <li>{n}</li>)}</ul></div></li>
      ))}
    </ol>)
}

// ---- the launch checklist: a part with state ----------------------------------------------------
// Its catalog entry has `state: 'launch'`, a lens into the app's state: the ticks survive any
// recomposition, and the app sees them (the toolbar counts them).

export function LaunchChecklist({ state }) {
  const done = state.filter((t) => t.done).length
  return card('launch', 'Launch checklist', `v4.3 · ${done} of ${state.length} done`,
    <div>
      <span className="ca-progress"><span style={{ width: `${(done / state.length) * 100}%` }} /></span>
      <ul className="ca-checklist">
        {state.map((t) => (
          <li className={t.done ? 'done' : ''}><label><input type="checkbox" className="ca-toggle" checked={t.done} data={{ id: t.id }} /> {t.text}</label></li>
        ))}
      </ul>
    </div>)
}

LaunchChecklist.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.ca-toggle').data('id', Number) })
LaunchChecklist.model = { TOGGLE: (tasks, id) => tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }

export const LAUNCH = [
  { id: 1, text: 'Freeze the 4.3 feature branch', done: true },
  { id: 2, text: 'Update the funnels docs', done: false },
  { id: 3, text: 'Load-test the checkout API', done: false },
  { id: 4, text: 'Write the release notes', done: false },
]
