// "What the model sees": the tools on offer and the app state, as the agent layer hands them to
// the chat behavior. `seen` is `{ tools, context }` from `agentTools(app)` (index.js), re-read after
// every render that changed either: watch UNLOCK and LOCK swap places as the door changes (`when`).
import { classes } from 'sygnal'

const HINTS = [
  ['readOnlyHint', 'read-only', 'ok'],
  ['consequentialHint', 'asks first', 'warn'],
  ['untrustedContentHint', 'user text', 'bad'],
]

/** a parameter's type, the short way: `"heat" | "cool" | "off"`, `number 16–28`, ... */
function typeOf(s) {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ')
  const range = s.minimum != null || s.maximum != null ? ` ${s.minimum ?? ''}–${s.maximum ?? ''}` : ''
  return `${s.type ?? 'any'}${range}`
}

function params(schema) {
  const props = Object.entries(schema?.properties ?? {})
  if (props.length === 0) return <p className="no-params">No arguments</p>
  const required = new Set(schema.required ?? [])
  return (
    <ul className="params">
      {props.map(([name, s]) => (
        <li>
          <code>{name}{required.has(name) ? '' : '?'}</code>: <span className="type">{typeOf(s)}</span>
          {s.description && <span className="param-desc">{s.description}</span>}
        </li>
      ))}
    </ul>
  )
}

function tool(t) {
  return (
    <li className="tool">
      <div className="tool-head">
        <code className="tool-name">{t.name}</code>
        {HINTS.filter(([hint]) => t.annotations?.[hint]).map(([, label, kind]) => <span className={classes('badge', kind)}>{label}</span>)}
      </div>
      <p className="tool-desc">{t.description}</p>
      {params(t.inputSchema)}
      <details className="schema">
        <summary>JSON Schema</summary>
        <pre className="json">{JSON.stringify(t.inputSchema, null, 2)}</pre>
      </details>
    </li>
  )
}

export function modelSees(seen, instructions) {
  return (
    <aside className="model-sees panel" aria-label="What the model sees">
      <h3 className="panel-title">What the model sees <span className="badge blue">{seen.tools.length} tools</span></h3>
      <details className="instructions">
        <summary>Instructions</summary>
        <p>{instructions}</p>
      </details>
      <ul className="tools">{seen.tools.map(tool)}</ul>
      <h4 className="sub-title">App state <small>sent before your last message, as data</small></h4>
      <pre className="json state">{JSON.stringify(seen.context, null, 2)}</pre>
    </aside>
  )
}
