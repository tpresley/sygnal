// Which model composes: one picker over two kinds of model, and a compose backend per kind.
//
// `compose(catalog, { backend })` fixes the backend, and with it the sink, when the behavior is
// defined: compose.decisions() sends decide() requests on HTTP, compose.llm() chat requests on the
// LLM driver. So each KIND is its own component (Compose.jsx shows the one the picked model needs in
// a <Switchable>), and within a kind the backend follows the picked model:
//   - compose.llm() takes `model` as a function of the state, read per request;
//   - a decision model also differs in its URL and tuning, so `forChoice` makes one
//     compose.decisions() per model and keeps the choice in the pending step: a reply is read by
//     the backend that asked, even if the picker changed meanwhile.
import { compose } from 'sygnal/ai'
import { choicesOf } from '../../shared/picker.jsx'
import { defaultChoice } from '../../shared/providers.js'

/** every model on offer: decision models first (nimble on Ollama, Jev with a TypeSafe key), then chat models */
export function modelChoices(state) {
  return [
    ...choicesOf(state, { need: 'decision' }).map((c) => ({ ...c, kind: 'decisions' })),
    ...choicesOf(state, { need: 'chat' }).map((c) => ({ ...c, kind: 'llm' })),
  ]
}

/** the model in use: the user's pick, else Jev, else a local decision model, else the default chat model */
export function pickedChoice(state) {
  const all = modelChoices(state)
  return all.find((c) => c.id === state.model)
    ?? all.find((c) => c.model === 'jev-latest')
    ?? all.find((c) => c.kind === 'decisions')
    ?? defaultChoice(all)
}

/** a backend that composes with the decision model picked in the state */
function forChoice(make) {
  const made = new Map()
  const of = (choice) => {
    if (!made.has(choice.id)) made.set(choice.id, make(choice))
    return made.get(choice.id)
  }
  const keep = (choice, r) => (r && r.pending !== undefined ? { ...r, pending: { choice, step: r.pending } } : r)
  const inner = ({ pending, ...a }) => [of(pending.choice), { ...a, pending: pending.step }]
  return {
    sink: 'HTTP',
    start: (a) => {
      const choice = pickedChoice(a.state)
      return keep(choice, of(choice).start(a))
    },
    reply: (a) => {
      const [backend, args] = inner(a)
      return keep(a.pending.choice, backend.reply(args))
    },
    delta: (a) => {
      const [backend, args] = inner(a)
      return backend.delta ? backend.delta(args) : {}
    },
    fake: (a) => {
      const [backend, args] = inner(a)
      return backend.fake(args)
    },
  }
}

// a local ~9B decision model (Ollama's nimble) favours the first of two options: profile 'small'
// asks each order question both ways; Jev keeps the measured defaults
export const decisionsBackend = forChoice(({ url, model }) => compose.decisions({ url, model, ...(model !== 'jev-latest' && { profile: 'small', rowMean: 0.5 }) }))

// a chat model fills a JSON Schema of the catalog, streamed: the finished parts show as a preview.
// Deterministic on Ollama (steadier layouts from a small local model); hosted reasoning models such
// as GPT-5.x refuse `temperature`, so it goes to the Ollama route only (routed() in shared/providers.js)
export const llmBackend = compose.llm({ model: (state) => pickedChoice(state)?.id, bodyFor: { ollama: { temperature: 0 } } })
