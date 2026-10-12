/*
 * PLAN-9 H-2 / H-3: cards in the chat (dev-plans/research/ai-compose/chat-client-tools.md, D454,
 * D455, D469). `chat({ ask: { catalog, backend?, instructions?, direct? } })` adds the client tool
 * `ask_user({ need })`; the configured backend composes a card from `need` and the app state (never
 * the conversation), and a result part's answer becomes the call's output `{ part, answer }`.
 *
 * The chat behavior reaches this module through the catalog (`catalog._ask`, set by defineCatalog),
 * so an app with `chat` and no catalog carries none of it (nor compose.llm).
 *
 * The card lives on the tool part: `part.ui = { status, layout, local, ui, answer, pending }`:
 * - status: 'composing' (queued, or its backend step is out: `pending` set) | 'open' (answerable) |
 *   'answered' | 'failed' (the part is output-error "could not show a card: …") | 'cancelled'
 *   (STOP, SEND);
 * - layout: the card (a decision backend's preview while it composes); ui / local: container state
 *   and `local` parts' state per node key, as in a compose slice; answer: `{ node, part, value }`;
 * - pending: the backend's step while its request is out (plain JSON).
 * Cards compose one at a time, on the backend's sink, under the key `<use>.ask:<toolCallId>`, with
 * the reply actions `<use>.CARD` / `<use>.CARD_FAILED`.
 *
 * `direct: true` (H-3): the tool's input schema is the layout schema (compose.llm's, without the
 * plan field) and the call's input is the card, read and repaired like an LLM backend's reply: no
 * compose round trip.
 *
 * `askCard(catalog, state, part, { key })` renders a card in the host's view: catalog.render with
 * the call id as scope, frozen unless the card is open, the answer marked, `local` written through
 * a lens to the part.
 */
import {warn} from '../../diagnostics/legacy'
import {llm, layoutSchema} from './llm'

export const ASK = 'ask_user'

const DESCRIPTION = 'Ask the user and wait for their answer: a choice, a pick among the app\'s items, a short form or a confirmation. Say in one sentence what you need from them; the app shows a card for it. Prefer this to asking in text when the answer is one of a few options or structured.'
const DIRECT = 'Ask the user and wait for their answer: a choice, a pick among the app\'s items, a short form or a confirmation. The input is the card, built from the app\'s parts; include a part the user answers with. Prefer this to asking in text when the answer is one of a few options or structured.'
const NEED = {
  type: 'object',
  properties: {need: {type: 'string', maxLength: 300, description: 'What you need from the user, in one sentence'}},
  required: ['need'],
  additionalProperties: false,
}

/** the card compositions per catalog (composeWith answers their pending step) */
const cards = /*#__PURE__*/ new WeakMap<object, Array<{backend: any; keys: Set<string>; mine: WeakSet<object>}>>()
export const cardsOf = (catalog: object) => cards.get(catalog) || []

/** the chat's `ask` option, resolved once per chat() call */
export function askConfig(ask: any, o: any, sink: string) {
  const {catalog, backend, direct, instructions} = ask
  if (!catalog || typeof catalog.render != 'function') throw new Error('[Sygnal] chat({ ask }): `ask.catalog` must be a catalog made by defineCatalog()')
  const results = [...new Set(Object.values<any>(catalog.parts).filter(p => p.result && p.component).map(p => p.component))]
  if (!Object.values<any>(catalog.parts).some(p => p.result)) {
    warn('SYG686', 'chat', 'the ask catalog has no result part (`result: true`), so no card can be answered: every ask_user call waits until STOP or a new message', 'Mark the parts the user answers with `result: true` and send compose.answer(props, value) to PARENT')
  }
  const be = direct ? null : backend ?? llm({sink, ...(o.model && {model: o.model}), ...o.transportOptions})
  // mine: the pending steps this chat() made, so composeWith picks its backend among the catalog's
  const entry = {backend: be, keys: new Set<string>(), mine: new WeakSet<object>()}
  if (be) {
    if (!cards.has(catalog)) cards.set(catalog, [])
    cards.get(catalog)!.push(entry)
  }
  return {catalog, backend: be, direct: !!direct, instructions, results, entry, reader: direct ? llm() : null,
    controls: Object.values<any>(catalog.containers || {}).some(c => typeof c.decl?.render == 'function')}
}
export type AskConfig = ReturnType<typeof askConfig>

/** the ask_user tool for a request (direct: the layout schema, for the host state of now) */
export const askTool = (c: AskConfig, state: any) => ({
  description: (c.direct ? DIRECT : DESCRIPTION) + (c.instructions ? ' ' + c.instructions : ''),
  inputSchema: c.direct ? layoutSchema(c.catalog, state, {plan: false}) : NEED,
})

const message = (e: any) => String(e?.message ?? e ?? 'error')
const ui = (p: any, patch: any) => ({...p, ui: {...p.ui, ...patch}})

/** the card can't be shown: the call answers with an error, and the turn goes on */
export const failed = (p: any, why: string) => ({
  ...ui(p, {status: 'failed', pending: null}),
  state: 'output-error',
  errorText: `could not show a card: ${why}; ask in text instead`,
})

/** an ask_user call as it opens: composing (queued), or (direct) the card itself */
export function openCard(c: AskConfig, p: any, state: any): any {
  const base = {...p, ui: {status: 'composing', layout: null, local: {}, ui: {}, answer: null, pending: null}}
  if (c.direct) return read(c, base, c.reader!.reply({catalog: c.catalog, state, pending: {plan: false}, reply: {value: p.input}} as any))
  const need = p.input?.need
  return typeof need == 'string' && need.trim() ? base : failed(base, 'the call has no `need` (one sentence saying what you need from the user)')
}

/** a backend result → the card part, and the next request when there is one */
function read(c: AskConfig, p: any, r: any): any {
  if (!r) return failed(p, 'the backend gave no layout')
  if (r.error != null) return failed(p, message(r.error))
  if (r.request !== undefined) return {part: ui(p, {pending: own(c, r.pending ?? p.ui.pending), ...(r.preview && {layout: r.preview})}), request: r.request}
  if (r.layout) return ui(p, {status: 'open', layout: r.layout, pending: null})
  return failed(p, 'nothing in the catalog fits it')
}
const own = (c: AskConfig, pending: any) => { if (pending && typeof pending == 'object') c.entry.mine.add(pending); return pending }
const names = (k: string, id: string) => ({ok: k + '.CARD', error: k + '.CARD_FAILED', key: `${k}.ask:${id}`}) as any

/** start composing a queued card: `{ part, request }`, or the failed part */
export function startCard(c: AskConfig, p: any, state: any, k: string): any {
  c.entry.keys.add(k)
  try {
    const r = c.backend!.start({catalog: c.catalog, state, prompt: String(p.input.need).trim(), previous: null, names: names(k, p.toolCallId)})
    return {part: ui(p, {pending: own(c, r.pending ?? {})}), request: r.request}
  } catch (e) { return failed(p, message(e)) }
}

/** a backend reply for the card in flight: `{ part, request }` (another step), or the card part */
export function cardReply(c: AskConfig, p: any, reply: any, state: any, k: string): any {
  try { return read(c, p, c.backend!.reply({catalog: c.catalog, state, pending: p.ui.pending, reply, names: names(k, p.toolCallId)})) } catch (e) { return failed(p, message(e)) }
}

/**
 * askCard(catalog, state, part, { key = 'assistant' }): the card of an ask_user tool part, for
 * the host's view (null while it has no layout)
 */
export function askCard(catalog: any, state: any, part: any, options: {key?: string} = {}): any {
  const u = part?.ui
  if (!u?.layout) return null
  const k = options.key ?? 'assistant', msgs = state?.[k]?.messages || []
  let at: any[] | undefined
  for (let i = msgs.length - 1; i >= 0 && !at; i--) {
    const j = (msgs[i].parts || []).findIndex((x: any) => x.toolCallId === part.toolCallId && x.ui)
    if (j >= 0) at = [k, 'messages', i, 'parts', j, 'ui']
  }
  return catalog.render(u, state, {
    scope: part.toolCallId,
    frozen: part.state !== 'input-available' || u.status !== 'open',
    answer: u.answer ? {node: u.answer.node, value: u.answer.value} : null,
    ...(at && {at}),
  })
}

/** what chat() reads through `catalog._ask` */
export const askKit = {askConfig, askTool, openCard, startCard, cardReply, failed}
