// The view of `run_kindo_agent`: an MCP App. The host (Claude, ChatGPT, VS Code, ...) shows it in
// the conversation when the model calls the tool, and the MCP driver is the bridge: the tool's
// input and result arrive as actions, and the view calls the server's app-only tools
// ({ callTool }) to read an agent, start a run and follow it.
//
// The model fills in the inputs from the conversation; the user reviews them and presses Run. A
// run is followed with a long poll (kindo_wait_run answers when the status or a step changes),
// and a one-second timer keeps the elapsed time live. When the run ends, the model is told
// (updateModelContext, for hosts that pass it on; get_agent_run for the others).
import { ABORT, classes } from 'sygnal'
import { markdown } from './markdown.jsx'

const STEP_ICON = { pass: '✓', fail: '✕', not_evaluated: '–', unknown: '?', pending: '…' }
const RUN_LABEL = { in_progress: 'Running', success: 'Succeeded', failure: 'Failed', cancelled: 'Cancelled' }

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const elapsed = (state) => {
  const run = state.run
  if (!run?.createdAtUtc) return null
  const end = run.endedAtUtc ? Date.parse(run.endedAtUtc) : state.now
  return end ? clock(end - Date.parse(run.createdAtUtc)) : null
}

const nameOf = (a) => a.name || `Untitled agent (${a.agentId.slice(0, 8)})`

/** the agents whose name or description has every word of the search (the picked one always stays) */
function matching(state) {
  const words = state.search.toLowerCase().split(/\s+/).filter(Boolean)
  return state.agents.filter((a) => a.agentId === state.agentId
    || words.every((w) => `${a.name} ${a.description}`.toLowerCase().includes(w)))
}

function agentPicker(state) {
  const busy = state.phase === 'starting' || state.phase === 'running'
  const shown = matching(state)
  return (
    <div className="agent-picker">
      <span>Agent</span>
      <div className="picker-row">
        {state.agents.length > 12 && (
          <input className="agent-search" type="search" aria-label="Search agents" placeholder={`Search ${state.agents.length} agents…`} value={state.search} disabled={busy} />
        )}
        <select className="agent-pick" aria-label="Agent" disabled={busy}>
          {!state.agent && <option value="">{shown.length ? `Pick an agent (${shown.length})…` : 'No agent matches'}</option>}
          {shown.map((a) => <option value={a.agentId} selected={a.agentId === state.agentId}>{nameOf(a)}</option>)}
        </select>
      </div>
    </div>
  )
}

function form(state) {
  const a = state.agent
  const locked = state.phase !== 'idle'
  return (
    <form className="inputs run-form">
      {a.inputs.length === 0 && <p className="muted">This agent takes no inputs.</p>}
      {a.inputs.map((name) => (
        <label className="field">
          <span>{name}</span>
          <textarea className="value" rows="2" data={{ name }} disabled={locked} value={state.values[name] ?? ''} />
        </label>
      ))}
      {state.phase === 'idle' && (
        <div className="row">
          <button type="submit" className="primary run">Run agent</button>
          {state.prefilled && <span className="muted small">Inputs filled in by the model: check them first.</span>}
        </div>
      )}
    </form>
  )
}

function runPanel(state) {
  const run = state.run
  const status = run?.status ?? 'starting'
  return (
    <section className={classes('run', status)} aria-live="polite">
      <header className="run-head">
        <span className={classes('pill', status)}>
          {status === 'in_progress' || status === 'starting' ? <i className="spin" /> : null}
          {RUN_LABEL[status] ?? 'Starting…'}
        </span>
        {elapsed(state) && <span className="elapsed">{elapsed(state)}</span>}
        {run?.runId && <code className="run-id" title="Run id">{run.runId}</code>}
      </header>
      {status === 'in_progress' && <div className="progress"><i /></div>}

      {state.steps.length > 0 && (
        <ol className="steps">
          {state.steps.map((s) => (
            <li className={classes('step', s.result ?? 'pending')}>
              <span className="mark">{STEP_ICON[s.result ?? 'pending'] ?? '•'}</span>
              <span className="name">{s.name ?? `Step ${s.stepNumber}`}</span>
              {s.explanation && <span className="why">{s.explanation}</span>}
            </li>
          ))}
        </ol>
      )}

      {state.text && <article className="result">{markdown(state.text)}</article>}
      {status === 'success' && !state.text && <p className="muted">The run finished without a message.</p>}

      {run && status !== 'in_progress' && (
        <footer className="row">
          {status === 'success' && <button type="button" className="primary discuss">Discuss with Claude</button>}
          <button type="button" className="restart">Run again</button>
          <button type="button" className="new-run">New inputs</button>
        </footer>
      )}
    </section>
  )
}

function App({ state }) {
  return (
    <main className={classes('card', state.theme)}>
      <header className="card-head">
        <div className="brand"><b>Kindo</b> agent runner</div>
        {state.canFullscreen && state.mode !== 'fullscreen' && <button type="button" className="ghost fullscreen" aria-label="Full screen">⤢</button>}
      </header>

      {state.status === 'waiting' && <p className="muted">Waiting for the tool call…</p>}
      {state.status === 'loading' && <p className="muted"><i className="spin" /> Loading your agents…</p>}
      {state.error && <p className="error" role="alert">{state.error}</p>}

      {state.agents.length > 0 && agentPicker(state)}
      {state.agentId && !state.agent && <p className="muted"><i className="spin" /> Reading the agent…</p>}
      {state.agent && <p className="description">{state.agent.description || 'No description.'}</p>}
      {state.agent && form(state)}
      {state.phase !== 'idle' && runPanel(state)}
    </main>
  )
}

App.initialState = {
  status: 'waiting',   // waiting for the tool call → loading → ready
  agents: [],
  search: '',          // filters the agent picker
  agentId: null,
  agent: null,         // { agentId, name, description, inputs: [label] }
  values: {},          // the inputs by label
  prefilled: false,    // the model filled some in
  phase: 'idle',       // idle → starting → running → done
  run: null,           // { runId, status, createdAtUtc, endedAtUtc }
  steps: [],           // step evaluations, when the agent has step objectives
  text: '',            // the run's final message
  seen: null,          // what kindo_wait_run last saw (it answers when that changes)
  now: null,           // the clock, for the elapsed time
  error: '',
  theme: 'light',
  mode: 'inline',
  canFullscreen: false,
}

App.intent = ({ DOM, MCP }) => ({
  INPUT: MCP.select('tool-input'),
  RESULT: MCP.select('tool-result'),
  CANCELLED: MCP.select('tool-cancelled'),
  HOST: MCP.select('host-context-changed'),
  SEARCH: DOM.input('.agent-search').value(),
  PICK: DOM.change('.agent-pick').value(),
  VALUE: DOM.input('.value').map((e) => ({ name: e.target.dataset.name, value: e.target.value })),
  RUN: DOM.select('.run-form').events('submit', { preventDefault: true }),
  RESTART: DOM.click('.restart'),
  NEW_RUN: DOM.click('.new-run'),
  DISCUSS: DOM.click('.discuss'),
  FULLSCREEN: DOM.click('.fullscreen'),
})

// a one-second tick while a run is in progress: the elapsed time stays live between polls
App.timers = (state) => ({
  clock: state.phase === 'running' && { every: 1000, action: 'TICK' },
})

const textOf = (result) => result.content?.map((c) => c.text).filter(Boolean).join('\n') || 'The tool failed'

/** the agent's inputs, with the values the model gave where their labels match */
const valuesFor = (agent, given = {}) => Object.fromEntries((agent?.inputs ?? []).map((name) => [name, given[name] ?? '']))

const wait = (runId, seen) => ({ callTool: 'kindo_wait_run', args: { runId, ...(seen && { seen }) }, ok: 'PROGRESS', error: 'FAILED' })

App.model = {
  INPUT: (state) => ({ ...state, status: 'loading', error: '' }),
  RESULT: (state, result) => {
    if (result.isError) return { ...state, status: 'ready', error: textOf(result) }
    const { agents = [], agent = null, inputs = {} } = result.structuredContent ?? {}
    const values = valuesFor(agent, inputs)
    return { ...state, status: 'ready', agents, agent, agentId: agent?.agentId ?? null, values, prefilled: Object.values(values).some(Boolean) }
  },
  CANCELLED: (state) => ({ ...state, status: 'ready', error: 'The tool call was cancelled.' }),
  HOST: (state, context) => ({
    ...state,
    theme: context.theme ?? state.theme,
    mode: context.displayMode ?? state.mode,
    canFullscreen: (context.availableDisplayModes ?? []).includes('fullscreen'),
  }),

  // another agent: read its inputs from the server
  PICK: {
    STATE: (state, agentId) => (agentId ? { ...state, agentId, agent: null, error: '' } : ABORT),
    MCP: (state, agentId) => (agentId ? { callTool: 'kindo_agent', args: { agentId }, ok: 'AGENT', error: 'FAILED' } : ABORT),
  },
  AGENT: (state, result) => (result.isError
    ? { ...state, error: textOf(result) }
    : { ...state, agent: result.structuredContent.agent, values: valuesFor(result.structuredContent.agent, state.values), prefilled: false }),
  SEARCH: (state, search) => ({ ...state, search }),
  VALUE: (state, { name, value }) => ({ ...state, values: { ...state.values, [name]: value } }),

  RUN: {
    STATE: (state) => (state.agent ? { ...state, phase: 'starting', run: null, steps: [], text: '', seen: null, error: '' } : ABORT),
    MCP: (state) => (state.agent
      ? {
          callTool: 'kindo_start_run',
          args: { agentId: state.agent.agentId, agentName: state.agent.name, inputs: state.agent.inputs.map((name) => ({ name, value: state.values[name] ?? '' })) },
          ok: 'STARTED',
          error: 'FAILED',
        }
      : ABORT),
  },
  RESTART: {
    STATE: (state) => ({ ...state, phase: 'starting', steps: [], text: '', seen: null, error: '' }),
    MCP: (state) => ({ callTool: 'kindo_restart_run', args: { runId: state.run.runId }, ok: 'STARTED', error: 'FAILED' }),
  },
  STARTED: {
    STATE: (state, result) => (result.isError
      ? { ...state, phase: 'idle', error: textOf(result) }
      : { ...state, phase: 'running', run: { runId: result.structuredContent.runId, status: 'in_progress' } }),
    MCP: (state, result) => (result.isError ? ABORT : wait(result.structuredContent.runId)),
  },
  // the long poll answered: show it, and wait again while the run is in progress
  PROGRESS: {
    STATE: (state, result) => {
      if (result.isError) return { ...state, phase: 'done', error: textOf(result) }
      const { run, steps, text, seen, now } = result.structuredContent
      return { ...state, run, steps, text, seen, now: Date.parse(now), phase: run.status === 'in_progress' ? 'running' : 'done' }
    },
    MCP: (state, result) => {
      if (result.isError) return ABORT
      const { run, text } = result.structuredContent
      if (run.status === 'in_progress') return wait(run.runId, result.structuredContent.seen)
      // the run ended: tell the model, for hosts that add model context to the next turn
      return { updateModelContext: { content: textOf(result), structuredContent: { runId: run.runId, status: run.status, agent: state.agent?.name, text } } }
    },
  },
  TICK: (state, { t }) => ({ ...state, now: t }),
  NEW_RUN: (state) => ({ ...state, phase: 'idle', run: null, steps: [], text: '', error: '' }),
  // a message to the conversation as the user; the model reads the result with get_agent_run
  DISCUSS: { MCP: (state) => ({ message: `What did the ${state.agent?.name ?? 'Kindo'} agent run find? Summarize the result and suggest next steps.` }) },
  FAILED: (state, { error }) => ({ ...state, phase: state.run ? 'done' : 'idle', error: typeof error === 'string' ? error : error?.message ?? 'The request failed' }),
  FULLSCREEN: { MCP: () => ({ displayMode: 'fullscreen', ok: 'MODE' }) },
  MODE: (state, { mode }) => ({ ...state, mode }),
}

export default App
