/*
 * PLAN-9 T-1: composeWith(t, catalog, tree, { stream? }), a test fixture for a whole composition,
 * the same for every backend:
 *
 *   t.simulateAction('page.COMPOSE', 'Revenue and churn side by side')
 *   await composeWith(t, catalog, [{ part: 'row', children: [{ part: 'revenue' }, { part: 'churn' }] }])
 *
 * It finds the composition of `catalog` that is waiting for a reply (a `compose` use whose slice
 * has `pending`) and answers each of its steps with the backend's `fake()` (the reply body that
 * leads to `tree`) on the backend's sink, targeted by the use's reply action (`page.REPLY`):
 * `t.respond`, or, with `stream: n` (true: 3) and a text body, `t.stream` in n chunks (an LLM
 * backend's JSON). It resolves once no step is pending.
 *
 * H-2: a card of `chat({ ask: { catalog } })` being composed (an `ask_user` part whose `ui` has
 * `pending`) is answered the same way, targeted by the chat's CARD action ('assistant.CARD'). A
 * compose use waiting goes first.
 */
import {usesOf} from './behavior'
import {cardsOf} from './ask'
import type {Tree} from './types'

const err = (m: string) => new Error(`[Sygnal] composeWith: ${m}`)

/** a step waiting for a reply: its backend, the reply action, the pending step, and how to find the next one */
type Cur = {backend: any; target: string; pending: any; next: () => Cur | undefined} | undefined

export async function composeWith(t: any, catalog: any, tree: Tree, options: {stream?: number | boolean} = {}): Promise<void> {
  const entries = usesOf(catalog), cards = cardsOf(catalog)
  if (!entries.length && !cards.length) throw err('no compose behavior uses this catalog (compose(catalog, { backend }) in a component\'s uses, or chat({ ask: { catalog } }))')
  const use = (e: (typeof entries)[number], k: string, s: any): Cur => ({backend: e.backend, target: k + '.REPLY', pending: s.pending, next: () => {
    const n = t.state?.[k]
    return n?.pending != null && n.pending !== s.pending ? use(e, k, n) : undefined
  }})
  // the card being composed in a chat's last message (cards compose one at a time)
  const cardOf = (backend: any, k: string, id?: string): Cur => {
    const msgs = t.state?.[k]?.messages, m = Array.isArray(msgs) ? msgs[msgs.length - 1] : null
    const p = m?.role == 'assistant' && (m.parts || []).find((x: any) => x.ui?.status == 'composing' && x.ui.pending != null && x.state == 'input-available' && (id === undefined || x.toolCallId === id))
    if (!p) return
    return {backend, target: k + '.CARD', pending: p.ui.pending, next: () => { const n = cardOf(backend, k, p.toolCallId); return n && n.pending !== p.ui.pending ? n : undefined }}
  }
  // the use that made the pending step (several hosts may share the catalog and the key)
  const find = (): Cur => {
    let any: Cur
    for (const e of entries) for (const k of e.keys) {
      const s = t.state?.[k]
      if (s?.pending == null) continue
      if (typeof s.pending == 'object' && e.mine.has(s.pending)) return use(e, k, s)
      any ||= use(e, k, s)
    }
    if (any) return any
    for (const c of cards) for (const k of c.keys) { const x = cardOf(c.backend, k); if (x) return x }
  }
  let cur: Cur = find()
  if (!cur) { await t.settle(); cur = find() }
  if (!cur) throw err('no composition is waiting for a reply (send COMPOSE first, or let the chat model call ask_user)')
  for (let step = 0; cur && step < 16; step++) {
    const {backend, target, pending} = cur
    const sink: string = backend.sink
    const body = backend.fake({catalog, state: t.state, pending, target: tree})
    if (options.stream && typeof body == 'string') {
      const n = Math.max(1, options.stream === true ? 3 : Number(options.stream) || 1), size = Math.ceil(body.length / n) || 1
      for (let i = 0; i < n; i++) await t.stream(sink, [body.slice(i * size, (i + 1) * size)], target, {end: i == n - 1})
    } else await t.respond(sink, body, target)
    cur = cur.next()
  }
}
