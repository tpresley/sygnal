// Where the models are, and how each widget's LLM driver reaches them.
//
// A model is picked as one string, `<route>::<model id>`: `ollama::qwen3:8b`,
// `kindo::moonshotai/Kimi-K3`, ... The route names a transport, so one chat driver serves every provider and
// a widget's model picker is just state. `routed()` is a ten-line custom transport that reads the
// route off the request and hands the request to that transport.
//
// No key is in this file, or anywhere in the page. Ollama needs none (it is on localhost), and
// Kindo is reached through the dev server's /api/kindo route, which adds the key (server/providers.js).
import { makeChatDriver, openResponses, chatCompletions, anthropicMessages, chromePrompt } from 'sygnal/ai'

export const OLLAMA = (import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
const KINDO = '/api/kindo/v1'

/** Kimi K3 on Kindo, the default model whenever a Kindo key is set */
export const PREFERRED_KINDO = /kimi[-_. ]?k3/i

export const ROUTES = {
  // Ollama's Open Responses endpoint, thinking off unless a request asks for it (0.2 s, not 12 s, for qwen3)
  ollama: { label: 'Ollama', wire: 'Open Responses', transport: openResponses({ baseURL: `${OLLAMA}/v1`, body: { reasoning: { effort: 'none' } } }) },
  // one Kindo key, three wire formats
  kindo: { label: 'Kindo', wire: 'Open Responses', transport: openResponses({ baseURL: KINDO }) },
  'kindo-cc': { label: 'Kindo', wire: 'Chat Completions', transport: chatCompletions({ baseURL: KINDO }) },
  'kindo-msg': { label: 'Kindo', wire: 'Anthropic Messages', transport: anthropicMessages({ baseURL: KINDO, maxTokens: 4000 }) },
  // the browser's own model (Chrome's Prompt API): no server at all
  chrome: { label: 'Chrome', wire: 'Prompt API', transport: chromePrompt() },
}

export const SEP = '::'
export const routeOf = (id) => (id ? id.slice(0, id.indexOf(SEP)) : '')
export const modelOf = (id) => (id ? id.slice(id.indexOf(SEP) + SEP.length) : '')

/**
 * A transport that picks one of ROUTES by the request's `model` (`route::model`). A request may
 * carry `bodyFor: { route: fields }`, body fields for one route only: options a provider rejects
 * (`temperature` on OpenAI's reasoning models) can go to the others.
 */
export function routed(routes = ROUTES) {
  return {
    stream({ bodyFor, ...request }, signal) {
      const name = routeOf(request.model)
      const route = routes[name]
      if (!route) throw new Error(`no route for the model "${request.model}"`)
      const body = bodyFor?.[name] ? { ...request.body, ...bodyFor[name] } : request.body
      return route.transport.stream({ ...request, ...(body && { body }), model: modelOf(request.model) || undefined }, signal)
    },
  }
}

/** every widget's LLM driver */
export const makeLLM = () => makeChatDriver({ transport: routed() })

/**
 * The model choices for a picker, from GET /api/providers:
 *   { id: 'ollama::qwen3:8b', label, group }
 * `need`: 'tools' (only models that call tools), 'chat' (any chat model), 'decision'.
 * `routes`: which Kindo wire formats to offer (default: Open Responses only).
 */
export function modelChoices(providers, { need = 'chat', kindoRoutes = ['kindo'], chrome = false } = {}) {
  if (!providers) return []
  const ollama = providers.ollama?.models ?? []
  const has = (m, cap) => m.capabilities.includes(cap)
  if (need === 'decision') {
    return [
      ...ollama.filter((m) => has(m, 'decision')).map((m) => ({ id: `ollama${SEP}${m.name}`, label: m.name, group: 'Ollama (local)', url: `${OLLAMA}/v1/systemone`, model: m.name })),
      ...(providers.typesafe?.configured ? [{ id: 'typesafe::jev-latest', label: 'Jev', group: 'TypeSafe (via the dev proxy)', url: '/api/decide', model: 'jev-latest' }] : []),
    ]
  }
  const ok = (m) => has(m, 'completion') && (need !== 'tools' || has(m, 'tools'))
  const kindo = providers.kindo?.reachable ? sortKindo(providers.kindo.models) : []
  return [
    ...kindoRoutes.flatMap((r) => kindo.map((name) => ({ id: `${r}${SEP}${name}`, label: name, group: `Kindo · ${ROUTES[r].wire}` }))),
    ...ollama.filter(ok).map((m) => ({ id: `ollama${SEP}${m.name}`, label: m.name, group: 'Ollama (local)' })),
    ...(chrome ? [{ id: `chrome${SEP}`, label: 'Gemini Nano (on-device)', group: 'Chrome built-in AI' }] : []),
  ]
}

/** Kimi K3 first, then the rest in Kindo's order */
const sortKindo = (names) => [...names.filter((n) => PREFERRED_KINDO.test(n)), ...names.filter((n) => !PREFERRED_KINDO.test(n))]

/** The default pick: Kimi K3 on Kindo when a key is set, else qwen3:8b on Ollama, else the first */
export function defaultChoice(choices) {
  return choices.find((c) => routeOf(c.id) === 'kindo' && PREFERRED_KINDO.test(c.label))
    ?? choices.find((c) => c.id === `ollama${SEP}qwen3:8b`)
    ?? choices[0]
    ?? null
}

/** A line for when there is nothing to pick */
export function offline(providers) {
  if (!providers) return 'Looking for models…'
  if (!providers.ollama?.reachable && !providers.kindo?.reachable) return `No models: Ollama isn't reachable at ${OLLAMA} and no Kindo key is set (Keys, top right).`
  return 'No suitable model found.'
}
