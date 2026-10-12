// PLAN-9 G-757: compose.decisions() splits a step over the backend's per-request limits into
// several decide() requests (Ollama's /v1/systemone: at most 64 questions, and each question's
// prompt — the state plus ALL the request's questions — within num_ctx, nimble 8192 tokens). The
// parts' answers are merged before reading, so a split step reads as the whole one; fake() answers
// each part; other servers (no Ollama url, no option) get the one request they always got.
import { describe, it, expect } from 'vitest'
import { decisions, splitStep, promptTokens, editLeaves, OLLAMA_MAX_QUESTIONS, OLLAMA_MAX_PROMPT_TOKENS } from '../src/extra/ai/compose/decisions.js'
import { finish, fromTree, toTree } from '../src/extra/ai/compose/layout'
import { choice, noul } from '../src/extra/ai/decide'
import { answers } from '../src/extra/ai/answers'
import { STRUCTURE, OPS, SHOP } from './p9-decisions-catalogs.js'
import { formatTree } from './p9-decisions-helpers.js'
import { rng, randomTarget, pickOne } from './p9-decisions-random.js'

const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
const json = (x) => JSON.parse(JSON.stringify(x))
const OLLAMA = 'http://localhost:11434/v1/systemone'
const DASH = STRUCTURE.dashboard.catalog
const layoutOf = (catalog, tree, previous) => finish(catalog, fromTree(catalog, tree, previous), {})

/** start → (fake → reply)*: every request and the result */
function trip(backend, catalog, prompt, target, previous = null) {
  let r = backend.start({ catalog, state: {}, prompt, previous, names })
  const requests = [r.request]
  let pending = json(r.pending)
  for (;;) {
    const reply = backend.fake({ catalog, state: {}, pending, target })
    const out = backend.reply({ catalog, state: {}, pending, reply, names })
    if (!out.request) return { out, requests }
    requests.push(out.request)
    pending = json(out.pending)
  }
}
const within = (requests, maxQ, maxT) => {
  for (const req of requests) {
    expect(Object.keys(req.json.questions).length).toBeLessThanOrEqual(maxQ)
    expect(promptTokens(req.json.state, req.json.questions)).toBeLessThanOrEqual(maxT)
  }
}
/** the 7-element dashboard prompt: 112 layout questions under profile 'small' */
const SEVEN = 'Revenue, signups and churn in a row, then the revenue chart beside the orders table, then open tickets and my tasks side by side'
const SEVEN_WANT = [
  { part: 'row', children: [{ part: 'revenue' }, { part: 'signups' }, { part: 'churn' }] },
  { part: 'row', children: [{ part: 'revenueChart' }, { part: 'orders' }] },
  { part: 'row', children: [{ part: 'tickets' }, { part: 'tasks' }] },
]
const SEL7 = { use_revenue: 'use', use_signups: 'use', use_churn: 'use', use_revenueChart: 'use', use_orders: 'use', use_tickets: 'use', use_tasks: 'use', row: true }

describe('splitStep(): a step in requests within maxQuestions and the prompt-token estimate', () => {
  const step = (n, words = 1) => ({ state: { user_request: 'x' }, questions: Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i}`, choice('word '.repeat(words), { a: 'A', b: 'B' })])) })
  it('at the question limit: one part; one over: two even parts', () => {
    expect(splitStep(step(64), 64)).toEqual([Object.keys(step(64).questions)])
    const two = splitStep(step(65), 64)
    expect(two).toHaveLength(2)
    expect(two.flat()).toEqual(Object.keys(step(65).questions))
    expect(Math.abs(two[0].length - two[1].length)).toBeLessThanOrEqual(1)
    expect(splitStep(step(129), 64).map((p) => p.length)).toEqual([43, 43, 43])
    expect(splitStep(step(10))).toHaveLength(1) // no limits: never split
  })
  it('by the token estimate: the fewest parts that fit, in question order; a question too large alone goes alone', () => {
    const s = step(40, 100)
    const whole = promptTokens(s.state, s.questions)
    expect(splitStep(s, 64, whole)).toHaveLength(1)
    const parts = splitStep(s, 64, Math.ceil(whole / 2.5))
    expect(parts.length).toBe(3)
    expect(parts.flat()).toEqual(Object.keys(s.questions))
    for (const p of parts) expect(promptTokens(s.state, Object.fromEntries(p.map((n) => [n, s.questions[n]])))).toBeLessThanOrEqual(Math.ceil(whole / 2.5))
    const big = { state: {}, questions: { a: noul('word '.repeat(5000)), b: noul('x'), c: noul('y') } }
    const split = splitStep(big, 64, 1000)
    expect(split.flat()).toEqual(['a', 'b', 'c'])
    expect(split[0]).toEqual(['a'])
  })
  it('the estimate is above what nimble counted for these requests (measured: 1.13–1.30 ×)', () => {
    // the dashboard layout step with 5 row-able elements (55 questions): Ollama said 8,735 tokens
    const b = decisions({ model: 'nimble', profile: 'small' })
    const s = b.start({ catalog: DASH, state: {}, prompt: 'KPIs in a row (revenue, signups and churn), then the revenue chart and the orders table side by side', previous: null, names })
    const sel = b.reply({ catalog: DASH, state: {}, pending: s.pending, names, reply: answers(s.request.json.questions, { use_revenue: 'use', use_signups: 'use', use_churn: 'use', use_revenueChart: 'use', use_orders: 'use', row: true }) })
    expect(Object.keys(sel.request.json.questions)).toHaveLength(55)
    expect(promptTokens(sel.request.json.state, sel.request.json.questions)).toBeGreaterThan(8735 * 1.1)
  })
})

describe('compose.decisions(): steps over the per-request limits', () => {
  it('an Ollama url: the 7-element layout step (112 questions, ~16k tokens) goes as several requests within 64 questions and the budget', () => {
    const b = decisions({ model: 'nimble', profile: 'small', url: OLLAMA })
    const r = trip(b, DASH, SEVEN, SEVEN_WANT)
    expect(r.requests.length).toBeGreaterThan(3)
    within(r.requests, OLLAMA_MAX_QUESTIONS, OLLAMA_MAX_PROMPT_TOKENS)
    expect(toTree(r.out.layout)).toEqual(SEVEN_WANT)
    // the parts together are the whole step's questions, once each
    const whole = decisions({ model: 'nimble', profile: 'small' })
    const w = trip(whole, DASH, SEVEN, SEVEN_WANT)
    expect(w.requests).toHaveLength(2)
    const layoutQs = Object.keys(w.requests[1].json.questions)
    expect(layoutQs).toHaveLength(112)
    expect(r.requests.slice(1).flatMap((q) => Object.keys(q.json.questions))).toEqual(layoutQs)
    for (const q of r.requests.slice(1)) expect(q.json.state).toEqual(w.requests[1].json.state)
  })

  it('no Ollama url and no option: one request per step, exactly as before (Jev); pending has no split fields', () => {
    const b = decisions({ model: 'jev-latest', profile: 'small', url: 'https://api.typesafe.ai/v1/systemone' })
    const s = b.start({ catalog: DASH, state: {}, prompt: SEVEN, previous: null, names })
    const sel = b.reply({ catalog: DASH, state: {}, pending: s.pending, names, reply: answers(s.request.json.questions, SEL7) })
    expect(Object.keys(sel.request.json.questions)).toHaveLength(112)
    expect(sel.pending.part).toBeUndefined()
    expect(sel.pending.got).toBeUndefined()
  })

  it('the parts\' answers are merged before reading: the same layout as the same answers in one request', () => {
    const opts = { model: 'nimble', profile: 'small' }
    const one = decisions(opts), split = decisions({ ...opts, maxQuestions: 30 })
    const s1 = one.start({ catalog: DASH, state: {}, prompt: SEVEN, previous: null, names })
    const l1 = one.reply({ catalog: DASH, state: {}, pending: s1.pending, names, reply: answers(s1.request.json.questions, SEL7) })
    const all = l1.request.json.questions
    // a model's answers (made up, not the target): earlier-named first, rows by beside/same
    const r = rng(7)
    const picks = Object.fromEntries(Object.entries(all).map(([n, q]) => [n, q.type === 'noul' ? r() : { probabilities: Object.fromEntries(Object.keys(q.criteria).map((k) => [k, r()])) }]))
    const want = one.reply({ catalog: DASH, state: {}, pending: json(l1.pending), names, reply: answers(all, picks) })
    const s2 = split.start({ catalog: DASH, state: {}, prompt: SEVEN, previous: null, names })
    let out = split.reply({ catalog: DASH, state: {}, pending: s2.pending, names, reply: answers(s2.request.json.questions, SEL7) })
    let n = 0
    const preview = out.preview
    while (out.request) {
      const qs = out.request.json.questions
      expect(Object.keys(qs).length).toBeLessThanOrEqual(30)
      n++
      const prev = json(out.pending)
      out = split.reply({ catalog: DASH, state: {}, pending: prev, names, reply: answers(qs, Object.fromEntries(Object.keys(qs).map((k) => [k, picks[k]]))) })
      // a part in between: the next request, no preview (the select step's preview stays shown), no decisions yet
      if (out.request) { expect(out.preview).toBeUndefined(); expect(out.decisions).toBeUndefined(); expect(out.pending.part).toBe(prev.part === undefined ? 1 : prev.part + 1) }
    }
    expect(preview).toBeTruthy()
    expect(n).toBe(4)
    expect(toTree(out.layout)).toEqual(toTree(want.layout))
    expect(out.decisions.layout).toEqual(want.decisions.layout)
  })

  it('a part\'s reply with no answers: the step fails as before', () => {
    const b = decisions({ model: 'nimble', profile: 'small', maxQuestions: 30 })
    const s = b.start({ catalog: DASH, state: {}, prompt: SEVEN, previous: null, names })
    const l = b.reply({ catalog: DASH, state: {}, pending: s.pending, names, reply: answers(s.request.json.questions, SEL7) })
    expect(b.reply({ catalog: DASH, state: {}, pending: json(l.pending), names, reply: { nope: 1 } }).error).toMatch(/no answers/)
  })

  it('small limits on the research catalogs: random compositions and edits round-trip through fake(), every request within them', () => {
    const maxQ = 6, maxT = 1500
    const b = decisions({ model: 'test', profile: 'small', maxQuestions: maxQ, maxPromptTokens: maxT })
    const all = [...Object.values(STRUCTURE).map((s) => [s.id, s.catalog]), ['ops', OPS], ['shop', SHOP]]
    let split = 0
    for (const [id, catalog] of all) {
      const r = rng(id.length * 17)
      for (let i = 0; i < 15; i++) {
        const { target, prompt } = randomTarget(catalog, r, { maxLeaves: 5 })
        const want = layoutOf(catalog, target)
        const first = trip(b, catalog, prompt, target)
        if (!first.out.layout) continue
        // a question alone may be over the token budget (a long select choice): only the count is strict
        for (const req of first.requests) expect(Object.keys(req.json.questions).length).toBeLessThanOrEqual(maxQ)
        if (first.requests.length > 3) split++
        expect(formatTree(toTree(first.out.layout)), `${id} #${i}`).toBe(formatTree(toTree(want)))
        const leaves = editLeaves(catalog, want, {})
        if (leaves.length < 2) continue
        const drop = pickOne(r, leaves).key
        const edited = toTree(finish(catalog, { ...want, nodes: Object.fromEntries(Object.entries(want.nodes).map(([k, n]) => [k, n.slots ? { ...n, slots: Object.fromEntries(Object.entries(n.slots).map(([s, l]) => [s, l.filter((x) => x !== drop)])) } : n]).filter(([k]) => k !== drop)) }, {}))
        if (formatTree(edited) === formatTree(toTree(want))) continue
        const e = trip(b, catalog, prompt, edited, want)
        for (const req of e.requests) expect(Object.keys(req.json.questions).length).toBeLessThanOrEqual(maxQ)
        expect(formatTree(toTree(e.out.layout)), `${id} #${i} edit`).toBe(formatTree(edited))
      }
    }
    expect(split).toBeGreaterThan(20)
  })
})
