// PROTOTYPE: in-chat agent UI ("AskUserQuestion" with the app's own parts), on the chat behavior's
// existing tool loop: no chat or core change.
//
//   App.uses = { assistant: chat({ form: '.ask', prompt: '.prompt' }), cards: askUser(catalog) }   // or askUser(catalog, { backend: decisions(...) })
//   App.agent = { name: 'ui', read: (s) => cardResult(s.cards), actions: { 'cards.ASK': askTool(catalog, 'cards', { description }) } }
//   view: messages → for a `tool-ui_cards_ask` part, renderCard(catalog, state, 'cards', part)
//
// How a call flows: the chat model calls `ui_cards_ask` with a layout (LLM backend: the tool's input
// schema IS layoutSchema(catalog)) or with `{ request }` (decision backend: compose() builds it); the
// agent layer dispatches `cards.ASK`, which opens a card (`cards.byId[id]`, `cards.open = id`); the
// call waits (`until: open == null`); a result part's PARENT (`answer(props, value)`) is `cards.ANSWER`:
// the card is answered (frozen) and the call returns `{ ok: true, state: { card, part, answer } }`
// (the declaration's `read`) as the tool result; the chat behavior sends the next request.
//
// Slice (state.cards): { byId: { [id]: card }, open, seq, last }
// card: { id, status: 'composing' | 'open' | 'answered' | 'failed', request?, layout, ui, local, answer: { node, part, value } | null, pending? }
import xs from 'xstream'
import { ABORT, defineBehavior } from 'sygnal'
import { jsonSchema } from 'sygnal/ai'
import { layoutSchema } from './backends.js'

// setTimeout's longest delay: a person may take minutes to answer (the agent layer's default is 10 s)
const FOREVER = 2 ** 31 - 1

/** the agent action for the tool: its input schema comes from the catalog (or `{ request }` for a decision backend) */
export function askTool(catalog, key, { description, backend, state = {} } = {}) {
  return {
    description: description ?? 'Show the user a card built from the app\'s prepared parts and wait for their answer (a choice, a form, a confirmation).',
    input: backend
      ? jsonSchema({ type: 'object', properties: { request: { type: 'string', description: 'What the card should ask or show, in a sentence' } }, required: ['request'], additionalProperties: false })
      : jsonSchema(layoutSchema(catalog, state)),
    until: (s) => s[key]?.open == null,
    timeout: FOREVER,
  }
}

/** the declaration's `read`: what the tool call returns (and what the model sees in the app state) */
export const cardResult = (slice) => {
  const c = slice?.byId[slice.last]
  return c ? { card: c.id, status: c.status, part: c.answer?.part ?? null, answer: c.answer?.value ?? null } : {}
}

export function askUser(catalog, { backend } = {}) {
  const results = [...new Set(Object.values(catalog.parts).filter((p) => p.result).map((p) => p.component))]
  const names = (k) => ({ ok: `${k}.REPLY`, error: `${k}.FAILED` })
  const memo = (f) => { let l = []; return (...a) => (a.every((x, i) => x === l[i]) ? l.at(-1) : (l = [...a, f(...a)]).at(-1)) }
  const setCard = (st, k, id, patch) => ({ ...st, [k]: { ...st[k], byId: { ...st[k].byId, [id]: { ...st[k].byId[id], ...patch } } } })

  const start = memo((slice, input, hostState, k) => {
    if (!backend) return null
    return backend.start({ catalog, state: hostState, prompt: input.request, previous: null, names: names(k) })
  })
  const onReply = memo((slice, reply, hostState, k) => {
    const c = slice.byId[slice.open]
    return c?.pending ? backend.reply({ catalog, state: hostState, pending: c.pending, reply, names: names(k) }) : null
  })

  return defineBehavior({
    initialState: { byId: {}, open: null, seq: 0, last: null },
    intent: ({ CHILD, DOM }) => ({
      ...(results.length && { ANSWER: xs.merge(...results.map((C) => CHILD.select(C))).filter((d) => d && d.scope) }),
      CONTROL: DOM.click('.compose-control').map((e) => {
        const ds = e.target.closest?.('[data-compose-node]')?.dataset || e.target.dataset || {}
        return { scope: ds.composeScope, node: ds.composeNode, action: ds.composeAction, value: ds.composeValue }
      }),
    }),
    model: {
      // the tool call: open a card (a layout from the LLM, or compose one with the decision backend)
      ASK: {
        HOST: (st, input, _n, _p, _o, k) => {
          const s = st[k], id = `c${s.seq + 1}`
          const card = { id, ui: {}, local: {}, answer: null }
          if (backend) {
            const r = start(s, input, st, k)
            Object.assign(card, { status: 'composing', request: input.request, layout: null, pending: r.pending })
          } else Object.assign(card, { status: 'open', layout: catalog.fromTree(input.page || []) })
          return { ...st, [k]: { ...s, seq: s.seq + 1, open: id, last: id, byId: { ...s.byId, [id]: card } } }
        },
        ...(backend && { [backend.sink]: (s, input, _n, props, _o, k) => start(s, input, props.state, k)?.request ?? ABORT }),
      },
      ...(backend && {
        REPLY: {
          HOST: (st, reply, _n, _p, _o, k) => {
            const r = onReply(st[k], reply, st, k)
            if (!r) return ABORT
            const id = st[k].open
            return setCard(st, k, id, r.layout ? { status: 'open', layout: r.layout, pending: null } : { layout: r.preview, pending: r.pending })
          },
          [backend.sink]: (s, reply, _n, props, _o, k) => onReply(s, reply, props.state, k)?.request ?? ABORT,
        },
        // the card can't be built: the call answers with status 'failed'
        FAILED: (s) => (s.open ? { ...s, open: null, byId: { ...s.byId, [s.open]: { ...s.byId[s.open], status: 'failed', pending: null } } } : ABORT),
      }),
      // a result part answered: only the open card takes it, once; then it is frozen
      ANSWER: (s, { scope, node, value }) => {
        const c = s.byId[scope]
        if (!c || s.open !== scope || c.status !== 'open') return ABORT
        return { ...s, open: null, byId: { ...s.byId, [scope]: { ...c, status: 'answered', answer: { node, part: c.layout.nodes[node]?.part, value } } } }
      },
      CONTROL: (s, { scope, node, action, value }) => {
        const c = s.byId[scope]
        return c && action === 'tab' ? { ...s, byId: { ...s.byId, [scope]: { ...c, ui: { ...c.ui, [node]: { tab: Number(value) } } } } } : ABORT
      },
    },
  })({})
}

/**
 * The card for a chat message's tool part: an answered call names its card in its result
 * (`output.state.card`); the call still waiting is the open card.
 */
export function renderCard(catalog, state, key, toolPart) {
  const slice = state[key]
  const id = toolPart.output?.state?.card ?? (toolPart.state === 'input-available' ? slice.open : null)
  const c = id && slice.byId[id]
  if (!c) return null
  return (
    <section className={`ask-card ${c.status}`} data={{ card: id }}>
      {c.status === 'composing' && !c.layout ? <p className="composing">…</p> : catalog.render(c, state, { at: [key, 'byId', id], scope: id, frozen: c.status !== 'open', answer: c.answer })}
    </section>
  )
}
