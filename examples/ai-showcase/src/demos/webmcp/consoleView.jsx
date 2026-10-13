// The agent console: what the app has registered with WebMCP right now (the WEBMCP source), and a
// form to call one tool the way the browser's agent would (the AGENT_CALL driver). A plain view
// function, so its selectors (.tool-item, .call-form, .args) are in the host's own view.
import { classes } from 'sygnal'

const HINTS = [
  ['readOnlyHint', 'read-only', 'ok'],
  ['consequentialHint', 'consequential', 'warn'],
  ['untrustedContentHint', 'untrusted', 'bad'],
]

const LOG = { registered: '+', unregistered: '−', updated: '↻' }

function badges(tool) {
  return [
    ...HINTS.filter(([hint]) => tool.annotations?.[hint]).map(([, label, kind]) => <span className={classes('badge', kind)}>{label}</span>),
    tool.form && <span className="badge blue">form{tool.autosubmit ? '' : ' · you submit'}</span>,
  ]
}

function params(schema) {
  const props = Object.entries(schema?.properties ?? {})
  if (props.length === 0) return <p className="no-params">No arguments</p>
  return (
    <ul className="params">
      {props.map(([name, s]) => (
        <li>
          <code>{name}</code>: <span className="type">{s.enum ? s.enum.map((v) => JSON.stringify(v)).join(' | ') : s.type}</span>
          {s.description && <span className="param-desc">{s.description}</span>}
        </li>
      ))}
    </ul>
  )
}

function callPanel(state, tool) {
  const { call } = state
  if (!state.picked) return <p className="pick-hint">Pick a tool to call it the way an agent would.</p>
  if (!tool) return <p className="pick-hint"><code>{state.picked}</code> isn't registered now (its <code>when</code> is false, or its component left the page).</p>
  return (
    <div className="call-panel">
      <div className="tool-head"><code className="tool-name">{tool.name}</code>{badges(tool)}</div>
      <p className="tool-desc">{tool.description}</p>
      {params(tool.inputSchema)}
      <details className="schema">
        <summary>Input schema</summary>
        <pre className="json">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
      </details>
      <form className="call-form">
        <label className="args-label">Arguments (JSON)
          <textarea className="args" rows="4" spellcheck="false" value={state.args} />
        </label>
        <button type="submit" className="btn small">Call as agent</button>
      </form>
      {call.status === 'calling' && (
        <p className="status-line">
          <span className="spinner" />
          {tool.form && !tool.autosubmit ? 'The fields are filled in: press Add book to submit, and the agent gets the answer.' : 'Calling…'}
        </p>
      )}
      {call.error && <p className="status-line error" role="alert">{call.error}</p>}
      {call.status === 'done' && (
        <div className="result">
          <span className={classes('badge', call.result?.ok ? 'ok' : 'bad')}>{call.result?.ok ? 'ok' : 'failed'}</span>
          <pre className="json">{JSON.stringify(call.result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

export function consoleView(state) {
  const { native, tools, log } = state.webmcp
  const picked = tools.find((t) => t.name === state.picked)
  return (
    <section className="panel agent-console" aria-label="Agent console">
      <h3 className="panel-title">
        Agent console
        <span className={classes('badge', native ? 'ok' : 'warn')}>
          {native ? 'Native WebMCP: available' : 'Native WebMCP: not in this browser (tools are recorded here only)'}
        </span>
      </h3>
      <div className="console-grid">
        <div className="registered">
          <h4 className="sub-title">Registered <small>{tools.length} tools</small></h4>
          <ul className="tool-list">
            {tools.map((t) => (
              <li>
                <button type="button" className={classes('tool-item', { picked: t.name === state.picked })} aria-pressed={t.name === state.picked ? 'true' : 'false'} data={{ tool: t.name }}>
                  <span className="tool-head"><code className="tool-name">{t.name}</code>{badges(t)}</span>
                  <span className="tool-desc">{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <h4 className="sub-title">Changes</h4>
          <ol className="reg-log">
            {log.map((e) => <li className={e.op}><span className="op" aria-hidden="true">{LOG[e.op]}</span> <code>{e.name}</code> {e.op}</li>)}
          </ol>
        </div>
        {callPanel(state, picked)}
      </div>
    </section>
  )
}
