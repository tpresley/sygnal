// PROTOTYPE: the two backends behind one interface. The ENCODING here is a stand-in (other workers
// own it); what matters is the contract every candidate API uses:
//
//   backend.sink                                   'HTTP' (decide()) | 'LLM' (makeChatDriver)
//   backend.start({ catalog, state, prompt, previous, names })
//       → { request, pending }                     the first request; `pending` is plain data (kept in state)
//   backend.reply({ catalog, state, pending, reply, names })
//       → { layout?, preview?, request?, pending?, decisions? }   layout: done; request: one more step
//   backend.delta?({ catalog, state, pending, delta }) → { preview }   (LLM streaming)
//
// names = { ok, error, delta }: the reply action names (the caller's, e.g. 'page.REPLY').
import { decide, choice, noul, jsonSchema } from 'sygnal/ai'
import { fromTree, toTree, freeParams, recordParam } from './catalog.jsx'

// ================================================================== decision models (decide())
const SELECT = 'Does user_request ask for this element, by name or by what it shows? Every element user_request names must be used. Omit elements user_request does not ask for.'
const KEEP = ' Elements listed in current_page stay unless user_request asks to remove or replace them.'
const ABOVE = 'Which of these two elements comes higher on the page? Follow user_request; when it does not say, the one it mentions first comes higher.'

/** a free-text param with no default can't be filled by a decision model: such a part is LLM-only */
const llmOnly = (part) => freeParams(part).some((k) => part.params[k].required && part.params[k].default === undefined)
const qname = (s) => s.replace(/[^A-Za-z0-9_]/g, '_')

function selectQuestions(catalog, state, previous) {
  const q = {}
  for (const o of catalog.options(state)) {
    if (llmOnly(catalog.get(o.part))) continue
    q[`use_${qname(o.option)}`] = choice(SELECT + (previous ? KEEP : ''), { omit: 'None of these elements is needed.', use: o.description })
  }
  for (const c of gated(catalog)) q[`layout_${c.id}`] = noul(`Does user_request explicitly ask for some elements to be arranged like this: ${c.description}?`)
  return q
}
const gated = (catalog) => Object.values(catalog.parts).filter((p) => p.kind === 'container' && p.id !== 'page' && p.description)

function layoutQuestions(catalog, chosen, gates) {
  const q = {}
  if (gates.length) {
    for (const o of chosen) {
      q[`place_${qname(o.option)}`] = choice(`Where does this element go: ${o.description}? Follow user_request.`, {
        page: 'On the page itself, full width',
        ...Object.fromEntries(gates.map((g) => [g, catalog.get(g).description])),
      })
    }
  }
  chosen.forEach((a, i) => chosen.slice(i + 1).forEach((b) => {
    q[`above_${qname(a.option)}__${qname(b.option)}`] = choice(ABOVE, { a: a.description, b: b.description })
  }))
  // enum params (not the record id): one choice each
  for (const o of chosen) {
    const part = catalog.get(o.part)
    for (const k in part.params) {
      const p = part.params[k]
      if (!Array.isArray(p.enum)) continue
      q[`param_${qname(o.option)}_${k}`] = choice(`${p.description || k} for: ${o.description}. Follow user_request; when it does not say, pick ${JSON.stringify(p.default ?? p.enum[0])}.`,
        Object.fromEntries(p.enum.map((v) => [String(v), p.descriptions?.[v] ?? null])))
    }
  }
  return q
}

const describeLayout = (catalog, layout) => Object.entries(layout.nodes)
  .filter(([, n]) => catalog.get(n.part)?.kind === 'part')
  .map(([key, n]) => ({ id: key, content: catalog.get(n.part).description }))

/** decisions({ url, model, decide? }): the decision-model backend (decide(), the HTTP sink) */
export function decisions({ url = '/api/decide', model, sink = 'HTTP', key = 'compose' } = {}) {
  const req = (names, state, questions) => decide({ url, model, state, questions, key, latest: true, ok: names.ok, error: names.error })
  return {
    sink,
    kind: 'decisions',
    start({ catalog, state, prompt, previous, names }) {
      const ds = { user_request: prompt, ...(previous && { current_page: describeLayout(catalog, previous) }) }
      return { request: req(names, ds, selectQuestions(catalog, state, previous)), pending: { step: 'select', prompt, edit: !!previous } }
    },
    reply({ catalog, state, pending, reply, names }) {
      const a = reply.answers
      if (pending.step === 'select') {
        const chosen = catalog.options(state).filter((o) => a[`use_${qname(o.option)}`]?.choice === 'use')
        const gates = chosen.length > 1 ? gated(catalog).filter((c) => (a[`layout_${c.id}`]?.noul ?? 0) >= 0.5).map((c) => c.id) : []
        const preview = fromTree(catalog, chosen.map((o) => ({ part: o.part, params: o.params })))
        const hasParams = chosen.some((o) => Object.values(catalog.get(o.part).params).some((p) => Array.isArray(p.enum)))
        if (chosen.length === 0) return { layout: preview, decisions: { select: a }, empty: true }
        if (chosen.length === 1 && !hasParams) return { layout: preview, decisions: { select: a } }
        const p2 = { ...pending, step: 'layout', chosen: chosen.map(({ option, part, params, description }) => ({ option, part, params, description })), gates }
        return {
          preview,
          pending: p2,
          decisions: { select: a },
          request: req(names, { user_request: pending.prompt, selected_elements: chosen.map((o) => ({ id: o.option, content: o.description })) }, layoutQuestions(catalog, p2.chosen, gates)),
        }
      }
      // the layout step: order (summed pairwise probabilities), placement, enum params
      const { chosen, gates } = pending
      const wins = Object.fromEntries(chosen.map((o) => [o.option, 0]))
      chosen.forEach((x, i) => chosen.slice(i + 1).forEach((y) => {
        const p = a[`above_${qname(x.option)}__${qname(y.option)}`]?.probabilities
        if (p) { wins[x.option] += p.a ?? 0; wins[y.option] += p.b ?? 0 }
      }))
      const order = [...chosen].sort((x, y) => wins[y.option] - wins[x.option] || chosen.indexOf(x) - chosen.indexOf(y))
      const leaf = (o) => {
        const params = { ...o.params }
        for (const k in catalog.get(o.part).params) {
          const ans = a[`param_${qname(o.option)}_${k}`]
          if (ans) { const p = catalog.get(o.part).params[k]; params[k] = p.enum.find((v) => String(v) === ans.choice) }
        }
        return { part: o.part, params }
      }
      const where = (o) => a[`place_${qname(o.option)}`]?.choice || 'page'
      const groups = Object.fromEntries(gates.map((g) => [g, order.filter((o) => where(o) === g)]))
      const tree = []
      for (const o of order) {
        const g = where(o)
        if (g === 'page' || groups[g].length < 2) tree.push(leaf(o))
        else if (groups[g][0] === o) tree.push({ part: g, children: groups[g].map(leaf) })
      }
      return { layout: fromTree(catalog, tree), decisions: { layout: a } }
    },
  }
}

// ================================================================== chat LLMs (makeChatDriver)
/** the JSON Schema of a layout tree for this catalog (record ids and enums from state) */
export function layoutSchema(catalog, state) {
  const variants = []
  for (const p of Object.values(catalog.parts)) {
    if (p.id === 'page') continue
    const props = { part: { const: p.id } }
    const params = {}
    for (const k in p.params) {
      const d = p.params[k]
      if (d.from) params[k] = { enum: d.from(state).map((r) => r.value), description: d.description || 'which record' }
      else { const { default: _d, required: _r, descriptions: _ds, ...schema } = d; params[k] = schema }
    }
    if (Object.keys(params).length) props.params = { type: 'object', properties: params, additionalProperties: false, required: Object.keys(p.params).filter((k) => p.params[k].from || p.params[k].required) }
    if (p.kind === 'container') props.children = { type: 'array', items: { $ref: '#/$defs/node' } }
    variants.push({ type: 'object', description: p.description, properties: props, required: ['part', ...(p.kind === 'container' ? ['children'] : []), ...(props.params?.required.length ? ['params'] : [])], additionalProperties: false })
  }
  return { type: 'object', properties: { page: { type: 'array', items: { $ref: '#/$defs/node' } } }, required: ['page'], additionalProperties: false, $defs: { node: { anyOf: variants } } }
}

const INSTRUCTIONS = 'You compose a page from prepared parts. Use only the parts in the catalog (by their `part` name), arrange them top to bottom in `page`, put parts in a container\'s `children` when the request asks for that arrangement. Never invent parts. Free-text params (titles, filters) are short and follow the request.'

/**
 * Close what a streamed JSON prefix left open, so a preview can show the complete nodes so far
 * (strings, objects, arrays); cut back to the last complete value when that still fails.
 */
export function parsePartial(text) {
  let s = text.trim().replace(/^```(?:json)?\s*/, '')
  for (let tries = 0; tries < 40 && s; tries++) {
    const stack = []
    let inStr = false, esc = false
    for (const ch of s) {
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
      if (ch === '"') inStr = true
      else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
      else if (ch === '}' || ch === ']') stack.pop()
    }
    const body = (inStr ? s + '"' : s).replace(/[,:\s]+$/, '')
    try { return JSON.parse(body + stack.reverse().join('')) } catch (_) { /* cut back */ }
    const cut = Math.max(s.lastIndexOf(','), s.lastIndexOf('{'), s.lastIndexOf('['))
    if (cut <= 0) return undefined
    s = s.slice(0, s[cut] === ',' ? cut : cut + 1)
  }
  return undefined
}

// a streamed tree may have half-written nodes: keep the ones with a known part
const clean = (catalog, nodes) => (Array.isArray(nodes) ? nodes : [])
  .filter((n) => n && typeof n.part === 'string' && catalog.get(n.part))
  .map((n) => ({ ...n, ...(n.children && { children: clean(catalog, n.children) }) }))

/** llm({ instructions?, model?, sink? }): the chat-LLM backend (structured output, streamed preview) */
export function llm({ instructions = INSTRUCTIONS, sink = 'LLM', key = 'compose', stream = true, ...rest } = {}) {
  return {
    sink,
    kind: 'llm',
    start({ catalog, state, prompt, previous, names }) {
      const current = previous ? `\n\nThe page now (edit it; keep what the request does not change):\n${JSON.stringify({ page: toTree(previous) })}` : ''
      const request = {
        ...rest,
        instructions: `${instructions}\n\nCatalog:\n${JSON.stringify(catalog.describe(state))}`,
        messages: [{ role: 'user', content: prompt + current }],
        output: jsonSchema(layoutSchema(catalog, state)),
        key,
        ok: names.ok,
        error: names.error,
        ...(stream && names.delta && { delta: names.delta }),
      }
      return { request, pending: { step: 'llm', prompt, edit: !!previous } }
    },
    reply({ catalog, reply }) {
      return { layout: fromTree(catalog, clean(catalog, reply.value?.page)), decisions: { llm: reply.value } }
    },
    delta({ catalog, delta }) {
      const v = parsePartial(delta.text || '')
      return v?.page ? { preview: fromTree(catalog, clean(catalog, v.page)) } : {}
    },
  }
}
