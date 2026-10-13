// The raw tool loop on the chat driver (the `chat` behavior runs this for you; here it is by hand).
// A request offers `tools`; each call the model makes arrives as a TOOL action before the reply
// ends, and the app runs it right there (a pure function, tools.js) and keeps the result by call
// id. DONE then writes the results into the message with `withToolResults` and, if there were
// calls, sends the conversation again with `continue: true`, so the next step grows the same
// assistant message. A turn stops at a reply without calls, at MAX_STEPS requests, or at Stop.
import { ABORT, classes } from 'sygnal'
import { messageText, withToolResults } from 'sygnal/ai'
import { modelOf } from '../../shared/providers.js'
import { providersResource, pickerState, pickerIntent, pickerModel, pickedModel, modelPicker } from '../../shared/picker.jsx'
import { TOOLS, runTool } from './tools.js'

const PICKER = { need: 'tools' }
const MAX_STEPS = 6

const INSTRUCTIONS = [
  'You are a kitchen and travel helper on a demo page.',
  'Use the tools for every number: convert_units for units, exchange_rate for money, calculate for any sum, difference, product or scaling (never do arithmetic yourself, not even adding two numbers).',
  'Call tools that don\'t depend on each other together in one reply; when a call needs another call\'s result, wait for that result first.',
  'Once the results are in, answer in at most 60 words, plain text, no Markdown.',
].join(' ')

const EXAMPLES = [
  'I have 2.5 lb of flour and 3 cups of sugar: how many grams in total?',
  'Bake at 350°F — what\'s that in Celsius, and what\'s €42 in USD?',
  'Dinner in Tokyo cost 18,400 yen, split between 3 people. How much each in GBP?',
]

const ICONS = { convert_units: '⚖️', exchange_rate: '💱', calculate: '🧮' }

/** the request for the conversation so far; after tool results the reply continues the assistant's message */
const ask = (state, messages) => ({
  model: pickedModel(state, PICKER),
  instructions: INSTRUCTIONS,
  messages,
  tools: TOOLS,
  key: 'reply',
  delta: 'DELTA',
  tool: 'TOOL',
  ok: 'DONE',
  error: 'FAILED',
  ...(messages.at(-1).role === 'assistant' && { continue: true }),
})

/** the reply with its calls answered from `results` (an Error result becomes `output-error`) */
const answered = (state, message) => withToolResults(message, (call) => {
  const r = state.results[call.id]
  return r && (r.ok ? r.output : new Error(r.error))
})

/** a continued message replaces itself (same id); a new one is appended */
const upsert = (messages, message) => (messages.at(-1)?.id === message.id ? [...messages.slice(0, -1), message] : [...messages, message])

/** token usage summed over a turn's requests */
const sum = (a, b) => (a && b ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens } : b ?? a)

const canSend = (state, text) => !!(text.trim() && pickedModel(state, PICKER) && state.status !== 'streaming')

// ---- the view ---------------------------------------------------------------------------

const compact = (v) => JSON.stringify(v)

function toolCard(part) {
  const name = part.type.slice('tool-'.length)
  const failed = part.state === 'output-error'
  return (
    <span className={classes('tool-card', { failed, running: part.state === 'input-available' })}>
      <span className="icon" aria-hidden="true">{ICONS[name] ?? '🔧'}</span>
      <code className="name">{name}</code>
      <code className="input">{compact(part.input)}</code>
      <span className="arrow" aria-hidden="true">→</span>
      <code className="output">{failed ? part.errorText : part.state === 'output-available' ? compact(part.output) : 'not run'}</code>
    </span>
  )
}

function bubble(m, { meta, streaming = false, waiting = false } = {}) {
  if (m.role === 'user') return <li className="msg user">{messageText(m)}</li>
  return (
    <li className={classes('msg', 'assistant', { streaming })}>
      {m.parts.map((p) => (p.type === 'text' ? <span className="text">{p.text}</span> : p.type.startsWith('tool-') ? toolCard(p) : null))}
      {waiting && <span className="thinking-dots"><i /><i /><i /></span>}
      {meta && (
        <span className="via">
          <code>{meta.model}</code> · {meta.steps} request{meta.steps === 1 ? '' : 's'}
          {meta.usage && ` · ${meta.usage.inputTokens} in / ${meta.usage.outputTokens} out`}
          {meta.stopped && ' · stopped'}
          {meta.limit && <b className="limit"> · stopped at the {MAX_STEPS}-request limit</b>}
        </span>
      )}
    </li>
  )
}

export default function KitchenHelper({ state }) {
  const busy = state.status === 'streaming'
  const model = pickedModel(state, PICKER)
  const last = state.messages.at(-1)
  // the turn's assistant message while it's in progress: what has streamed, else the step before
  const current = state.live ?? (busy && last?.role === 'assistant' ? last : null)
  return (
    <div className="w tools-demo">
      <div className="w-toolbar">
        {modelPicker(state, PICKER, { label: 'Model (calls tools)', disabled: busy })}
        <span className="grow" />
        <button type="button" className="btn ghost small clear" disabled={busy || state.messages.length === 0}>Clear</button>
      </div>

      <div className="layout">
        <section className="panel chat">
          <ol className="transcript" aria-live="polite">
            {state.messages.filter((m) => m !== current && m.id !== current?.id).map((m) => bubble(m, { meta: state.meta[m.id] }))}
            {busy && (current
              ? bubble(current, { streaming: !!state.live, waiting: !state.live })
              : <li className="msg assistant"><span className="thinking-dots"><i /><i /><i /></span></li>)}
          </ol>

          {state.messages.length === 0 && !busy && (
            <div className="examples">{EXAMPLES.map((e) => <button type="button" className="example" data={{ prompt: e }} disabled={!model}>{e}</button>)}</div>
          )}
          {busy && <p className="status-line"><span className="spinner" />Request {state.steps + 1} of at most {MAX_STEPS}{state.steps > 0 && ', with the tool results'}</p>}
          {state.error && <p className="status-line error" role="alert">{state.error}</p>}

          <form className="composer ask">
            <input className="prompt" aria-label="Message" placeholder={model ? 'Ask about a recipe, an oven, a currency…' : 'Pick a model first'} value={state.prompt} />
            {busy
              ? <button type="button" className="btn ghost stop">Stop</button>
              : <button type="submit" className="btn" disabled={!canSend(state, state.prompt)}>Send</button>}
          </form>
        </section>

        <aside className="panel offered">
          <p className="panel-title">Tools offered</p>
          <ul>
            {Object.entries(TOOLS).map(([name, t]) => (
              <li>
                <code>{ICONS[name]} {name}</code>
                <p>{t.description}</p>
                <small>{Object.keys(t.inputSchema.properties).map((k) => (t.inputSchema.required.includes(k) ? k : `${k}?`)).join(', ')}</small>
              </li>
            ))}
          </ul>
          <p className="note">Small local models sometimes chain dependent calls in one step; a capable model plans them better.</p>
        </aside>
      </div>
    </div>
  )
}

KitchenHelper.initialState = {
  ...pickerState,
  messages: [],
  prompt: '',
  status: 'ready',
  live: null,       // the assistant message as it streams (DELTA's `message`)
  results: {},      // tool results by call id: { ok: true, output } or { ok: false, error }
  steps: 0,         // requests sent in this turn
  meta: {},         // per assistant message: model, requests, summed token usage
  error: null,
}

KitchenHelper.resources = providersResource

KitchenHelper.intent = ({ DOM }) => ({
  ...pickerIntent(DOM),
  TYPE: DOM.input('.prompt').value(),
  SEND: DOM.select('.ask').events('submit', { preventDefault: true }),
  EXAMPLE: DOM.click('.example').data('prompt'),
  STOP: DOM.click('.stop'),
  CLEAR: DOM.click('.clear'),
})

/** the user's message starts a turn */
const sending = (pick) => ({
  STATE: (state, data) => {
    const text = pick(state, data)
    return canSend(state, text)
      ? { ...state, messages: [...state.messages, { id: `u${state.messages.length}`, role: 'user', content: text.trim() }], prompt: '', status: 'streaming', live: null, steps: 0, error: null }
      : ABORT
  },
  LLM: (state, data) => {
    const text = pick(state, data)
    return canSend(state, text) ? ask(state, [...state.messages, { role: 'user', content: text.trim() }]) : ABORT
  },
})

KitchenHelper.model = {
  ...pickerModel,
  TYPE: (state, prompt) => ({ ...state, prompt }),
  SEND: sending((state) => state.prompt),
  EXAMPLE: sending((state, prompt) => prompt),
  DELTA: (state, { message }) => ({ ...state, live: message }),

  // each call, as it arrives: run it now (the input is the model's, unchecked: runTool checks it)
  TOOL: (state, { call }) => {
    const out = runTool(call)
    const result = out instanceof Error ? { ok: false, error: out.message } : { ok: true, output: out }
    return { ...state, results: { ...state.results, [call.id]: result } }
  },

  // the step is done: answer its calls, and go again while there were calls and steps are left
  DONE: {
    STATE: (state, { message, toolCalls, usage }) => {
      const steps = state.steps + 1
      const again = toolCalls.length > 0 && steps < MAX_STEPS
      const reply = answered(state, message)
      const prev = state.meta[reply.id]
      return {
        ...state,
        messages: upsert(state.messages, reply),
        meta: { ...state.meta, [reply.id]: { model: modelOf(pickedModel(state, PICKER)), steps, usage: sum(prev?.usage, usage), limit: toolCalls.length > 0 && !again } },
        live: null,
        steps,
        status: again ? 'streaming' : 'ready',
      }
    },
    LLM: (state, { message, toolCalls }) => (toolCalls.length > 0 && state.steps + 1 < MAX_STEPS
      ? ask(state, upsert(state.messages, answered(state, message)))
      : ABORT),
  },

  // keep what streamed; nothing arrives after the abort
  STOP: {
    STATE: (state) => {
      const meta = { model: modelOf(pickedModel(state, PICKER)), steps: state.steps + 1, stopped: true }
      return state.live
        ? { ...state, messages: upsert(state.messages, state.live), meta: { ...state.meta, [state.live.id]: { ...state.meta[state.live.id], ...meta } }, live: null, status: 'ready' }
        : { ...state, live: null, status: 'ready' }
    },
    LLM: () => ({ abort: 'reply' }),
  },
  FAILED: (state, { error }) => ({ ...state, status: 'ready', live: null, error: error.body?.error?.message ?? error.body?.error ?? error.message }),
  CLEAR: (state) => ({ ...state, messages: [], meta: {}, results: {}, error: null }),
}
