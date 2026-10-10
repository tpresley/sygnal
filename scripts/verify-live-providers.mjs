#!/usr/bin/env node
/*
 * PLAN-6 G-621 / G-636 (and G-635): verify sygnal/ai's provider mappings against the live APIs.
 * Opt-in, run by the maintainer from their own terminal with their own keys; never in CI or
 * `npm test`. Each check costs cents: the script prints an estimate and asks before spending
 * anything (`--yes` skips the question).
 *
 *   npm run build
 *   OPENAI_API_KEY=... ANTHROPIC_API_KEY=... node scripts/verify-live-providers.mjs
 *
 * Keys come from the environment only and are never printed (every line is redacted). A
 * provider whose key is absent is skipped.
 *
 * Checks:
 * - openai-decisions (G-621): decide.openai() against POST /v1/decisions: is the request accepted
 *   (`{ label, description }` levels, predicate criteria in the instructions), and does the reply
 *   match what fromOpenAI() maps (answers array, per-type fields, `usage`)? Mismatches listed.
 * - openai-responses / openai-chat: openResponses() / chatCompletions() with a tiny prompt: text,
 *   start, finish reason and usage as the transports map them.
 * - anthropic-compat (G-635): an `output` schema with keywords outside Anthropic's subset, sent raw
 *   (does the API reject it?) and through anthropicMessages() (its always-on pass: accepted, valid
 *   JSON?); a non-strict tool with the same keywords (does the API take any JSON Schema there?).
 * - anthropic-limits (G-636): the most strict tools, optional parameters and union-typed
 *   parameters one request may carry, by bisection with tiny schemas (a rejected request is a
 *   400 and isn't billed), against the limits anthropicMessages() assumes (20 / 24 / 16).
 *
 * Options: --yes (no question), --dry (no network, no keys: a fake fetch answers like the
 * providers, for the script's own tests), --only=<check,...>, --openai-model=<id> (default
 * $OPENAI_MODEL or gpt-5-mini), --openai-decision-model=<id> (default gpt-6-luna),
 * --anthropic-model=<id> (default $ANTHROPIC_MODEL or claude-opus-5-5).
 * Exit code: 0 when every check that ran matched, 1 when one found a mismatch or failed.
 */
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'

const DIST = new URL('../dist/ai.esm.js', import.meta.url)

// rough upper bounds per check, in USD (OpenAI prices vary by model: a generous rate is assumed)
const CHECKS = {
  'openai-decisions': { provider: 'openai', cost: 0.01, what: 'one decision request (3 questions)' },
  'openai-responses': { provider: 'openai', cost: 0.005, what: 'one tiny Responses request' },
  'openai-chat': { provider: 'openai', cost: 0.005, what: 'one tiny Chat Completions request' },
  'anthropic-compat': { provider: 'anthropic', cost: 0.02, what: 'three tiny Messages requests (one may be a free 400)' },
  'anthropic-limits': { provider: 'anthropic', cost: 0.15, what: 'about 20 tiny Messages requests, bisecting three limits (400s are free)' },
}
const KEYS = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }
const ASSUMED = { tools: 20, optional: 24, unions: 16 }

export function parseArgs(argv) {
  const o = { yes: false, dry: false, only: null }
  for (const a of argv) {
    const [k, v] = a.replace(/^--/, '').split('=')
    if (k == 'yes' || k == 'dry') o[k] = true
    else if (k == 'only') o.only = v.split(',')
    else if (v !== undefined) o[k.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v
    else throw new Error(`unknown option ${a}`)
  }
  return o
}

/** text with the keys (and anything shaped like one) removed */
export const redactor = keys => text => {
  let s = String(text)
  for (const k of keys) if (k) s = s.split(k).join('[redacted]')
  return s.replace(/\b(sk-[A-Za-z0-9_-]{6,}|sk-ant-[A-Za-z0-9_-]{6,})/g, '[redacted]')
}

/** the largest n in [lo, hi] that `ok(n)` accepts (accepted below a limit, rejected above it) */
export async function maxAccepted(ok, lo, hi) {
  if (!(await ok(lo))) return lo - 1
  if (await ok(hi)) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (await ok(mid)) lo = mid
    else hi = mid
  }
  return lo
}

// ---- a fake fetch for --dry: answers like the providers, with the limits ASSUMED ------------

const sseOf = frames => frames.map(([event, data]) => (event ? `event: ${event}\n` : '') + `data: ${typeof data == 'string' ? data : JSON.stringify(data)}\n\n`).join('')
const reply = (status, body, type = 'application/json') => new Response(typeof body == 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } })
const UNSUPPORTED = /"(minLength|maxLength|minimum|maximum|multipleOf|pattern|uniqueItems|maxItems|not)"/

export function dryFetch() {
  const calls = []
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), body })
    if (/\/decisions$/.test(url)) {
      return reply(200, {
        model: body.model,
        answers: body.questions.map(q => q.type == 'predicate' ? { type: 'predicate', name: q.name, probability: 0.12 }
          : q.type == 'choice' ? { type: 'choice', name: q.name, choice: q.choices[0].value, confidence: 0.8, probabilities: q.choices.map((c, i) => ({ value: c.value, probability: i ? 0.1 / (q.choices.length - 1) : 0.9 })) }
          : { type: 'score', name: q.name, score: 1.2, confidence: 0.7, probabilities: q.levels.map((l, i) => ({ value: i, label: l.label, probability: i == 1 ? 0.8 : 0.2 / (q.levels.length - 1) })) }),
        usage: { input_tokens: 120, output_tokens: 9 },
      })
    }
    if (/\/responses$/.test(url)) {
      return reply(200, sseOf([
        ['response.created', { type: 'response.created', response: { id: 'resp_dry', status: 'in_progress' } }],
        ['response.output_text.delta', { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'ok' }],
        ['response.completed', { type: 'response.completed', response: { id: 'resp_dry', status: 'completed', usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14 } } }],
      ]), 'text/event-stream')
    }
    if (/\/chat\/completions$/.test(url)) {
      return reply(200, sseOf([
        [null, { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' } }] }],
        [null, { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }],
        [null, { id: 'c1', choices: [], usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 } }],
        [null, '[DONE]'],
      ]), 'text/event-stream')
    }
    if (/\/messages$/.test(url)) {
      const tools = body.tools || []
      const strict = tools.filter(t => t.strict)
      const props = strict.flatMap(t => Object.entries(t.input_schema.properties || {}).map(([k, p]) => ({ p, req: (t.input_schema.required || []).includes(k) })))
      const err = m => reply(400, { type: 'error', error: { type: 'invalid_request_error', message: m } })
      if (strict.length > ASSUMED.tools) return err(`too many strict tools (${strict.length})`)
      if (props.filter(x => !x.req).length > ASSUMED.optional) return err('too many optional parameters')
      if (props.filter(x => x.p.anyOf).length > ASSUMED.unions) return err('too many union-typed parameters')
      if (body.output_config && UNSUPPORTED.test(JSON.stringify(body.output_config))) return err('output_config.format.schema: unsupported keyword')
      const text = body.output_config ? '{"title":"Hello there","score":0.5,"tags":["a","b"]}' : 'OK'
      const start = { type: 'message_start', message: { id: 'msg_dry', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 1 } } }
      if (body.stream) {
        return reply(200, sseOf([
          ['message_start', start],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } }],
          ['message_stop', { type: 'message_stop' }],
        ]), 'text/event-stream')
      }
      return reply(200, { ...start.message, content: [{ type: 'text', text }], stop_reason: 'end_turn' })
    }
    return reply(404, { error: { message: 'dry: no such route' } })
  }
  return { fetch, calls }
}

// ---- checks ---------------------------------------------------------------------------------

const collect = async (transport, request) => {
  const out = []
  for await (const e of transport.stream(request, new AbortController().signal)) out.push(e)
  return out
}
const isProb = x => typeof x == 'number' && x >= 0 && x <= 1

async function openaiDecisions({ ai, fetch, key, opts }) {
  const { decide, choice, noul, score } = ai
  const questions = {
    spam: noul('Is this message spam?', { true: 'unsolicited advertising', false: 'a real customer request' }),
    topic: choice('What is the message about?', { billing: 'payments, invoices, refunds', bug: 'something is broken', other: null }),
    urgency: score('How urgent is it?', ['can wait a week', 'within a day', 'right now']),
  }
  const req = decide.openai({ url: 'https://api.openai.com/v1/decisions', model: opts.openaiDecisionModel || 'gpt-6-luna', state: 'I was charged twice for my order #1043, please refund one of them today.', questions })
  const res = await fetch(req.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(req.json) })
  const raw = await res.text()
  if (!res.ok) return { ok: false, findings: [`the request was rejected: HTTP ${res.status}: ${raw.slice(0, 400)}`, 'compare the request shape (questions array, levels { label, description }, choices { value, description }) with the API reference'] }
  const reply = JSON.parse(raw)
  const findings = []
  if (!Array.isArray(reply.answers)) findings.push(`no answers array (keys: ${Object.keys(reply).join(', ')})`)
  for (const name of Object.keys(questions)) {
    const a = (reply.answers || []).find(x => x.name == name)
    if (!a) { findings.push(`${name}: no answer`); continue }
    if (a.type == 'refusal') { findings.push(`${name}: refused (${JSON.stringify(a).slice(0, 200)})`); continue }
    const expect = { spam: 'predicate', topic: 'choice', urgency: 'score' }[name]
    if (a.type != expect) findings.push(`${name}: type ${a.type}, mapping expects ${expect}`)
    if (a.type == 'predicate' && !isProb(a.probability)) findings.push(`spam: probability is ${JSON.stringify(a.probability)}`)
    if (a.type == 'choice') {
      if (!['billing', 'bug', 'other'].includes(a.choice)) findings.push(`topic: choice ${JSON.stringify(a.choice)}`)
      if (!Array.isArray(a.probabilities) || !a.probabilities.every(p => 'value' in p && isProb(p.probability))) findings.push(`topic: probabilities ${JSON.stringify(a.probabilities)?.slice(0, 200)} (mapping expects [{ value, probability }])`)
      if (!isProb(a.confidence)) findings.push(`topic: confidence ${JSON.stringify(a.confidence)}`)
    }
    if (a.type == 'score') {
      if (typeof a.score != 'number') findings.push(`urgency: score ${JSON.stringify(a.score)}`)
      if (!Array.isArray(a.probabilities) || !a.probabilities.every(p => 'value' in p && 'label' in p && isProb(p.probability))) findings.push(`urgency: probabilities ${JSON.stringify(a.probabilities)?.slice(0, 200)} (mapping expects [{ value, label, probability }])`)
    }
    const known = { predicate: ['type', 'name', 'probability'], choice: ['type', 'name', 'choice', 'probabilities', 'confidence'], score: ['type', 'name', 'score', 'probabilities', 'confidence'] }[a.type] || []
    const extra = Object.keys(a).filter(k => !known.includes(k))
    if (extra.length) findings.push(`${name}: fields the mapping doesn't read: ${extra.join(', ')}`)
  }
  const usage = reply.usage
  const usageNote = usage ? `usage: ${JSON.stringify(usage)}` : 'usage: absent'
  if (usage && !('input_tokens' in usage && 'output_tokens' in usage)) findings.push(`usage has other keys than input_tokens / output_tokens: ${Object.keys(usage).join(', ')}`)
  const mapped = await req.parse({ json: async () => reply })
  return { ok: !findings.length, findings, notes: [usageNote, `mapped: ${JSON.stringify(mapped.answers).slice(0, 400)}`] }
}

const tiny = { instructions: 'Answer with the single word OK.', messages: [{ role: 'user', parts: [{ type: 'text', text: 'Say OK.' }] }] }

function transportFindings(ev) {
  const findings = []
  const text = ev.filter(e => e.type == 'text').map(e => e.delta).join('')
  const fin = ev.find(e => e.type == 'finish')
  if (!text) findings.push('no text')
  if (!fin) findings.push('no finish event')
  else {
    if (!['stop', 'length'].includes(fin.reason)) findings.push(`finish reason ${fin.reason}`)
    if (!fin.usage || typeof fin.usage.inputTokens != 'number' || typeof fin.usage.outputTokens != 'number') findings.push(`usage ${JSON.stringify(fin.usage)}`)
  }
  return { ok: !findings.length, findings, notes: [`text: ${JSON.stringify(text.slice(0, 80))}`, `finish: ${JSON.stringify(fin)}`, `events: ${ev.map(e => e.type).join(' ')}`] }
}

async function openaiResponses({ ai, fetch, key, opts }) {
  const t = ai.openResponses({ baseURL: 'https://api.openai.com/v1', model: opts.openaiModel, fetch, headers: { authorization: `Bearer ${key}` }, body: { max_output_tokens: 64 } })
  return transportFindings(await collect(t, tiny))
}

async function openaiChat({ ai, fetch, key, opts }) {
  const t = ai.chatCompletions({ baseURL: 'https://api.openai.com/v1', model: opts.openaiModel, fetch, headers: { authorization: `Bearer ${key}` }, body: { max_completion_tokens: 64 } })
  return transportFindings(await collect(t, tiny))
}

const ANTHROPIC = 'https://api.anthropic.com/v1/messages'
const anthropicPost = (fetch, key, body) => fetch(ANTHROPIC, { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key }, body: JSON.stringify(body) })
const say = { role: 'user', content: 'Reply with OK.' }

// keywords outside Anthropic's structured-output subset (platform.claude.com, JSON Schema limitations)
export const WIDE = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 3, maxLength: 40, pattern: '^[A-Z]' },
    score: { type: 'number', minimum: 0, maximum: 1, multipleOf: 0.5 },
    tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4, uniqueItems: true },
  },
  required: ['title', 'score', 'tags'],
  additionalProperties: false,
}

async function anthropicCompat({ ai, fetch, key, opts }) {
  const model = opts.anthropicModel
  const findings = [], notes = []
  const raw = await anthropicPost(fetch, key, { model, max_tokens: 200, messages: [say], output_config: { format: { type: 'json_schema', schema: WIDE } } })
  notes.push(raw.ok ? 'raw schema with unsupported keywords: accepted (the pass is precautionary for this model)' : `raw schema with unsupported keywords: HTTP ${raw.status} ${(await raw.text()).slice(0, 300)} (the pass is needed)`)
  const t = ai.anthropicMessages({ baseURL: 'https://api.anthropic.com/v1', model, fetch, headers: { 'x-api-key': key }, maxTokens: 400 })
  try {
    const ev = await collect(t, { messages: [{ role: 'user', parts: [{ type: 'text', text: 'Give a title, a score and two tags for a blog post about tide pools.' }] }], output: ai.jsonSchema(WIDE) })
    const text = ev.filter(e => e.type == 'text').map(e => e.delta).join('')
    try { notes.push(`through anthropicMessages: ${JSON.stringify(JSON.parse(text))}`) } catch (_) { findings.push(`through anthropicMessages: the reply isn't JSON: ${text.slice(0, 200)}`) }
  } catch (e) {
    findings.push(`through anthropicMessages: ${e.message}`)
  }
  const tool = await anthropicPost(fetch, key, { model, max_tokens: 64, messages: [say], tools: [{ name: 'save_post', description: 'Save a post', input_schema: WIDE }] })
  if (tool.ok) notes.push('a non-strict tool with the same keywords: accepted (input_schema takes any JSON Schema)')
  else findings.push(`a non-strict tool with the same keywords: HTTP ${tool.status} ${(await tool.text()).slice(0, 300)}: anthropicMessages sends non-strict tool schemas as is, so this needs the pass too`)
  return { ok: !findings.length, findings, notes }
}

async function anthropicLimits({ fetch, key, opts }) {
  const model = opts.anthropicModel
  const notes = [], findings = []
  let firstError
  const probe = async tools => {
    const res = await anthropicPost(fetch, key, { model, max_tokens: 16, messages: [say], tools })
    if (res.ok) return true
    const text = await res.text()
    if (res.status != 400) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
    firstError ||= text.slice(0, 300)
    return false
  }
  const strictTool = (name, properties, required) => ({ name, description: 'a probe', strict: true, input_schema: { type: 'object', properties, required, additionalProperties: false } })
  const props = (n, p) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, p]))
  const limits = {
    tools: await maxAccepted(n => probe(Array.from({ length: n }, (_, i) => strictTool(`t${i}`, { a: { type: 'string' } }, ['a']))), 1, 64),
    optional: await maxAccepted(n => probe([strictTool('opt', props(n, { type: 'string' }), [])]), 1, 64),
    unions: await maxAccepted(n => probe([strictTool('uni', props(n, { anyOf: [{ type: 'string' }, { type: 'integer' }] }), Object.keys(props(n)))]), 1, 48),
  }
  for (const k of Object.keys(limits)) {
    const v = limits[k], at = k == 'unions' ? 48 : 64
    notes.push(`${k}: ${v >= at ? `at least ${v}` : v} accepted (anthropicMessages assumes ${ASSUMED[k]})`)
    if (v < ASSUMED[k]) findings.push(`${k}: the API takes only ${v}, anthropicMessages assumes ${ASSUMED[k]}: lower LIMITS in src/extra/ai/transports/anthropicMessages.ts`)
    else if (v > ASSUMED[k]) notes.push(`${k}: the API takes more than assumed; raising LIMITS.${k} to ${v} is safe`)
  }
  if (firstError) notes.push(`a rejection reads: ${firstError}`)
  return { ok: !findings.length, findings, notes, limits }
}

const RUN = { 'openai-decisions': openaiDecisions, 'openai-responses': openaiResponses, 'openai-chat': openaiChat, 'anthropic-compat': anthropicCompat, 'anthropic-limits': anthropicLimits }

// ---- main -------------------------------------------------------------------------------------

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try { return /^y(es)?$/i.test((await rl.question(question)).trim()) } finally { rl.close() }
}

/**
 * Runs the checks; returns { results, exitCode }. Injectable for tests: env, fetch, confirm,
 * log, ai (the sygnal/ai module; default: the built dist/ai.esm.js)
 */
export async function main({ argv = process.argv.slice(2), env = process.env, fetch = globalThis.fetch, confirm = ask, log = console.log, ai } = {}) {
  const opts = parseArgs(argv)
  opts.openaiModel ||= env.OPENAI_MODEL || 'gpt-5-mini'
  opts.anthropicModel ||= env.ANTHROPIC_MODEL || 'claude-opus-5-5'
  const keys = opts.dry ? { openai: 'dry-openai-key', anthropic: 'dry-anthropic-key' } : { openai: env[KEYS.openai], anthropic: env[KEYS.anthropic] }
  const redact = redactor(Object.values(keys))
  const say = (...a) => log(redact(a.join(' ')))
  if (opts.dry) fetch = dryFetch().fetch
  if (!ai) {
    if (!existsSync(DIST)) { say('dist/ai.esm.js is missing: run `npm run build` first'); return { results: {}, exitCode: 1 } }
    ai = await import(DIST.href)
  }
  const names = Object.keys(CHECKS).filter(n => !opts.only || opts.only.includes(n))
  const unknown = (opts.only || []).filter(n => !CHECKS[n])
  if (unknown.length) throw new Error(`unknown check(s): ${unknown.join(', ')} (known: ${Object.keys(CHECKS).join(', ')})`)
  const run = names.filter(n => keys[CHECKS[n].provider])
  for (const n of names.filter(n => !run.includes(n))) say(`skip ${n}: ${KEYS[CHECKS[n].provider]} is not set`)
  if (!run.length) { say('nothing to run'); return { results: {}, exitCode: 0 } }
  const total = run.reduce((s, n) => s + CHECKS[n].cost, 0)
  say(`${opts.dry ? 'DRY RUN (fake fetch, no network, no cost)' : 'LIVE RUN'}: models ${opts.openaiModel} / ${opts.openaiDecisionModel || 'gpt-6-luna'} (OpenAI), ${opts.anthropicModel} (Anthropic)`)
  for (const n of run) say(`  ${n}: ${CHECKS[n].what}, ≈ $${CHECKS[n].cost.toFixed(3)} at most`)
  say(`  estimated total: ≈ $${total.toFixed(2)} at most (rough upper bounds; rejected requests are free)`)
  if (!opts.dry && !opts.yes && !(await confirm('Spend that on these checks? [y/N] '))) { say('cancelled: nothing was sent'); return { results: {}, exitCode: 0 } }
  const results = {}
  for (const n of run) {
    try {
      results[n] = await RUN[n]({ ai, fetch, key: keys[CHECKS[n].provider], opts })
    } catch (e) {
      results[n] = { ok: false, findings: [`failed: ${e.message}`], notes: [] }
    }
    const r = results[n]
    say(`${r.ok ? 'OK  ' : 'MISMATCH'} ${n}`)
    for (const f of r.findings) say(`    ! ${f}`)
    for (const x of r.notes || []) say(`    - ${x}`)
  }
  return { results, exitCode: Object.values(results).every(r => r.ok) ? 0 : 1 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(r => process.exit(r.exitCode), e => { console.error(redactor([process.env[KEYS.openai], process.env[KEYS.anthropic]])(e.message)); process.exit(1) })
}
