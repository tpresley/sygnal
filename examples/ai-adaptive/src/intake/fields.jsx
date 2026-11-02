// The field pieces an intake form is composed from. Each is a view function (a catalog part with
// `render`, not `component`): it renders inline in the host's view, inside the host's
// <form className="intake">, so the host's `form` behavior hears its inputs by `name` like any
// field the host wrote itself. (A part declared with `component` is an isolated child: the form
// behavior would not see the fields inside it, and its values would need a lens of their own.)
//
// Each one gets the host's state, its params and its node key (`node`) as props. Its values live
// under its node key (the form's `dynamic` fields, catalog.jsx): one value named `<node>`, or
// several named `<node>.<field>`, so a piece can repeat ('amount', 'amount~2'). The value and the
// message to show are in state.intake.fields[name] (the message: the composed form's schema).
import { PEOPLE } from './data.js'

/** a field's message to show */
const errorOf = (state, name) => state.intake.fields[name]?.error ?? ''

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

/** a field's value (a field that isn't on the form yet, while the preview streams: empty) */
const value = (state, name) => state.intake.fields[name]?.value ?? ''

export function Contact({ state, node, phone }) {
  return (
    <div className="piece">
      {field(state, `${node}.email`, 'Email', <input type="email" name={`${node}.email`} value={value(state, `${node}.email`)} autocomplete="email" />)}
      {phone !== 'none' && field(state, `${node}.phone`, phone === 'required' ? 'Phone' : 'Phone (optional)', <input type="tel" name={`${node}.phone`} value={value(state, `${node}.phone`)} autocomplete="tel" />)}
    </div>
  )
}

export function Dates({ state, node, mode, label }) {
  const date = (name, text) => field(state, `${node}.${name}`, text, <input type="date" name={`${node}.${name}`} value={value(state, `${node}.${name}`)} />)
  if (mode === 'range') {
    return (
      <fieldset className="piece inline">
        <legend>{label}</legend>
        {date('start', 'From')}
        {date('end', 'To')}
      </fieldset>
    )
  }
  return <div className="piece">{date('start', label)}</div>
}

export function Amount({ state, node, label }) {
  return (
    <div className="piece inline">
      {field(state, `${node}.amount`, label, <input type="number" name={`${node}.amount`} min="0" step="0.01" value={value(state, `${node}.amount`)} />)}
      {field(state, `${node}.currency`, 'Currency', <select name={`${node}.currency`}>
          {['USD', 'EUR', 'GBP', 'JPY'].map((c) => <option value={c} selected={value(state, `${node}.currency`) === c}>{c}</option>)}
        </select>)}
    </div>
  )
}

export function Device({ state, node }) {
  const kind = `${node}.kind`, tag = `${node}.assetTag`
  return (
    <div className="piece inline">
      {field(state, kind, 'Device', <select name={kind}>
          <option value="" selected={!value(state, kind)}>Choose…</option>
          {['laptop', 'phone', 'monitor', 'headset', 'other'].map((d) => <option value={d} selected={value(state, kind) === d}>{d}</option>)}
        </select>)}
      {field(state, tag, 'Asset tag', <input name={tag} value={value(state, tag)} />, "On the sticker, e.g. AT-10442")}
    </div>
  )
}

export function Place({ state, node, label }) {
  return (
    <div className="piece">
      {field(state, node, label, <input name={node} value={value(state, node)} />)}
    </div>
  )
}

export function Details({ state, node, question }) {
  return (
    <div className="piece">
      {field(state, node, question, <textarea name={node} rows="3" value={value(state, node)} />)}
    </div>
  )
}

export function Urgency({ state, node }) {
  const current = value(state, node), error = errorOf(state, node)
  return (
    <fieldset className={error ? 'piece radios invalid' : 'piece radios'}>
      <legend>How urgent is it?</legend>
      {[['low', 'Whenever'], ['normal', 'This week'], ['critical', 'Today — it blocks work']].map(([v, text]) => (
        <label><input type="radio" name={node} value={v} checked={current === v} /> {text}</label>
      ))}
      {error && <span className="error" role="alert">{error}</span>}
    </fieldset>
  )
}

export function Approver({ state, node }) {
  return (
    <div className="piece">
      {field(state, node, 'Approver', <select name={node}>
          <option value="" selected={!value(state, node)}>Choose…</option>
          {PEOPLE.map((p) => <option value={p.id} selected={value(state, node) === p.id}>{p.name} — {p.role}</option>)}
        </select>, "Your manager, or whoever signs off")}
    </div>
  )
}

export function Attachments({ state, node, label }) {
  return (
    <div className="piece">
      {/* a file input can't be cleared from state: keyed by the form's reset count */}
      {field(state, node, label, <input type="file" name={node} multiple key={node + state.intake.resets} />)}
    </div>
  )
}

export function Consent({ state, node, statement }) {
  const error = errorOf(state, node)
  return (
    <div className={error ? 'piece consent invalid' : 'piece consent'}>
      <label><input type="checkbox" name={node} checked={!!value(state, node)} /> {statement}</label>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  )
}

/** A question the model wrote itself (it may ask up to three: 'question', 'question~2', …) */
export function Question({ state, node, label, answer }) {
  const current = value(state, node), error = errorOf(state, node)
  if (answer === 'yesno') {
    return (
      <fieldset className="piece radios">
        <legend>{label}</legend>
        <label><input type="radio" name={node} value="yes" checked={current === 'yes'} /> Yes</label>
        <label><input type="radio" name={node} value="no" checked={current === 'no'} /> No</label>
        {error && <span className="error" role="alert">{error}</span>}
      </fieldset>
    )
  }
  return (
    <div className="piece">
      {field(state, node, label, answer === 'long' ? <textarea name={node} rows="3" value={current} /> : <input name={node} value={current} />)}
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
