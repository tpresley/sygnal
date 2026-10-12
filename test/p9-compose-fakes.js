// PLAN-9 (A): minimal fake backends on the contract's Backend interface, for the compose behavior's
// contract suite (p9-compose-behavior); the real `compose.decisions()` / `compose.llm()` run in
// p9-compose-matrix. Not a test file (no .test.js): imported by the suites.
//
// - fakeDecisions(): decide() requests on HTTP, two steps: select (use_<option>), then, when 2+
//   parts or an enum param, layout (place_<option>, pairwise above_<a>__<b>, param_<option>__<name>);
//   a preview after the select step. fake() inverts both steps (answers()).
// - fakeLlm(): one chat request on LLM, streamed: each delta previews the complete nodes so far;
//   the reply's text is `{ "page": Tree }`. fake() is that JSON.
import { decide, choice, answers } from '../src/extra/ai/index.ts'
import { fromTree } from '../src/extra/ai/compose/layout.ts'

const qn = (s) => String(s).replace(/\W/g, '_')
const llmOnly = (p) => Object.values(p.params).some((d) => (d.kind === 'text' || d.kind === 'list') && d.required && d.default === undefined)
const enumParams = (p) => Object.keys(p.params).filter((k) => p.params[k].kind === 'options')
/** the places a part may be put by this fake: the page, a row, or a container's slot */
const placesOf = (catalog) => ['page', 'row', ...Object.values(catalog.containers).filter((c) => c.id !== 'page' && c.id !== 'row').flatMap((c) => c.slotNames.map((s) => `${c.id}:${s}`))]

function selectQuestions(catalog, state) {
  const q = {}
  for (const o of catalog.options(state)) {
    if (llmOnly(catalog.get(o.part))) continue
    q[`use_${qn(o.option)}`] = choice('Does user_request ask for this element?', { omit: 'Not needed.', use: o.description })
  }
  return q
}

function layoutQuestions(catalog, chosen) {
  const q = {}, places = placesOf(catalog)
  for (const o of chosen) q[`place_${qn(o.option)}`] = choice(`Where does this go: ${o.description}?`, Object.fromEntries(places.map((p) => [p, null])))
  chosen.forEach((a, i) => chosen.slice(i + 1).forEach((b) => {
    q[`above_${qn(a.option)}__${qn(b.option)}`] = choice('Which comes first?', { a: a.description, b: b.description })
  }))
  for (const o of chosen) {
    const p = catalog.get(o.part)
    for (const k of enumParams(p)) q[`param_${qn(o.option)}__${k}`] = choice(`${k} for ${o.description}`, Object.fromEntries(Object.keys(p.params[k].options).map((v) => [v, p.params[k].options[v]])))
  }
  return q
}

/** a target tree's leaves, in order, with their place and params */
function leaves(catalog, tree, place = 'page', out = []) {
  for (const n of tree) {
    const e = catalog.get(n.part)
    if (e?.kind === 'container') {
      const ch = n.children || []
      if (Array.isArray(ch)) leaves(catalog, ch, n.part === 'row' ? (place === 'page' ? 'row' : place) : `${n.part}:${e.slotNames[0]}`, out)
      else for (const s in ch) leaves(catalog, ch[s], `${n.part}:${s}`, out)
    } else if (e) out.push({ option: e.record ? `${n.part}:${n.params?.[e.record]}` : n.part, place, params: n.params || {} })
  }
  return out
}

export function fakeDecisions({ model = 'test-model', sink = 'HTTP' } = {}) {
  const req = (names, state, questions) => decide({ url: '/api/decide', model, state, questions, key: names.key, latest: true, ok: names.ok, error: names.error })
  return {
    sink,
    start({ catalog, state, prompt, previous, names }) {
      return { request: req(names, { user_request: prompt, ...(previous && { current_page: Object.keys(previous.nodes) }) }, selectQuestions(catalog, state)), pending: { step: 'select', prompt } }
    },
    reply({ catalog, state, pending, reply, names }) {
      const a = reply?.answers || {}
      if (pending.step === 'select') {
        const chosen = catalog.options(state).filter((o) => a[`use_${qn(o.option)}`]?.choice === 'use').map(({ option, part, params, description }) => ({ option, part, params, description }))
        if (!chosen.length) return { layout: null, unavailable: true, decisions: { select: a } }
        const preview = catalog.finish(fromTree(catalog, chosen.map((o) => ({ part: o.part, params: o.params }))), state)
        if (chosen.length === 1 && !enumParams(catalog.get(chosen[0].part)).length) return { layout: preview, decisions: { select: a } }
        return { preview, pending: { step: 'layout', prompt: pending.prompt, chosen, select: a }, decisions: { select: a },
          request: req(names, { user_request: pending.prompt }, layoutQuestions(catalog, chosen)) }
      }
      const { chosen } = pending
      const wins = Object.fromEntries(chosen.map((o) => [o.option, 0]))
      chosen.forEach((x, i) => chosen.slice(i + 1).forEach((y) => {
        const c = a[`above_${qn(x.option)}__${qn(y.option)}`]?.choice
        if (c === 'a') wins[x.option]++
        else if (c === 'b') wins[y.option]++
      }))
      const order = [...chosen].sort((x, y) => wins[y.option] - wins[x.option] || chosen.indexOf(x) - chosen.indexOf(y))
      const leaf = (o) => {
        const params = { ...o.params }
        for (const k of enumParams(catalog.get(o.part))) { const v = a[`param_${qn(o.option)}__${k}`]?.choice; if (v !== undefined) params[k] = v }
        return { part: o.part, params }
      }
      const where = (o) => a[`place_${qn(o.option)}`]?.choice || 'page'
      const tree = [], groups = new Map()
      for (const o of order) {
        const w = where(o)
        if (w === 'page') { tree.push(leaf(o)); continue }
        const [c, s = 'default'] = w.split(':')
        let g = groups.get(c)
        if (!g) { g = { part: c, children: {} }; groups.set(c, g); tree.push(g) }
        ;(g.children[s] ||= []).push(leaf(o))
      }
      return { layout: catalog.finish(fromTree(catalog, tree), state), decisions: { select: pending.select, layout: a } }
    },
    fake({ catalog, state, pending, target }) {
      const ls = leaves(catalog, target)
      const by = Object.fromEntries(ls.map((l, i) => [qn(l.option), { ...l, i }]))
      if (pending.step === 'select') {
        const q = selectQuestions(catalog, state), picks = {}
        for (const name in q) picks[name] = by[name.slice(4)] ? 'use' : 'omit'
        return answers(q, picks)
      }
      const q = layoutQuestions(catalog, pending.chosen), picks = {}
      for (const name in q) {
        let m
        if ((m = /^place_(.+)$/.exec(name))) picks[name] = by[m[1]]?.place ?? 'page'
        else if ((m = /^above_(.+)__(.+)$/.exec(name))) picks[name] = (by[m[1]]?.i ?? 0) <= (by[m[2]]?.i ?? 0) ? 'a' : 'b'
        else if ((m = /^param_(.+)__(.+)$/.exec(name))) {
          const l = by[m[1]], o = pending.chosen.find((x) => qn(x.option) === m[1])
          picks[name] = String(l?.params?.[m[2]] ?? catalog.get(o.part).params[m[2]].default)
        }
      }
      return answers(q, picks)
    },
  }
}

/** close what a streamed JSON prefix left open (the prototype's parsePartial) */
export function parsePartial(text) {
  let s = text.trim()
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

// a streamed tree may end in a half-written node: keep the ones with a known part
const complete = (catalog, nodes) => (Array.isArray(nodes) ? nodes : [])
  .filter((n) => n && typeof n.part === 'string' && catalog.get(n.part))
  .map((n) => ({ ...n, ...(Array.isArray(n.children) && { children: complete(catalog, n.children) }) }))

export function fakeLlm({ model = 'test-llm', sink = 'LLM' } = {}) {
  return {
    sink,
    start({ prompt, previous, names }) {
      const content = prompt + (previous ? `\n\nThe page now: ${JSON.stringify(Object.keys(previous.nodes))}` : '')
      return { request: { model, messages: [{ role: 'user', content }], key: names.key, latest: true, ok: names.ok, error: names.error, delta: names.delta }, pending: { step: 'llm', prompt } }
    },
    reply({ catalog, state, reply }) {
      const v = JSON.parse(reply.text)
      if (!Array.isArray(v?.page)) throw new Error('the reply is not a { page } tree')
      if (!v.page.length) return { layout: null, unavailable: true, decisions: v }
      return { layout: catalog.finish(fromTree(catalog, v.page), state), decisions: v }
    },
    delta({ catalog, state, delta }) {
      const v = parsePartial(delta.text || '')
      const page = complete(catalog, v?.page)
      return page.length ? { preview: catalog.finish(fromTree(catalog, page), state) } : {}
    },
    fake: ({ target }) => JSON.stringify({ page: target }),
  }
}

/** the page top to bottom: 'key' or 'part(child,child)' */
export const shape = (layout, key = layout.root) => Object.values(layout.nodes[key].slots || {}).flat().map((k) => {
  const n = layout.nodes[k]
  return n.slots ? `${k}(${shape(layout, k).join(',')})` : k
})
