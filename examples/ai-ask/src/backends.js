// The pickers' choices: the chat model (the conversation) and the card backend (what composes a
// card from the model's `need`).
//
// `chat({ model, ask: { backend } })` fixes both when the behavior is defined, and the models are
// only known at run time (Ollama's GET /api/tags). So Assistant.jsx makes one assistant component
// per (chat model, card backend) pair, once, and the app shows the picked one.
import { compose } from 'sygnal/ai'

// Ollama serves the chat models (/v1/chat/completions), the decision models (/v1/systemone) and the
// list of installed models (/api/tags). Another host: VITE_OLLAMA_URL=http://host:11434 npm run dev
export const OLLAMA = (import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')

/** the default chat model, when installed */
export const DEFAULT_CHAT = 'qwen3:8b'

/** the chat model composes its own cards (compose.llm() on the chat's sink): the default */
export const LLM_CARDS = { id: 'llm', label: 'The chat model', kind: 'llm' }

/** TypeSafe's Jev, through the dev server's /api/decide proxy (vite.config.js), which holds the key */
export const JEV = { id: 'jev', label: 'Jev (TypeSafe)', kind: 'decisions', model: 'jev-latest', url: '/api/decide' }

const installed = (tags) => (Array.isArray(tags?.models) ? tags.models : [])

/** the chat models that can call tools (ask_user is a tool), qwen3:8b first when installed */
export function chatModels(tags) {
  const names = installed(tags).filter((m) => m.capabilities?.includes('tools')).map((m) => m.name)
  return names.includes(DEFAULT_CHAT) ? [DEFAULT_CHAT, ...names.filter((n) => n !== DEFAULT_CHAT)] : names
}

/** the card backends: the chat model itself, then Ollama's decision models (e.g. nimble), then Jev when the dev proxy has a key */
export function cardBackends(tags, jevAvailable) {
  return [
    LLM_CARDS,
    ...installed(tags).filter((m) => m.capabilities?.includes('decision')).map((m) => ({ id: m.name, label: m.name, kind: 'decisions', model: m.name, url: `${OLLAMA}/v1/systemone` })),
    ...(jevAvailable ? [JEV] : []),
  ]
}

/**
 * Keeps the backend's explanation with the card. A backend's last reply carries `decisions` (the
 * LLM's plan, or a decision model's answers with their probabilities), but a card (`part.ui`)
 * keeps only its layout, so this puts them on the layout as `explain` for the "what happened"
 * panel. Persisted with the conversation like the rest of the card.
 */
export function explained(backend, by) {
  const note = (r) => (r?.layout ? { ...r, layout: { ...r.layout, explain: { by, decisions: r.decisions ?? null } } } : r)
  return {
    sink: backend.sink,
    start: (a) => backend.start(a),
    reply: (a) => note(backend.reply(a)),
    ...(backend.delta && { delta: (a) => backend.delta(a) }),
    fake: (a) => backend.fake(a),
  }
}

/** the card backend for a choice: compose.llm() with the chat model, or compose.decisions() */
export function cardBackend(choice, chatModel) {
  if (choice.kind === 'llm') return explained(compose.llm({ model: chatModel }), chatModel)
  // a local decision model (Ollama's nimble, ~9B) favours the first of two options: profile 'small'
  return explained(compose.decisions({ url: choice.url, model: choice.model, ...(choice.url !== JEV.url && { profile: 'small' }) }), choice.label)
}
