// Support-ticket triage on a decision model: four typed questions, answered with probabilities.
//
// The decision is a resource: it reads the ticket text and the picked model, so it runs again
// whenever either changes, and a request for older text is aborted. The textarea updates at once;
// the text the resource reads follows 400 ms after the last keystroke (a debounce in the intent).
//
// Routing is what calibration is for: an answer at or above the threshold is acted on, an unsure
// one sends the ticket to a person, and the slider sets where "sure" starts.
import { ABORT, classes, debounce } from 'sygnal'
import { decide, choice, noul, score } from 'sygnal/ai'
import { providersResource, pickerState, pickerIntent, pickerModel, choicesOf, pickedModel, modelPicker } from '../../shared/picker.jsx'

export const questions = {
  topic: choice('What is this support ticket mainly about?', {
    billing: 'Payments, charges, invoices, refunds, plans or prices',
    bug: 'Something in the product is broken, crashes or shows an error',
    account: 'Signing in, passwords, access, team members or profile settings',
    feature: 'A request for a new feature or a change to how the product works',
    praise: 'Thanks or a compliment, with nothing to fix',
  }),
  urgent: noul('Does the customer need this handled today?', {
    true: 'They are blocked from working, losing money, or facing a deadline',
    false: 'A question, a suggestion, a minor annoyance or a thank-you',
  }),
  mood: score('How upset is the customer?', ['calm or happy', 'annoyed', 'frustrated', 'angry', 'furious']),
  churn: noul('Is the customer threatening to cancel or move to a competitor?', {
    true: 'They mention cancelling, leaving, a refund of the plan or looking elsewhere',
    false: 'Nothing suggests they want to leave',
  }),
}

const TOPICS = {
  billing: { label: 'Billing', team: 'the Billing team' },
  bug: { label: 'Bug', team: 'Engineering support' },
  account: { label: 'Account', team: 'the Accounts team' },
  feature: { label: 'Feature request', team: 'the Product team' },
  praise: { label: 'Praise', team: 'Customer success' },
}

const EXAMPLES = [
  { label: 'Double charge', sure: true, text: 'I was charged twice for my Pro plan this month. Please refund the second charge.' },
  { label: 'Crash before a demo', sure: true, text: 'Since the last update the app crashes every time I open Settings. My whole team is stuck and we have a client demo at 3pm. Fix this NOW.' },
  { label: 'Thank you', sure: true, text: 'Just wanted to say the new dashboard is fantastic. My team loves it, thank you!' },
  { label: 'CSV export', sure: true, text: 'It would be great if we could export our reports as CSV files.' },
  { label: 'Fix it or we leave', sure: true, text: 'Nothing has worked properly since yesterday and our renewal is next week. Sort it out or we will look elsewhere.' },
  { label: 'Paid, still on Free', sure: false, text: 'I upgraded and paid, but my account still says Free.' },
  { label: 'Locked out of a refund', sure: false, text: 'I can\'t log in to download the invoice I need for my refund.' },
  { label: 'Missing invoices', sure: false, text: 'I can\'t see my invoices anymore.' },
]

const PICK = { need: 'decision' }

/** the picked decision model: { id, label, url, model } */
const backendOf = (state) => choicesOf(state, PICK).find((c) => c.id === pickedModel(state, PICK)) ?? null

/** a noul answer is as sure as its distance from a coin flip */
const noulSure = (p) => Math.max(p, 1 - p)
const pct = (x) => `${Math.round(x * 100)}%`

/** one request per (model, text): the timer below measures each */
const requestOf = (state) => `${pickedModel(state, PICK)}|${state.text}`
const busy = (r) => r?.status === 'loading' || !!r?.refreshing

/** where the ticket goes: a team when the routing questions are sure, else a person, and why */
function routing(answers, threshold) {
  const { topic, urgent, mood, churn } = answers
  const unsure = []
  if (topic.confidence < threshold) {
    const [first, second] = Object.entries(topic.probabilities).sort((a, b) => b[1] - a[1])
    unsure.push(`the topic: ${pct(first[1])} ${TOPICS[first[0]].label.toLowerCase()}, ${pct(second[1])} ${TOPICS[second[0]].label.toLowerCase()}`)
  }
  if (noulSure(urgent.noul) < threshold) unsure.push(`the urgency: ${pct(urgent.noul)} that it can't wait`)
  const tags = [
    noulSure(urgent.noul) >= threshold && urgent.noul >= 0.5 && { text: 'Priority queue', tone: 'bad' },
    mood.confidence >= threshold && mood.score >= 2.5 && { text: 'Handle with care', tone: 'warn' },
    noulSure(churn.noul) >= threshold && churn.noul >= 0.5 && { text: 'Churn risk', tone: 'warn' },
  ].filter(Boolean)
  return unsure.length ? { person: true, unsure, tags } : { person: false, team: TOPICS[topic.choice].team, tags }
}

function routeCard(answers, threshold) {
  const r = routing(answers, threshold)
  return (
    <div className={classes('route', { person: r.person })} aria-live="polite">
      <span className="route-icon" aria-hidden="true">{r.person ? '?' : '→'}</span>
      <div className="route-body">
        <b>{r.person ? 'Needs a person' : `Auto-assigned to ${r.team}`}</b>
        <span className="route-why">
          {r.person ? `Not sure about ${r.unsure.join(', and ')}.` : `Every routing answer is at least ${pct(threshold)} sure.`}
        </span>
        {r.tags.length > 0 && <span className="route-tags">{r.tags.map((t) => <span className={classes('badge', t.tone)}>{t.text}</span>)}</span>}
      </div>
    </div>
  )
}

/** a confidence chip: green when it clears the threshold */
const sureBadge = (c, threshold) => <span className={classes('badge', c >= threshold ? 'ok' : 'warn')}>{pct(c)} sure</span>

function topicView(a, threshold) {
  return (
    <section className="q">
      <h4>Topic <code>choice</code>{sureBadge(a.confidence, threshold)}</h4>
      <div className="bars">
        {Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).map(([k, p]) => (
          <div className={classes('bar', { top: k === a.choice })}>
            <span className="name">{TOPICS[k].label}</span>
            <span className="track"><span className="fill" style={{ width: pct(p) }} /></span>
            <span className="pct">{pct(p)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** a noul as a meter from no to yes; the shaded band is where it counts as unsure */
function gauge(title, p, threshold, [no, yes]) {
  const band = 1 - threshold
  return (
    <section className="q">
      <h4>{title} <code>noul</code>{sureBadge(noulSure(p), threshold)}</h4>
      <div className="gauge">
        <span className="gauge-band" style={{ left: pct(band), width: pct(1 - 2 * band) }} />
        <span className="gauge-fill" style={{ width: pct(p) }} />
        <span className="gauge-mark" style={{ left: pct(p) }} />
      </div>
      <div className="gauge-ends"><span>{no}</span><b>{pct(p)} yes</b><span>{yes}</span></div>
    </section>
  )
}

/** a score as a scale: each level's probability as its shade, a marker at the weighted level */
function scale(a, threshold) {
  const levels = Object.values(a.legend)
  return (
    <section className="q">
      <h4>Mood <code>score</code>{sureBadge(a.confidence, threshold)}</h4>
      <div className="scale">
        {levels.map((name, i) => <span className="step" style={{ '--p': a.probabilities[i] }} title={`${name}: ${pct(a.probabilities[i])}`}>{name}</span>)}
        <span className="scale-mark" style={{ left: `${((a.score + 0.5) / levels.length) * 100}%` }} />
      </div>
    </section>
  )
}

export default function Triage({ state }) {
  const t = state.triage
  const answers = t.status === 'success' && t.data.answers
  const backend = backendOf(state)
  return (
    <div className="w triage">
      <div className="w-toolbar">
        {modelPicker(state, PICK, { label: 'Decision model' })}
        <label className="threshold-pick">
          <span>Sure at <b>{pct(state.threshold)}</b></span>
          <input type="range" className="threshold" min="0.5" max="0.95" step="0.05" value={state.threshold} />
        </label>
      </div>

      <div className="w-grid">
        <div className="panel ticket">
          <h3 className="panel-title">Ticket</h3>
          <textarea className="text" rows="6" aria-label="Ticket" placeholder="Paste or type a support ticket…" value={state.draft} />
          <p className="examples-label">Clear</p>
          <div className="examples">{EXAMPLES.filter((e) => e.sure).map((e) => <button type="button" className="example" data={{ text: e.text }} title={e.text}>{e.label}</button>)}</div>
          <p className="examples-label">Ambiguous</p>
          <div className="examples">{EXAMPLES.filter((e) => !e.sure).map((e) => <button type="button" className="example" data={{ text: e.text }} title={e.text}>{e.label}</button>)}</div>
        </div>

        <div className={classes('panel', 'verdict', { stale: busy(t) })}>
          <h3 className="panel-title">
            Decision
            <span className="timing">
              {busy(t) && <span className="spinner" />}
              {answers && state.took != null && !busy(t) && <><code>{t.data.model}</code> · {state.took} ms</>}
            </span>
          </h3>
          {!state.text.trim() && <p className="status-line">Type a ticket, or pick an example.</p>}
          {!backend && <p className="status-line">No decision model: pull <code>nimble</code> into Ollama, or add a TypeSafe key.</p>}
          {t.status === 'error' && <p className="status-line error" role="alert">Could not decide: {t.error.message}</p>}
          {answers && <>
            {routeCard(answers, state.threshold)}
            {topicView(answers.topic, state.threshold)}
            {gauge('Urgent', answers.urgent.noul, state.threshold, ['can wait', 'today'])}
            {scale(answers.mood, state.threshold)}
            {gauge('Churn risk', answers.churn.noul, state.threshold, ['staying', 'leaving'])}
          </>}
        </div>
      </div>
    </div>
  )
}

Triage.initialState = {
  ...pickerState,
  draft: EXAMPLES[0].text,   // the textarea
  text: EXAMPLES[0].text,    // what the decision reads: the draft, once typing pauses
  threshold: 0.6,
  since: null,               // when the current request went out (performance.now(), from the intent)
  took: null,                // how long the last decision took, in ms
}

Triage.resources = {
  ...providersResource,
  triage: (state) => {
    const backend = backendOf(state)
    return backend && state.text.trim()
      ? decide({ url: backend.url, model: backend.model, state: state.text, questions, keepPrevious: true })
      : null
  },
}

Triage.intent = ({ DOM, STATE }) => {
  const typed$ = DOM.input('.text').value()
  return {
    ...pickerIntent(DOM),
    TYPE: typed$,
    SETTLE: typed$.compose(debounce(400)),
    EXAMPLE: DOM.click('.example').data('text'),
    THRESHOLD: DOM.input('.threshold').value().map(Number),
    // timing: the clock is read here, as the request starts and as it settles (reducers stay pure)
    CLOCK: STATE.watch((state) => (busy(state.triage) ? requestOf(state) : null)).map((request) => ({ request, at: performance.now() })),
  }
}

Triage.model = {
  ...pickerModel,
  TYPE: (state, draft) => ({ ...state, draft }),
  SETTLE: (state, text) => (text === state.text ? ABORT : { ...state, text }),
  EXAMPLE: (state, text) => ({ ...state, draft: text, text }),
  THRESHOLD: (state, threshold) => ({ ...state, threshold }),
  CLOCK: (state, { request, at }) => {
    if (request) return { ...state, since: at }
    if (state.since == null) return ABORT
    return { ...state, since: null, took: state.triage.status === 'success' ? Math.round(at - state.since) : null }
  },
}
