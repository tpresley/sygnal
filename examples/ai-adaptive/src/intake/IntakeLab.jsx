// Lab 1: a form built from pieces for the task the person describes.
//
// - The person writes the task ("I left my laptop on the train"); the model picks the field
//   pieces it needs, writes their labels and questions, and groups them.
// - The pieces are view functions inside the host's <form className="intake">, so one `form`
//   behavior holds every value, whatever the model placed: its `dynamic` fields follow the layout
//   (each piece's values under its node key), and its schema is a function of the layout (each
//   piece's rules, so what is required is what is on the form).
// - While the form is filled in, the app edits it (adapt.js): "critical" adds an approver, a large
//   amount adds a receipts upload. Each edit is a follow-up compose, so what was typed stays.
// - The person can edit it too, in words ("also ask for a phone number"), or remove a piece.
import { ABORT, form } from 'sygnal'
import { compose } from 'sygnal/ai'
import { catalog, formFields, formRequest, formSchema, placed, shown } from './catalog.jsx'
import { nextRule, RULES } from './adapt.js'
import { TASKS } from './data.js'
import { llm } from '../llm.js'
import { modelPlan } from '../plan.jsx'

/** what was sent, for the "Sent" panel: files as a count */
const summary = (values) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Array.isArray(v) && v.every((f) => f instanceof Blob) ? `${v.length} file(s)` : v]))

const STATUS = {
  idle: () => 'Describe what you need; the form is built for it.',
  composing: () => 'Building the form…',
  preview: () => 'Placing the fields…',
  done: () => '',
  unavailable: () => 'Nothing in the field library fits that.',
  error: (page) => `The model failed: ${page.error}`,
}

export default function IntakeLab({ state }) {
  const page = state.page
  const busy = page.status === 'composing' || page.status === 'preview'
  const pieces = placed(page.layout)
  const invalid = Object.keys(state.intake.errors).filter((n) => n && state.intake.errors[n]).length
  return (
    <section className="lab intake-lab">
      <header>
        <h2>An intake form, built for the task</h2>
        <p className="muted">The model picks field pieces from a library and writes their labels. The app keeps one form state for all of them, and grows the form as you fill it in.</p>
      </header>

      <form className="ask">
        <input className="task" aria-label="What do you need?" value={state.task} placeholder="e.g. I left my work laptop on the train" />
        <button type="submit" disabled={busy || !state.task.trim()}>Build the form</button>
      </form>
      <div className="chips">
        {TASKS.map((t) => <button type="button" className="chip task-chip" data={{ task: t }} disabled={busy}>{t}</button>)}
      </div>

      {page.layout && (
        <form className="change">
          <input className="change-prompt" aria-label="Change the form" value={state.change} placeholder="Change it: “also ask for a phone number”, “drop the dates”" />
          <button type="submit" disabled={busy || !state.change.trim()}>Change</button>
        </form>
      )}

      <p className="status" aria-live="polite">{STATUS[page.status](page)}</p>

      {state.sent ? (
        <div className="sent">
          <h3>Sent</h3>
          <pre>{JSON.stringify(state.sent, null, 2)}</pre>
          <button type="button" className="again">File another</button>
        </div>
      ) : (page.layout || page.preview) && (
        <form className={page.preview ? 'intake preview' : 'intake'} noValidate>
          {catalog.render(page, state)}
          {pieces.length > 0 && (
            <div className="intake-actions">
              <button type="submit" disabled={busy}>Send</button>
              {state.intake.submitCount > 0 && invalid > 0 && <span className="error">Fill in the {invalid} highlighted field{invalid > 1 ? 's' : ''}.</span>}
            </div>
          )}
        </form>
      )}

      {pieces.length > 0 && (
        <aside className="explain">
          <h3>On this form</h3>
          <ul>
            {pieces.map((p) => (
              <li>
                <code>{p.key}</code> {Object.entries(p.params).map(([k, v]) => <span className="param">{k}: {String(v)}</span>)}
                <button type="button" className="remove-piece link" data={{ key: p.key }} aria-label={`Remove ${p.key}`}>remove</button>
              </li>
            ))}
          </ul>
          {state.adapted.length > 0 && (
            <>
              <h3>Added while you typed</h3>
              <ul>{state.adapted.map((id) => <li>{RULES.find((r) => r.id === id).why}</li>)}</ul>
            </>
          )}
          {modelPlan(page.decisions)}
        </aside>
      )}
    </section>
  )
}

IntakeLab.initialState = {
  task: '',
  change: '',
  adapted: [],
  sent: null,
}

IntakeLab.isolatedState = true

IntakeLab.uses = {
  page: compose(catalog, { backend: llm(), key: 'intake-compose' }),
  // the fields and the rules of what is on screen (the preview while the model writes)
  intake: form((state) => formSchema(shown(state.page)), { values: {}, dynamic: (state) => formFields(shown(state.page)), form: '.intake', submit: 'SEND' }),
}

IntakeLab.intent = ({ DOM, STATE }) => ({
  TASK: DOM.input('.task').value(),
  CHANGE_TEXT: DOM.input('.change-prompt').value(),
  BUILD: DOM.submit('.ask', { preventDefault: true }),
  PICK_TASK: DOM.click('.task-chip').data('task'),
  CHANGE: DOM.submit('.change', { preventDefault: true }),
  REMOVE_PIECE: DOM.click('.remove-piece').data('key'),
  AGAIN: DOM.click('.again'),
  // the form grows while it's filled in: each time the values or the layout change, the rule to apply
  ADAPT: STATE.watch(nextRule).filter(Boolean),
})

IntakeLab.model = {
  TASK: (state, task) => ({ ...state, task }),
  CHANGE_TEXT: (state, change) => ({ ...state, change }),

  // a new task: a new form, values cleared
  BUILD: {
    STATE: (state) => ({ ...state, adapted: [], sent: null }),
    EFFECT: (state, _, next) => {
      next('intake.RESET')
      next('page.COMPOSE', { prompt: formRequest(state.task), fresh: true })
    },
  },
  PICK_TASK: {
    STATE: (state, task) => ({ ...state, task, adapted: [], sent: null }),
    EFFECT: (state, task, next) => {
      next('intake.RESET')
      next('page.COMPOSE', { prompt: formRequest(task), fresh: true })
    },
  },

  // the person's own edit, in words: a follow-up of the current form
  CHANGE: {
    STATE: (state) => ({ ...state, change: '' }),
    EFFECT: (state, _, next, props) => next('page.COMPOSE', props.previousState.change),
  },
  REMOVE_PIECE: { EFFECT: (state, key, next) => next('page.REMOVE', key) },

  ADAPT: {
    STATE: (state, rule) => (state.adapted.includes(rule.id) ? ABORT : { ...state, adapted: [...state.adapted, rule.id] }),
    EFFECT: (state, rule, next) => next('page.COMPOSE', rule.prompt),
  },

  // a valid submit: the composed form's schema passed, values by node key
  SEND: (state, values) => {
    const fields = Object.fromEntries(placed(state.page.layout).map((p) => [p.key, p.params]))
    return { ...state, sent: { task: state.task, fields, values: summary(values) } }
  },
  AGAIN: {
    STATE: (state) => ({ ...state, sent: null, task: '', adapted: [] }),
    EFFECT: (state, _, next) => {
      next('intake.RESET')
      next('page.SET_LAYOUT', null)
    },
  },
}
