// Structured output: one LLM request with `output: Event` (a zod schema, event.js). While the
// model writes, DELTA carries the raw JSON so far; on EXTRACTED the driver has parsed and
// validated it, and `value` is a typed Event; on FAILED, `issues` lists what didn't match.
//
// No parsing or validation code here: the driver does both with the schema it sent.
import { ABORT, classes } from 'sygnal'
import { outputJsonSchema } from 'sygnal/ai'
import { modelOf } from '../../shared/providers.js'
import { providersResource, pickerState, pickerIntent, pickerModel, pickedModel, modelPicker } from '../../shared/picker.jsx'
import { Event } from './event.js'
import { EMAILS } from './emails.js'

const PICKER = { need: 'chat' }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** a YYYY-MM-DD day `n` days on, with its weekday (dates as UTC noon: no time zone shifts) */
const dayAfter = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return { iso: d.toISOString().slice(0, 10), weekday: WEEKDAYS[d.getUTCDay()], month: d.getUTCMonth(), year: d.getUTCFullYear() }
}

/**
 * The instructions: today's date and the next three weeks spelled out, so "next Thursday"
 * resolves, and the schema itself. Ollama uses the request's schema as a grammar only (the model
 * can't write anything else, but never reads the `.describe()` texts), so they go here as well.
 */
function instructions(today) {
  const days = Array.from({ length: 21 }, (_, n) => dayAfter(today, n))
  const next = dayAfter(`${today.slice(0, 7)}-01`, 32)
  return [
    `You turn an email into a calendar event. Today is ${days[0].weekday} ${today}. The next three weeks: ${days.map((d) => `${d.weekday} ${d.iso}`).join(', ')}.`,
    `"Next month" is ${MONTHS[next.month]} ${next.year}.`,
    'Answer with one JSON object that matches this JSON Schema; each field\'s description says what goes in it:',
    JSON.stringify(outputJsonSchema(Event).schema),
    'Use only what the email says. A value it doesn\'t give is null: never invent an email address, a time zone, a place or agenda items.',
    'The person who sends or sets up the invitation is the organizer, listed first.',
  ].join('\n')
}

const extract = (state, email) => ({
  model: pickedModel(state, PICKER),
  instructions: instructions(state.today),
  messages: [{ role: 'user', content: email }],
  output: Event,          // sent as JSON Schema; the reply is parsed and validated against it
  key: 'extract',
  delta: 'DELTA',
  ok: 'EXTRACTED',
  error: 'FAILED',
})

const canExtract = (state, email) => !!(email.trim() && pickedModel(state, PICKER) && state.status !== 'extracting')

// ---- the view ---------------------------------------------------------------------------

const initials = (name) => name.split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?'

const endTime = (start, minutes) => {
  const [h, m] = start.split(':').map(Number)
  const end = (h * 60 + m + minutes) % (24 * 60)
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}

const duration = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`)

function when(event) {
  if (!event.date) return 'No date yet'
  const d = dayAfter(event.date, 0)
  const day = `${d.weekday.slice(0, 3)}, ${MONTHS[d.month].slice(0, 3)} ${Number(event.date.slice(8))}`
  if (!event.start) return day
  const range = event.durationMinutes ? `${event.start}–${endTime(event.start, event.durationMinutes)}` : event.start
  return `${day} · ${range}${event.timeZone ? ` ${event.timeZone}` : ''}`
}

/** the validated event, as a card to review */
function eventCard(event) {
  return (
    <article className="event-card">
      <header>
        <h3>{event.title}</h3>
        <span className={classes('badge', { bad: event.priority === 'high', blue: event.priority === 'normal' })}>{event.priority} priority</span>
      </header>
      <div className="chips">
        <span className="chip when">📅 {when(event)}</span>
        {event.durationMinutes && <span className="chip">⏱ {duration(event.durationMinutes)}</span>}
        {event.location && <span className="chip">📍 {event.location}</span>}
        {event.online && <span className="chip online">🎥 Online</span>}
      </div>
      {event.attendees.length > 0 && (
        <ul className="attendees">
          {event.attendees.map((a) => (
            <li className={a.role}>
              <span className="avatar" aria-hidden="true">{initials(a.name)}</span>
              <span className="who"><b>{a.name}</b>{a.email && <small>{a.email}</small>}</span>
              <span className="role">{a.role}</span>
            </li>
          ))}
        </ul>
      )}
      {event.agenda.length > 0 && (
        <ol className="agenda">{event.agenda.map((item) => <li>{item}</li>)}</ol>
      )}
    </article>
  )
}

const pathOf = (path) => (path ?? []).map((k) => (typeof k === 'object' ? k.key : k)).join('.') || '(root)'

function usageLine(meta) {
  const u = meta.usage
  return (
    <p className="via">
      <code>{meta.model}</code>
      {u?.outputTokens != null && ` · ${u.inputTokens ?? '?'} tokens in / ${u.outputTokens} out`}
    </p>
  )
}

export default function EventExtractor({ state }) {
  const busy = state.status === 'extracting'
  const model = pickedModel(state, PICKER)
  return (
    <div className="w structured">
      <div className="w-toolbar">
        {modelPicker(state, PICKER, { disabled: busy })}
        <span className="grow" />
        <span className="badge" title="Relative dates in the email resolve against this day">Today: {state.today}</span>
      </div>

      <div className="w-grid">
        <form className="panel source extract">
          <p className="panel-title">The email</p>
          <textarea className="email" aria-label="Email" rows="14" spellcheck="false" value={state.email} disabled={busy} />
          <div className="examples">
            {EMAILS.map((e, i) => <button type="button" className={classes('example', { picked: e.text === state.email })} data={{ index: i }} disabled={busy || !model}>{e.label}</button>)}
          </div>
          <div className="actions">
            {busy
              ? <button type="button" className="btn ghost stop">Stop</button>
              : <button type="submit" className="btn" disabled={!canExtract(state, state.email)}>Extract event</button>}
            <small>Small local models occasionally miss the schema; the issues show below when they do.</small>
          </div>
        </form>

        <section className="panel result" aria-live="polite">
          <p className="panel-title">
            {busy ? 'The model is writing JSON' : state.event ? 'Validated event' : state.issues ? 'Did not match the schema' : 'Result'}
            {busy && <span className="spinner" />}
            {state.event && <span className="badge ok">✓ valid</span>}
            {state.issues && <span className="badge bad">{state.issues.length} issue{state.issues.length === 1 ? '' : 's'}</span>}
          </p>

          {busy && <pre className="json raw streaming">{state.raw || '…'}</pre>}

          {!busy && state.event && [
            eventCard(state.event),
            <details className="value">
              <summary>Validated value</summary>
              <pre className="json">{JSON.stringify(state.event, null, 2)}</pre>
            </details>,
          ]}

          {!busy && state.issues && [
            <ul className="issues">
              {state.issues.map((issue) => <li><code>{pathOf(issue.path)}</code> {issue.message}</li>)}
            </ul>,
            <p className="raw-label">What the model wrote</p>,
            <pre className="json raw">{state.raw || '(nothing)'}</pre>,
          ]}

          {!busy && !state.event && !state.issues && !state.error && (
            <p className="empty">Pick a sample or paste an email, then <b>Extract event</b>. The JSON streams in here, then turns into an event card once the schema accepts it.</p>
          )}
          {state.error && <p className="status-line error" role="alert">{state.error}</p>}
          {!busy && state.meta && usageLine(state.meta)}
        </section>
      </div>
    </div>
  )
}

/** today, once, as YYYY-MM-DD in the viewer's time zone (the reducers never read the clock) */
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

EventExtractor.initialState = {
  ...pickerState,
  today: localToday(),
  email: EMAILS[0].text,
  status: 'ready',
  raw: '',          // the JSON so far, as the model writes it
  event: null,      // the validated value
  issues: null,     // the schema's issues when it didn't match
  error: null,
  meta: null,       // which model answered, and its token usage
}

EventExtractor.resources = providersResource

EventExtractor.intent = ({ DOM }) => ({
  ...pickerIntent(DOM),
  TYPE: DOM.input('.email').value(),
  EXTRACT: DOM.select('.extract').events('submit', { preventDefault: true }),
  SAMPLE: DOM.click('.example').data('index').map(Number),
  STOP: DOM.click('.stop'),
})

/** start an extraction of `email(state, data)`: clear the result, send the request */
const extracting = (email) => ({
  STATE: (state, data) => (canExtract(state, email(state, data))
    ? { ...state, email: email(state, data), status: 'extracting', raw: '', event: null, issues: null, error: null, meta: null }
    : ABORT),
  LLM: (state, data, next, { previousState }) => (canExtract(previousState, email(previousState, data)) ? extract(state, state.email) : ABORT),
})

const answeredBy = (state, usage) => ({ model: modelOf(pickedModel(state, PICKER)), usage })

EventExtractor.model = {
  ...pickerModel,
  TYPE: (state, email) => ({ ...state, email }),
  EXTRACT: extracting((state) => state.email),
  SAMPLE: extracting((state, i) => EMAILS[i]?.text ?? ''),
  DELTA: (state, { text }) => ({ ...state, raw: text }),
  EXTRACTED: (state, { value, text, usage }) => ({ ...state, status: 'ready', raw: text, event: value, meta: answeredBy(state, usage) }),
  // `issues`: the reply wasn't JSON, or zod rejected it; else a transport error (HTTP, network)
  FAILED: (state, { error, issues }) => ({
    ...state,
    status: 'ready',
    issues: issues ?? null,
    error: issues ? null : error.body?.error?.message ?? error.body?.error ?? error.message,
    meta: issues ? answeredBy(state) : null,
  }),
  STOP: {
    STATE: (state) => ({ ...state, status: 'ready', raw: '' }),
    LLM: () => ({ abort: 'extract' }),
  },
}
