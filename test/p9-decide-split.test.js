// @vitest-environment jsdom
// PLAN-9 G-757 / D472: large question sets. decide() turns a set over `maxQuestions` (default 64,
// Ollama's limit) or an estimated `maxPromptTokens` into a fetch-driver batch: sub-requests in
// parallel, their replies merged into one (`answers` by name, `usage` summed, `model` kept). Every
// decide() request can also be halved when a server rejects it as too large (HTTP 400/413 naming
// tokens / fields / a limit), at most 3 deep. The app never sees the split; renderComponent's HTTP
// fake answers such a request as one. compose.decisions() passes the options through.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { decide, choice, noul } from '../src/extra/ai/index.js'
import { splitQuestions, promptTokens, combineDecisions, splitDecision } from '../src/extra/ai/decide.js'
import { answers } from '../src/extra/ai/answers.js'
import { decisions } from '../src/extra/ai/compose/decisions.js'
import { toTree } from '../src/extra/ai/compose/layout'
import { STRUCTURE } from './p9-decisions-catalogs.js'

let t
afterEach(() => { t?.dispose(); t = undefined })

const qs = (n, words = 1) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i}`, choice('word '.repeat(words), { a: 'A', b: 'B' })]))
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** a decision server: answers every question 'a'; `max`: rejects more questions like Ollama does */
function server({ max = Infinity, status = 400, error = 'prompt 0 has 8686 tokens; expected 1–8192 (input is never truncated)', delay = 0 } = {}) {
  const calls = []
  const fetch = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body)
    const names = Array.isArray(body.questions) ? body.questions.map((q) => q.name) : Object.keys(body.questions)
    calls.push(names)
    if (delay) await new Promise((r) => setTimeout(r, delay))
    if (names.length > max) return json({ error }, status)
    return json({ model: body.model, answers: Object.fromEntries(names.map((n) => [n, { type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.1 }, confidence: 0.5 }])), usage: { input_tokens: 10 * names.length, output_tokens: 0 } })
  })
  return { fetch, calls }
}
function App(request) {
  function C({ state }) { return h('p', null, state.n ?? '…') }
  C.initialState = {}
  C.model = {
    BOOTSTRAP: { HTTP: () => ({ ...request, ok: 'DONE', error: 'FAILED' }) },
    DONE: (s, d) => ({ ...s, d, n: Object.keys(d.answers).length }),
    FAILED: (s, d) => ({ ...s, failed: d }),
  }
  return C
}

describe('splitQuestions(): parts within maxQuestions and the token estimate', () => {
  it('at the question limit: one part; one over: two even parts; three of 43', () => {
    expect(splitQuestions('x', qs(64), 64)).toEqual([Object.keys(qs(64))])
    const two = splitQuestions('x', qs(65), 64)
    expect(two.map((p) => p.length).sort()).toEqual([32, 33])
    expect(two.flat()).toEqual(Object.keys(qs(65)))
    expect(splitQuestions('x', qs(129), 64).map((p) => p.length)).toEqual([43, 43, 43])
    expect(splitQuestions('x', qs(500))).toHaveLength(1)
  })
  it('by the estimate: the fewest parts that fit, in order; a question too large alone goes alone', () => {
    const q = qs(40, 100)
    const whole = promptTokens('x', q)
    expect(splitQuestions('x', q, 64, whole)).toHaveLength(1)
    const parts = splitQuestions('x', q, 64, Math.ceil(whole / 2.5))
    expect(parts).toHaveLength(3)
    expect(parts.flat()).toEqual(Object.keys(q))
    for (const p of parts) expect(promptTokens('x', Object.fromEntries(p.map((n) => [n, q[n]])))).toBeLessThanOrEqual(Math.ceil(whole / 2.5))
    const big = { a: noul('word '.repeat(5000)), b: noul('x'), c: noul('y') }
    expect(splitQuestions('x', big, 64, 1000)[0]).toEqual(['a'])
  })
  it('the estimate stays above what nimble counted (8,735 tokens for a 55-question layout step; measured 1.13–1.30 ×)', () => {
    const b = decisions({ model: 'nimble', profile: 'small' })
    const names = { ok: 'page.REPLY', error: 'page.FAILED', key: 'compose' }
    const D = STRUCTURE.dashboard.catalog
    const s = b.start({ catalog: D, state: {}, prompt: 'KPIs in a row (revenue, signups and churn), then the revenue chart and the orders table side by side', previous: null, names })
    const sel = b.reply({ catalog: D, state: {}, pending: s.pending, names, reply: answers(s.request.json.questions, { use_revenue: 'use', use_signups: 'use', use_churn: 'use', use_revenueChart: 'use', use_orders: 'use', row: true }) })
    expect(Object.keys(sel.request.json.questions)).toHaveLength(55)
    expect(promptTokens(sel.request.json.state, sel.request.json.questions)).toBeGreaterThan(8735 * 1.1)
  })
})

describe('decide(): the request', () => {
  it('64 questions: the one request as before (+ combine / split for the reactive fallback); 65: a batch of two, json still the whole', () => {
    const r = decide({ model: 'm', state: 's', questions: qs(64), headers: { authorization: 'Bearer k' } })
    expect(r.batch).toBeUndefined()
    expect(r.json).toEqual({ model: 'm', state: 's', questions: qs(64) })
    expect(r.combine).toBe(combineDecisions)
    expect(r.split).toBe(splitDecision)
    const b = decide({ model: 'm', state: 's', questions: qs(65), ok: 'X' })
    expect(b.json.questions).toEqual(qs(65))
    expect(b.batch).toHaveLength(2)
    expect(b.batch[0]).toEqual({ url: '/api/decide', method: 'POST', json: { model: 'm', state: 's', questions: Object.fromEntries(Object.entries(qs(65)).slice(0, 33)) } })
    expect(b.ok).toBe('X')
  })
  it('maxQuestions / maxPromptTokens set the limits; split: false sends the whole set as one request', () => {
    expect(decide({ model: 'm', state: 's', questions: qs(10), maxQuestions: 4 }).batch.map((q) => Object.keys(q.json.questions).length)).toEqual([4, 3, 3])
    expect(decide({ model: 'm', state: 's', questions: qs(10, 50), maxPromptTokens: 400 }).batch.length).toBeGreaterThan(1)
    const off = decide({ model: 'm', state: 's', questions: qs(100), split: false })
    expect(off).toEqual({ url: '/api/decide', method: 'POST', json: { model: 'm', state: 's', questions: qs(100) } })
  })
  it('decide.openai(): parts in its array form, each with its parse', () => {
    const b = decide.openai({ model: 'm', state: 's', questions: qs(5), maxQuestions: 2 })
    expect(b.batch.map((q) => q.json.questions.map((x) => x.name))).toEqual([['q0', 'q1'], ['q2', 'q3'], ['q4']])
    expect(typeof b.batch[0].parse).toBe('function')
  })
  it('combineDecisions: answers by name, usage summed (nested too), model of the first; one body as is', () => {
    const one = { model: 'm', answers: { a: 1 } }
    expect(combineDecisions([one])).toBe(one)
    expect(combineDecisions([{ model: 'm', answers: { a: 1 }, usage: { input_tokens: 3, output_tokens: 1, details: { cached: 1 } } }, { model: 'n', answers: { b: 2 }, usage: { input_tokens: 4, output_tokens: 0, details: { cached: 2 } } }]))
      .toEqual({ model: 'm', answers: { a: 1, b: 2 }, usage: { input_tokens: 7, output_tokens: 1, details: { cached: 3 } } })
  })
  it('splitDecision: halves on 400 / 413 naming a size limit; null otherwise', () => {
    const r = decide({ model: 'm', state: 's', questions: qs(5) })
    const e = (status, body) => Object.assign(new Error('x'), { status, body })
    expect(splitDecision(r, e(400, { error: 'questions must contain 1–64 fields' })).map((q) => Object.keys(q.json.questions))).toEqual([['q0', 'q1'], ['q2', 'q3', 'q4']])
    expect(splitDecision(r, e(413, 'Payload Too Large'))).toHaveLength(2)
    expect(splitDecision(r, e(400, { error: 'unknown model' }))).toBeNull()
    expect(splitDecision(r, e(500, { error: 'too many tokens' }))).toBeNull()
    expect(splitDecision(decide({ model: 'm', state: 's', questions: qs(1) }), e(400, 'too many tokens'))).toBeNull()
  })
})

describe('makeFetchDriver: batch / split requests (one reply)', () => {
  it('a 130-question decide(): 3 sub-requests in parallel (headers kept), one merged reply to the ok action', async () => {
    const s = server({ delay: 5 })
    t = renderComponent(App(decide({ model: 'nimble', state: 's', questions: qs(130), headers: { authorization: 'Bearer k' } })), { drivers: { HTTP: makeFetchDriver({ fetch: s.fetch }) } })
    await t.ready()
    // all three sent before any answered
    expect(s.fetch).toHaveBeenCalledTimes(3)
    await t.waitForState((st) => st.n)
    expect(t.state.n).toBe(130)
    expect(t.state.d.usage).toEqual({ input_tokens: 1300, output_tokens: 0 })
    expect(t.state.d.model).toBe('nimble')
    for (const [, init] of s.fetch.mock.calls) expect(init.headers.authorization).toBe('Bearer k')
  })
  it('reactive: a part the server rejects as too large is halved (Ollama\'s 8192-token 400), up to 3 deep', async () => {
    const s = server({ max: 10 })
    t = renderComponent(App(decide({ model: 'nimble', state: 's', questions: qs(40) })), { drivers: { HTTP: makeFetchDriver({ fetch: s.fetch }) } })
    await t.waitForState((st) => st.n)
    expect(t.state.n).toBe(40)
    expect(s.calls.map((c) => c.length)).toEqual([40, 20, 20, 10, 10, 10, 10])
    expect(t.state.d.usage.input_tokens).toBe(400)
  })
  it('past 3 halvings, or an error that isn\'t about size: the error action once, with status and body', async () => {
    const s = server({ max: 1 })
    t = renderComponent(App(decide({ model: 'nimble', state: 's', questions: qs(20) })), { drivers: { HTTP: makeFetchDriver({ fetch: s.fetch }) } })
    await t.waitForState((st) => st.failed)
    expect(t.state.failed.status).toBe(400)
    expect(t.state.failed.body.error).toMatch(/tokens/)
    expect(Math.max(...s.calls.map((c) => c.length))).toBe(20)
    expect(Math.min(...s.calls.map((c) => c.length))).toBe(2) // 20 → 10 → 5 → 2/3, then no more
    t.dispose()
    const u = server({ max: 1, error: 'unknown model' })
    t = renderComponent(App(decide({ model: 'nimble', state: 's', questions: qs(20) })), { drivers: { HTTP: makeFetchDriver({ fetch: u.fetch }) } })
    await t.waitForState((st) => st.failed)
    expect(u.calls).toHaveLength(1)
    t.dispose()
    // a batch part failing: one error, the others' replies dropped
    const v = server({ max: 30, status: 500, error: 'boom' })
    t = renderComponent(App(decide({ model: 'nimble', state: 's', questions: qs(100), maxQuestions: 50 })), { drivers: { HTTP: makeFetchDriver({ fetch: v.fetch }) } })
    await t.waitForState((st) => st.failed)
    expect(t.state.failed.status).toBe(500)
    expect(t.state.n).toBeUndefined()
  })
  it('a plain request (no batch / split) is fetched exactly as before', async () => {
    const s = server()
    t = renderComponent(App(decide({ model: 'jev-latest', state: 's', questions: qs(51), split: false })), { drivers: { HTTP: makeFetchDriver({ fetch: s.fetch }) } })
    await t.waitForState((st) => st.n)
    expect(s.calls.map((c) => c.length)).toEqual([51])
  })
})

describe('renderComponent: a split decide() is one request, answered as one', () => {
  it('t.requests lists the whole request; t.respond(answers(questions, picks)) answers it', async () => {
    const questions = qs(100)
    t = renderComponent(App(decide({ model: 'nimble', state: 's', questions })))
    await t.ready()
    const [req] = t.requests('HTTP')
    expect(Object.keys(req.json.questions)).toHaveLength(100)
    await t.respond('HTTP', answers(req.json.questions, { q99: 'b' }), 'DONE')
    expect(t.state.n).toBe(100)
    expect(t.state.d.answers.q99.choice).toBe('b')
  })
})

describe('compose.decisions(): the options reach decide(); round trips unchanged', () => {
  it('a 7-element layout step on profile small (112 questions) goes as a batch of parts ≤ 64; its json is the whole step', () => {
    const b = decisions({ model: 'nimble', profile: 'small', url: 'http://localhost:11434/v1/systemone' })
    const D = STRUCTURE.dashboard.catalog
    const names = { ok: 'page.REPLY', error: 'page.FAILED', key: 'compose' }
    const prompt = 'Revenue, signups and churn in a row, then the revenue chart beside the orders table, then open tickets and my tasks side by side'
    const s = b.start({ catalog: D, state: {}, prompt, previous: null, names })
    expect(s.request.batch).toBeUndefined()
    const sel = b.reply({ catalog: D, state: {}, pending: s.pending, names, reply: answers(s.request.json.questions, { use_revenue: 'use', use_signups: 'use', use_churn: 'use', use_revenueChart: 'use', use_orders: 'use', use_tickets: 'use', use_tasks: 'use', row: true }) })
    const all = Object.keys(sel.request.json.questions)
    expect(all).toHaveLength(112)
    expect(sel.request.batch.map((q) => Object.keys(q.json.questions).length)).toEqual([56, 56])
    expect(sel.request.batch.flatMap((q) => Object.keys(q.json.questions))).toEqual(all)
    // the merged reply reads as the whole one
    const want = [{ part: 'row', children: [{ part: 'revenue' }, { part: 'signups' }, { part: 'churn' }] }, { part: 'row', children: [{ part: 'revenueChart' }, { part: 'orders' }] }, { part: 'row', children: [{ part: 'tickets' }, { part: 'tasks' }] }]
    const whole = b.fake({ catalog: D, state: {}, pending: sel.pending, target: want })
    const parts = sel.request.batch.map((q) => ({ model: 'nimble', answers: Object.fromEntries(Object.keys(q.json.questions).map((n) => [n, whole.answers[n]])) }))
    const out = b.reply({ catalog: D, state: {}, pending: sel.pending, names, reply: sel.request.combine(parts) })
    expect(toTree(out.layout)).toEqual(want)
    // options pass through
    const off = decisions({ model: 'x', split: false }).start({ catalog: D, state: {}, prompt, previous: null, names })
    expect(off.request.split).toBeUndefined()
    const few = decisions({ model: 'x', maxQuestions: 3 }).start({ catalog: D, state: {}, prompt, previous: null, names })
    expect(few.request.batch.length).toBeGreaterThan(1)
  })
})
