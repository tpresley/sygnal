// CANDIDATE A (prototype): the `compose` behavior.
//
//   App.uses = { page: compose(catalog, { backend: decisions({ url, model }) | llm({ ... }), form: '.ask', prompt: '.prompt' }) }
//   view: {catalog.render(state.page, state)}
//
// Slice (state.page): { prompt, status, layout, preview, pending, decisions, error, ui, local, composed }
// - status: 'idle' | 'composing' | 'preview' (a partial layout shows: after the select step, or streaming)
//   | 'done' | 'unavailable' (nothing in the catalog fits) | 'error'
// - layout: the last finished layout (kept while a new one is composed, and on an error)
// - preview: the layout being built (rendered instead of `layout` while set)
// - ui: container UI state per node key ({ tab }); local: the state of `local` parts per node key
// Actions ('page.X'): PROMPT, COMPOSE (data: a prompt, else the slice's prompt; a follow-up edit when
// a layout exists, unless `{ prompt, fresh: true }`), SET_LAYOUT (restore, undo, an app's own edit),
// REMOVE (a node key), CONTROL (container controls: tabs), DONE (after a finished composition: a host
// 'page.DONE' entry runs after it). Internal: REPLY, DELTA, FAILED.
import { ABORT, defineBehavior } from 'sygnal'
import { removeNode } from './catalog.jsx'

const promptOf = (s, d) => (typeof d === 'string' ? d : d?.prompt ?? s.prompt ?? '').trim()

export function compose(catalog, options = {}) {
  const { backend, form, prompt: promptSel } = options
  const S = backend.sink
  const names = (k) => ({ ok: `${k}.REPLY`, error: `${k}.FAILED`, delta: `${k}.DELTA` })

  // one memo per action, so STATE and the sink of one action compute the same start / reply
  const memo = (f) => { let l = []; return (...a) => (a.every((x, i) => x === l[i]) ? l.at(-1) : (l = [...a, f(...a)]).at(-1)) }

  // both need the host's whole state (record params come from it): HOST reducers get it, a sink
  // reads it as props.state (verified: the decision select step lists the customers)
  const start = memo((slice, d, hostState, k) => {
    const prompt = promptOf(slice, d)
    if (!prompt) return null
    const previous = d?.fresh ? null : slice.layout
    return { prompt, ...backend.start({ catalog, state: hostState, prompt, previous, names: names(k) }) }
  })
  const onReply = memo((slice, reply, hostState, k) => slice.pending
    ? backend.reply({ catalog, state: hostState, pending: slice.pending, reply, names: names(k) })
    : null)

  return defineBehavior({
    initialState: { prompt: '', status: 'idle', layout: null, preview: null, pending: null, decisions: [], error: null, ui: {}, local: {}, composed: null },
    intent: ({ DOM }) => ({
      ...(promptSel && { PROMPT: DOM.input(promptSel).value() }),
      ...(form && { COMPOSE: DOM.select(form).events('submit', { preventDefault: true }).mapTo(undefined) }),
      CONTROL: DOM.click('.compose-control').map((e) => {
        const el = e.target.closest ? e.target.closest('[data-compose-node]') : e.target
        const ds = el?.dataset || e.target.dataset || {}
        return { node: ds.composeNode, action: ds.composeAction, value: ds.composeValue }
      }),
    }),
    model: {
      PROMPT: (s, prompt) => ({ ...s, prompt }),
      // HOST runs on the whole state: the record params need it (and HOST's sinks see the same memo)
      COMPOSE: {
        HOST: (st, d, _n, _p, _o, k) => {
          const r = start(st[k], d, st, k)
          if (!r) return ABORT
          return { ...st, [k]: { ...st[k], prompt: r.prompt, status: 'composing', preview: null, pending: r.pending, decisions: [], error: null } }
        },
        [S]: (s, d, _n, props, _o, k) => start(s, d, props.state, k)?.request ?? ABORT,
      },
      REPLY: {
        HOST: (st, reply, _n, _p, _o, k) => {
          const r = onReply(st[k], reply, st, k)
          if (!r) return ABORT
          const s = st[k]
          const decisions = [...s.decisions, r.decisions].filter(Boolean)
          const next = r.layout
            ? { ...s, status: r.empty ? 'unavailable' : 'done', layout: r.empty ? s.layout : r.layout, preview: null, pending: null, composed: s.pending.prompt }
            : { ...s, status: 'preview', preview: r.preview ?? s.preview, pending: r.pending }
          return { ...st, [k]: { ...next, decisions } }
        },
        [S]: (s, reply, _n, props, _o, k) => onReply(s, reply, props.state, k)?.request ?? ABORT,
        EFFECT: (s, reply, next, props, _o, k) => { const r = onReply(s, reply, props.state, k); if (r?.layout && !r.empty) next('DONE', r.layout) },
      },
      DELTA: {
        HOST: (st, delta, _n, _p, _o, k) => {
          const s = st[k]
          if (!s.pending || !backend.delta) return ABORT
          const r = backend.delta({ catalog, state: st, pending: s.pending, delta })
          return r.preview ? { ...st, [k]: { ...s, status: 'preview', preview: r.preview } } : ABORT
        },
      },
      FAILED: (s, { error }) => (s.pending ? { ...s, status: 'error', preview: null, pending: null, error: error?.message ?? String(error) } : ABORT),
      SET_LAYOUT: (s, layout) => ({ ...s, layout, preview: null, pending: null, status: layout ? 'done' : 'idle' }),
      REMOVE: (s, key) => (s.layout?.nodes[key] ? { ...s, layout: removeNode(s.layout, key) } : ABORT),
      CONTROL: (s, { node, action, value }) => (action === 'tab' ? { ...s, ui: { ...s.ui, [node]: { ...s.ui[node], tab: Number(value) } } } : ABORT),
      DONE: () => ABORT,
    },
  })(options)
}
