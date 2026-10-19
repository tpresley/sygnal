// One chat component, any model. The request goes to the LLM driver; the reply streams back as
// actions: DELTA while it streams (text and reasoning so far), DONE with the finished message and
// its token usage, FAILED on an error. STOP aborts by key: nothing arrives after an abort.
//
// The picked model is `route::model` (shared/providers.js): the driver's routed transport sends
// it to Ollama, to Kindo as Open Responses, Chat Completions or Anthropic Messages, or to
// Chrome's on-device model. Nothing here knows which.
import { ABORT, classes } from 'sygnal'
import { messageText } from 'sygnal/ai'
import { ROUTES, routeOf, modelOf } from '../../shared/providers.js'
import { providersResource, pickerState, pickerIntent, pickerModel, pickedModel, modelPicker } from '../../shared/picker.jsx'

const EXAMPLES = [
  'Explain Model-View-Intent in two sentences.',
  'Write a haiku about streaming tokens.',
  'Is 9.11 bigger than 9.9? Think it through.',
]

const INSTRUCTIONS = 'You are a concise assistant on a demo page. Answer in at most 120 words. No Markdown headings.'

/** which models to offer: every chat model, Kindo in all three wire formats, Chrome when it can run */
const picker = (state) => ({ need: 'chat', kindoRoutes: ['kindo', 'kindo-cc', 'kindo-msg'], chrome: state.chrome === 'available' })

/** the request for the conversation so far */
function ask(state, messages) {
  const model = pickedModel(state, picker(state))
  const think = state.think && ['ollama', 'kindo'].includes(routeOf(model))
  return {
    model,
    instructions: INSTRUCTIONS,
    messages,
    key: 'reply',
    delta: 'DELTA',
    ok: 'DONE',
    error: 'FAILED',
    // per-request transport options: ask for reasoning (Open Responses' `reasoning`)
    ...(think && { body: { reasoning: { effort: 'medium' } } }),
  }
}

const send = (state, text) => (text.trim() && pickedModel(state, picker(state)) && state.status !== 'streaming' ? text.trim() : null)

function message(m, meta) {
  const reasoning = m.parts?.filter((p) => p.type === 'reasoning').map((p) => p.text).join('')
  const info = meta[m.id]
  return (
    <li className={classes('msg', m.role)}>
      {reasoning && <details className="reasoning"><summary>Reasoning</summary>{reasoning}</details>}
      {messageText(m)}
      {info && (
        <span className="via">
          <code>{info.model}</code> · {info.wire}
          {info.usage?.outputTokens != null && ` · ${info.usage.inputTokens ?? '?'} in / ${info.usage.outputTokens} out`}
          {info.stopped && ' · stopped'}
        </span>
      )}
    </li>
  )
}

export default function AnyModel({ state }) {
  const busy = state.status === 'streaming'
  const model = pickedModel(state, picker(state))
  const route = ROUTES[routeOf(model)]
  return (
    <div className="w any-model">
      <div className="w-toolbar">
        {modelPicker(state, picker(state), { disabled: busy })}
        <label className="switch" title="Ask for reasoning (Ollama and Kindo Open Responses)">
          <input type="checkbox" className="think" checked={state.think} disabled={busy || !['ollama', 'kindo'].includes(routeOf(model))} />
          Thinking
        </label>
        <span className="grow" />
        {route && <span className="badge blue" title="The transport this request goes through">{route.label} · {route.wire}</span>}
        <button type="button" className="btn ghost small clear" disabled={busy || state.messages.length === 0}>Clear</button>
      </div>

      <ol className="transcript" aria-live="polite">
        {state.messages.map((m) => message(m, state.meta))}
        {busy && (
          <li className={classes('msg', 'assistant', { streaming: !!state.draft })}>
            {state.reasoning && <details className="reasoning" open={!state.draft}><summary>Reasoning…</summary>{state.reasoning}</details>}
            {state.draft || (!state.reasoning && <span className="thinking-dots"><i /><i /><i /></span>)}
          </li>
        )}
      </ol>

      {state.messages.length === 0 && !busy && (
        <div className="examples">{EXAMPLES.map((e) => <button type="button" className="example" data={{ prompt: e }} disabled={!model}>{e}</button>)}</div>
      )}
      {state.error && <p className="status-line error" role="alert">{state.error}</p>}

      <form className="composer ask">
        <input className="prompt" aria-label="Message" placeholder={model ? `Message ${modelOf(model) || route?.label}…` : 'Pick a model first'} value={state.prompt} />
        {busy
          ? <button type="button" className="btn ghost stop">Stop</button>
          : <button type="submit" className="btn" disabled={!state.prompt.trim() || !model}>Send</button>}
      </form>
    </div>
  )
}

AnyModel.initialState = {
  ...pickerState,
  chrome: null,      // Chrome's Prompt API: 'available', 'downloadable', 'unavailable', ...
  think: false,
  messages: [],
  meta: {},          // per reply: which model and wire format answered, its token usage
  prompt: '',
  draft: '',
  reasoning: '',
  status: 'ready',
  error: null,
}

AnyModel.resources = providersResource

AnyModel.intent = ({ DOM }) => ({
  ...pickerIntent(DOM),
  TYPE: DOM.input('.prompt').value(),
  SEND: DOM.select('.ask').events('submit', { preventDefault: true }),
  EXAMPLE: DOM.click('.example').data('prompt'),
  STOP: DOM.click('.stop'),
  THINK: DOM.change('.think').map((e) => e.target.checked),
  CLEAR: DOM.click('.clear'),
})

/** the user's message goes into the conversation, and the conversation to the model */
const sending = (pick) => ({
  STATE: (state, data) => {
    const text = send(state, pick(state, data))
    return text ? { ...state, messages: [...state.messages, { id: `u${state.messages.length}`, role: 'user', content: text }], prompt: '', status: 'streaming', draft: '', reasoning: '', error: null } : ABORT
  },
  // after mode reads the message STATE stored; previousState keeps the send guard
  LLM: (state, data, next, { previousState }) => {
    const text = send(previousState, pick(previousState, data))
    return text ? ask(state, state.messages) : ABORT
  },
})

AnyModel.model = {
  ...pickerModel,
  BOOTSTRAP: { CHROME: () => ({ ok: 'CHROME_STATUS' }) },
  CHROME_STATUS: (state, chrome) => ({ ...state, chrome }),
  TYPE: (state, prompt) => ({ ...state, prompt }),
  THINK: (state, think) => ({ ...state, think }),
  SEND: sending((state) => state.prompt),
  EXAMPLE: sending((state, prompt) => prompt),
  DELTA: (state, { text, reasoning }) => ({ ...state, draft: text, reasoning }),
  DONE: (state, { message, usage }) => {
    const model = pickedModel(state, picker(state))
    return {
      ...state,
      messages: [...state.messages, message],
      meta: { ...state.meta, [message.id]: { model: modelOf(model) || ROUTES[routeOf(model)].label, wire: ROUTES[routeOf(model)].wire, usage } },
      status: 'ready', draft: '', reasoning: '',
    }
  },
  // keep what arrived; nothing arrives after the abort
  STOP: {
    STATE: (state) => {
      if (!state.draft) return { ...state, status: 'ready', reasoning: '' }
      const id = `stopped${state.messages.length}`
      const model = pickedModel(state, picker(state))
      return {
        ...state,
        messages: [...state.messages, { id, role: 'assistant', parts: [{ type: 'text', text: state.draft }] }],
        meta: { ...state.meta, [id]: { model: modelOf(model) || ROUTES[routeOf(model)].label, wire: ROUTES[routeOf(model)].wire, stopped: true } },
        status: 'ready', draft: '', reasoning: '',
      }
    },
    LLM: () => ({ abort: 'reply' }),
  },
  FAILED: (state, { error }) => ({ ...state, status: 'ready', draft: '', reasoning: '', error: error.body?.error?.message ?? error.body?.error ?? error.message }),
  CLEAR: (state) => ({ ...state, messages: [], meta: {}, error: null }),
}
