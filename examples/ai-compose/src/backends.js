// Which model composes the page: the picker's choices and the two compose backends.
//
// `compose(catalog, { backend })` fixes its backend, and with it its sink, when the behavior is
// defined: compose.decisions() sends decide() requests on HTTP, compose.llm() chat requests on the
// LLM driver. The models, though, are only known at run time (Ollama's GET /api/tags). So:
//   - each backend KIND is one compose behavior, on its own page of a <Switchable> (App.jsx);
//   - within a kind, `forChoice` makes the real backend for the model picked in `state.backend`
//     (once per model) and keeps that choice in the pending step, so a reply is read by the
//     backend that asked, even if the picker changed meanwhile.
import { compose } from 'sygnal/ai'

// Ollama serves the decision models (/v1/systemone), the chat models (/v1/chat/completions) and
// the list of installed models (/api/tags). Another host: VITE_OLLAMA_URL=http://host:11434 npm run dev
export const OLLAMA = (import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')

/** TypeSafe's Jev, through the dev server's /api/decide proxy (vite.config.js), which holds the key */
export const JEV = { id: 'jev', label: 'Jev (TypeSafe)', kind: 'decisions', model: 'jev-latest', url: '/api/decide' }

/**
 * The picker's choices: Ollama's decision models (capability 'decision', e.g. nimble), then Jev
 * when the dev proxy has a key, then the chat models (capability 'completion', e.g. qwen3:8b).
 * Each choice is plain JSON (it is kept in state and in pending steps).
 */
export function backendChoices(tags, jevAvailable) {
  const models = Array.isArray(tags?.models) ? tags.models : []
  const named = (capability) => models.filter((m) => m.capabilities?.includes(capability)).map((m) => m.name)
  return [
    ...named('decision').map((model) => ({ id: model, label: model, kind: 'decisions', model, url: `${OLLAMA}/v1/systemone` })),
    ...(jevAvailable ? [JEV] : []),
    ...named('completion').map((model) => ({ id: model, label: model, kind: 'llm', model })),
  ]
}

/** a backend of one kind that composes with the model in `state.backend` */
function forChoice(sink, make) {
  const made = new Map()
  const of = (choice) => {
    if (!made.has(choice.id)) made.set(choice.id, make(choice))
    return made.get(choice.id)
  }
  const keep = (choice, r) => (r && r.pending !== undefined ? { ...r, pending: { choice, step: r.pending } } : r)
  const inner = ({ pending, ...a }) => [of(pending.choice), { ...a, pending: pending.step }]
  return {
    sink,
    start: (a) => keep(a.state.backend, of(a.state.backend).start(a)),
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

/** a decision model (nimble on Ollama, Jev through the proxy): decide() requests on HTTP */
export const decisionsBackend = forChoice('HTTP', ({ url, model }) => compose.decisions({ url, model }))

/** a chat model (qwen3:8b on Ollama): one structured-output request on the LLM driver (main.js) */
export const llmBackend = forChoice('LLM', ({ model }) => compose.llm({ model }))
