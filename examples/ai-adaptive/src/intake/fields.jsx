// The field pieces an intake form is composed from. Each is a view function (a catalog part with
// `render`, not `component`): it renders inline in the host's view, inside the host's
// <form className="intake">, so the host's `form` behavior hears its inputs by `name` like any
// field the host wrote itself. (A part declared with `component` is an isolated child: the form
// behavior would not see the fields inside it, and its values would need a lens of their own.)
//
// Each one gets the host's state and its params as props. The values are in state.intake.values,
// the messages to show in state.intake.fields[name].error, plus the app's own "required" check for
// fields that are on the page (state.missing).
import { PEOPLE } from './data.js'

/** a field's message: the schema's (form behavior), else the app's own required check */
const errorOf = (state, name) => state.intake.fields[name]?.error || (state.missing.includes(name) ? 'Required' : '')

/**
 * A labelled field with its message. A view helper, called as a function: as a capitalized JSX tag
 * (<Field>) it would be a child component of its own.
 */
function field(state, name, label, control, hint) {
  const error = errorOf(state, name)
  return (
    <div className={error ? 'field invalid' : 'field'}>
      <label>
        <span className="label">{label}</span>
        {control}
      </label>
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  )
}

const value = (state, name) => state.intake.values[name] ?? ''

export function Contact({ state, phone }) {
  return (
    <div className="piece">
      {field(state, 'email', 'Email', <input type="email" name="email" value={value(state, 'email')} autocomplete="email" />)}
      {phone !== 'none' && field(state, 'phone', phone === 'required' ? 'Phone' : 'Phone (optional)', <input type="tel" name="phone" value={value(state, 'phone')} autocomplete="tel" />)}
    </div>
  )
}

export function Dates({ state, mode, label }) {
  if (mode === 'range') {
    return (
      <fieldset className="piece inline">
        <legend>{label}</legend>
        {field(state, 'start', 'From', <input type="date" name="start" value={value(state, 'start')} />)}
        {field(state, 'end', 'To', <input type="date" name="end" value={value(state, 'end')} />)}
      </fieldset>
    )
  }
  return (
    <div className="piece">
      {field(state, 'start', label, <input type="date" name="start" value={value(state, 'start')} />)}
    </div>
  )
}

export function Amount({ state, label }) {
  return (
    <div className="piece inline">
      {field(state, 'amount', label, <input type="number" name="amount" min="0" step="0.01" value={value(state, 'amount')} />)}
      {field(state, 'currency', 'Currency', <select name="currency">
          {['USD', 'EUR', 'GBP', 'JPY'].map((c) => <option value={c} selected={value(state, 'currency') === c}>{c}</option>)}
        </select>)}
    </div>
  )
}

export function Device({ state }) {
  return (
    <div className="piece inline">
      {field(state, 'device', 'Device', <select name="device">
          <option value="" selected={!value(state, 'device')}>Choose…</option>
          {['laptop', 'phone', 'monitor', 'headset', 'other'].map((d) => <option value={d} selected={value(state, 'device') === d}>{d}</option>)}
        </select>)}
      {field(state, 'assetTag', 'Asset tag', <input name="assetTag" value={value(state, 'assetTag')} />, "On the sticker, e.g. AT-10442")}
    </div>
  )
}

export function Place({ state, label }) {
  return (
    <div className="piece">
      {field(state, 'place', label, <input name="place" value={value(state, 'place')} />)}
    </div>
  )
}

export function Details({ state, question }) {
  return (
    <div className="piece">
      {field(state, 'details', question, <textarea name="details" rows="3" value={value(state, 'details')} />)}
    </div>
  )
}

export function Urgency({ state }) {
  const current = value(state, 'urgency')
  return (
    <fieldset className={errorOf(state, 'urgency') ? 'piece radios invalid' : 'piece radios'}>
      <legend>How urgent is it?</legend>
      {[['low', 'Whenever'], ['normal', 'This week'], ['critical', 'Today — it blocks work']].map(([v, text]) => (
        <label><input type="radio" name="urgency" value={v} checked={current === v} /> {text}</label>
      ))}
      {errorOf(state, 'urgency') && <span className="error" role="alert">{errorOf(state, 'urgency')}</span>}
    </fieldset>
  )
}

export function Approver({ state }) {
  return (
    <div className="piece">
      {field(state, 'approver', 'Approver', <select name="approver">
          <option value="" selected={!value(state, 'approver')}>Choose…</option>
          {PEOPLE.map((p) => <option value={p.id} selected={value(state, 'approver') === p.id}>{p.name} — {p.role}</option>)}
        </select>, "Your manager, or whoever signs off")}
    </div>
  )
}

export function Attachments({ state, label }) {
  return (
    <div className="piece">
      {/* a file input can't be cleared from state: keyed by the form's reset count */}
      {field(state, 'attachments', label, <input type="file" name="attachments" multiple key={'attachments' + state.intake.resets} />)}
    </div>
  )
}

export function Consent({ state, statement }) {
  return (
    <div className={errorOf(state, 'consent') ? 'piece consent invalid' : 'piece consent'}>
      <label><input type="checkbox" name="consent" checked={!!state.intake.values.consent} /> {statement}</label>
      {errorOf(state, 'consent') && <span className="error" role="alert">{errorOf(state, 'consent')}</span>}
    </div>
  )
}

/**
 * A question the model wrote itself. Its value lives under `extra.<node key>` ("question",
 * "question~2", …): the node key is the only identity a repeated part has.
 */
export function Question({ state, node, label, answer }) {
  const name = `extra.${node}`
  const current = state.intake.values.extra?.[node] ?? ''
  if (answer === 'yesno') {
    return (
      <fieldset className="piece radios">
        <legend>{label}</legend>
        <label><input type="radio" name={name} value="yes" checked={current === 'yes'} /> Yes</label>
        <label><input type="radio" name={name} value="no" checked={current === 'no'} /> No</label>
        {errorOf(state, name) && <span className="error" role="alert">{errorOf(state, name)}</span>}
      </fieldset>
    )
  }
  return (
    <div className="piece">
      {field(state, name, label, answer === 'long' ? <textarea name={name} rows="3" value={current} /> : <input name={name} value={current} />)}
    </div>
  )
}

/** the `section` container: a titled fieldset around its parts */
export function Section({ params, slots }) {
  return (
    <fieldset className="section">
      <legend>{params.title}</legend>
      {slots.default}
    </fieldset>
  )
}
