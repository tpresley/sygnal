#!/usr/bin/env node
// PLAN-9 E-3: `npm run test:compose-live` — the opt-in live accuracy check of sygnal/ai's compose
// backends (a release signal, not part of `npm test`). It runs the labelled research sets through
// the REAL compose.decisions() / compose.llm() from the built 'sygnal/ai' (run `npm run build`
// first) against live models, prints per-set tables and checks PLAN-9 §3's thresholds:
//   - Jev, structure: ≥ 85% exact;
//   - Jev, edits: held-out ≥ 85% exact; keys kept in 100% of the edits (tuned and held-out);
//   - qwen3:8b, flat and dashboard: ≥ 90% exact, 0 invalid outputs;
//   - nimble: reported, not gated.
// Exit 1 on a gated miss (or when a backend named with --only can't run).
//
// Backends:
//   jev     compose.decisions() on TypeSafe's jev-latest (https://api.typesafe.ai/v1/systemone). The
//           key is read from process.env.TYPESAFE_API_KEY only, which the npm script loads with
//           `node --env-file-if-exists=$HOME/.config/typesafe/env` (TYPESAFE_ENV_FILE overrides
//           the path); it goes in the Authorization header and is never printed. No key: skipped.
//   nimble  compose.decisions({ profile: 'small' }) on Ollama's /v1/systemone (OLLAMA_URL, default
//           http://localhost:11434)
//   qwen    compose.llm() on Ollama's qwen3:8b through chatCompletions, { temperature: 0,
//           reasoning_effort: 'none' }
// Every step is sequential (a local GPU may be shared); a decide() step over the limits sends its
// parts in parallel, as makeFetchDriver does (D472).
//
// Options:
//   --only=jev,nimble,qwen   backends (default: all three)
//   --set=flat,structure,…   sets (decisions: flat example structure params records edits
//                            edits-heldout; llm: flat example dashboard params edits)
//   --cases=ops              only the cases whose id starts with one of these prefixes
//   --repeat=n               each set n times (default 1)
//   --prefilter=on|off       compose.decisions()'s category prefilter (default: its own default)
//   --verbose                every case, not just the misses
//   --fake                   no network: each step answered by the backend's own fake() with the
//                            labelled target (a self-check of the data and the scoring: all exact)
// The case data: scripts/compose-live/data (copied from dev-plans/research/ai-compose).
import { compose, chatCompletions, toTree } from 'sygnal/ai'
import { setsFor, signature, leafIds, normalize, layoutOf, keyErrors, simplerOk } from './compose-live/sets.mjs'

const arg = (name, fallback) => {
  const a = process.argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`))
  return a === undefined ? fallback : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true
}
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null)
const only = list(arg('only'))
const wantSets = list(arg('set'))
const casePrefixes = list(arg('cases'))
const repeat = Math.max(1, Number(arg('repeat', 1)) || 1)
const verbose = !!arg('verbose')
const fake = !!arg('fake')
const prefilterArg = arg('prefilter')
const prefilter = prefilterArg === 'on' ? true : prefilterArg === 'off' ? false : undefined
const OLLAMA = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '')
const TYPESAFE = 'https://api.typesafe.ai/v1/systemone'

// §3 thresholds: per backend and set, the minimum exact share, keys kept share, maximum invalid
const GATES = {
  jev: { structure: { exact: 0.85 }, edits: { keys: 1 }, 'edits-heldout': { exact: 0.85, keys: 1 } },
  qwen: { flat: { exact: 0.9, invalid: 0 }, dashboard: { exact: 0.9, invalid: 0 } },
}

const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
const opt = (o) => (prefilter === undefined ? o : { ...o, prefilter })
const BACKENDS = {
  jev: () => ({ kind: 'decisions', label: 'Jev (jev-latest, api.typesafe.ai)', backend: compose.decisions(opt({ url: TYPESAFE, model: 'jev-latest' })), auth: process.env.TYPESAFE_API_KEY }),
  nimble: () => ({ kind: 'decisions', label: `nimble (Ollama ${OLLAMA}, profile 'small')`, backend: compose.decisions(opt({ url: `${OLLAMA}/v1/systemone`, model: 'nimble', profile: 'small' })) }),
  qwen: () => ({ kind: 'llm', label: `qwen3:8b (Ollama chatCompletions, compose.llm())`, backend: compose.llm({ model: 'qwen3:8b' }), transport: chatCompletions({ baseURL: `${OLLAMA}/v1`, body: { temperature: 0, reasoning_effort: 'none' } }) }),
}

/** why a backend can't run now (null: it can) */
async function unavailable(id) {
  if (fake) return null
  if (id === 'jev') return process.env.TYPESAFE_API_KEY ? null : 'no TYPESAFE_API_KEY: run through `npm run test:compose-live` (it loads $HOME/.config/typesafe/env when present, or TYPESAFE_ENV_FILE) or `node --env-file=<file> scripts/compose-live.mjs`'
  const tags = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null)
  if (!tags) return `can't reach Ollama at ${OLLAMA} (OLLAMA_URL)`
  const model = id === 'nimble' ? 'nimble' : 'qwen3:8b'
  return tags.models?.some((m) => m.name === model || m.name === `${model}:latest`) ? null : `${model} is not installed in Ollama`
}

/** one request → the reply body the backend reads; meters tokens */
async function send(b, request, m) {
  if (b.kind === 'llm') {
    let text = ''
    for await (const e of b.transport.stream(request, AbortSignal.timeout(180000))) {
      if (e.type === 'text') text += e.delta
      if (e.type === 'finish') m.tokens += e.usage?.inputTokens ?? e.usage?.input_tokens ?? 0
    }
    return { text }
  }
  // D472: as makeFetchDriver sends a decide() request: its `batch` parts in parallel, a part
  // rejected as too large `split` again (at most 3 deep), the bodies merged by `combine`
  const one = async (q, depth) => {
    m.requests++
    const res = await fetch(q.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(b.auth && { authorization: `Bearer ${b.auth}` }) },
      body: JSON.stringify(q.json),
      signal: AbortSignal.timeout(180000),
    })
    if (!res.ok) {
      const text = await res.text()
      let body = text
      try { body = JSON.parse(text) } catch (_) {}
      // the status and the start of the body only (a server never echoes the key)
      const e = Object.assign(new Error(`HTTP ${res.status} ${text.slice(0, 200)}`), { status: res.status, body })
      const parts = depth < 3 && request.split?.(q, e)
      if (parts?.length > 1) return all(parts, depth + 1)
      throw e
    }
    return res.json()
  }
  const all = async (qs, depth) => (request.combine ?? ((x) => x))(await Promise.all(qs.map((q) => one(q, depth))), qs)
  const body = await (request.batch ? all(request.batch, 0) : one(request, 0))
  m.tokens += body?.usage?.input_tokens ?? 0
  return body
}

/** --fake: the backend's own answer for the labelled target (compose.llm()'s is the reply text) */
function fakeReply(b, k, pending) {
  const v = b.backend.fake({ catalog: k.catalog, state: {}, pending, target: k.want })
  return b.kind === 'llm' ? { text: v } : v
}

/** one case: start → (send → reply)* */
async function run(b, k) {
  const m = { calls: 0, requests: 0, tokens: 0, ms: 0 }
  const previous = k.previous ? layoutOf(k.catalog, k.previous) : null
  const started = performance.now()
  let r
  try {
    r = b.backend.start({ catalog: k.catalog, state: {}, prompt: k.prompt, previous, names })
    while (r.request) {
      m.calls++
      const reply = fake ? fakeReply(b, k, r.pending) : await send(b, r.request, m)
      r = b.backend.reply({ catalog: k.catalog, state: {}, pending: r.pending, reply, names })
    }
  } catch (e) {
    r = { error: e.message, failed: true }
  }
  m.ms = Math.round(performance.now() - started)
  return { r, m, previous }
}

/** score one result */
function score(set, k, { r, previous }) {
  const sc = set.score || {}
  if (r.error) return { invalid: true, ok: false, got: `(${r.failed ? 'failed' : 'invalid'}: ${String(r.error).slice(0, 160)})`, partErrors: 0 }
  if (set.edit) {
    const out = r.unavailable || !r.layout ? previous : r.layout
    const keys = keyErrors(k.catalog, previous, out)
    const got = signature(k.catalog, toTree(out), sc)
    if (k.accept === 'simpler') return { ok: simplerOk(k.catalog, previous, out), got, want: '(a shorter page, same order)', keys, partErrors: 0 }
    const want = signature(k.catalog, normalize(k.catalog, k.want, previous), sc)
    return { ok: got === want, got, want, keys, partErrors: partErrors(k.catalog, toTree(out), normalize(k.catalog, k.want, previous)) }
  }
  const gotTree = r.layout ? toTree(r.layout) : []
  const wantTree = k.want.length ? normalize(k.catalog, k.want) : []
  const got = signature(k.catalog, gotTree, sc), want = signature(k.catalog, wantTree, sc)
  return { ok: got === want, got, want, partErrors: partErrors(k.catalog, gotTree, wantTree) }
}
function partErrors(catalog, got, want) {
  const rest = leafIds(catalog, want, { params: false })
  let extra = 0
  for (const x of leafIds(catalog, got, { params: false })) { const i = rest.indexOf(x); if (i >= 0) rest.splice(i, 1); else extra++ }
  return extra + rest.length
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0 }
const pct = (a, n) => (n ? `${Math.round((100 * a) / n)}%` : '-')
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

const order = ['jev', 'nimble', 'qwen']
const ids = only || order
for (const id of ids) if (!BACKENDS[id]) { console.error(`unknown backend '${id}' (jev, nimble, qwen)`); process.exit(2) }
let failedGates = 0
let missingRequired = 0
const summary = []

for (const id of order.filter((x) => ids.includes(x))) {
  const why = await unavailable(id)
  if (why) {
    console.log(`\n== ${id}: skipped — ${why}`)
    if (only) missingRequired++
    summary.push({ id, skipped: why })
    continue
  }
  const b = BACKENDS[id]()
  console.log(`\n== ${b.label}${fake ? ' (fake: no network)' : ''}${prefilter !== undefined ? `, prefilter ${prefilter ? 'on' : 'off'}` : ''}${repeat > 1 ? `, ${repeat} repeats` : ''}`)
  const rows = []
  for (const set of setsFor(b.kind)) {
    if (wantSets && !wantSets.includes(set.name)) continue
    const cases = set.cases.filter((k) => (!casePrefixes || casePrefixes.some((p) => k.id.startsWith(p))) && !(fake && k.accept))
    if (!cases.length) continue
    const t = { set: set.name, n: 0, exact: 0, partErrors: 0, keysKept: 0, edits: 0, invalid: 0, calls: 0, requests: 0, tokens: 0, ms: [] }
    console.log(`-- ${set.name}: ${set.note}`)
    for (let rep = 0; rep < repeat; rep++) {
      for (const k of cases) {
        const res = await run(b, k)
        const s = score(set, k, res)
        t.n++
        if (s.ok) t.exact++
        if (s.invalid) t.invalid++
        t.partErrors += s.partErrors || 0
        if (set.edit && !s.invalid) { t.edits++; if (!s.keys) t.keysKept++ }
        t.calls += res.m.calls
        t.requests += res.m.requests
        t.tokens += res.m.tokens
        t.ms.push(res.m.ms)
        if (!s.ok || verbose || (set.edit && s.keys)) {
          console.log(`   ${s.ok ? 'ok  ' : 'MISS'} ${k.id}: ${k.prompt}\n        got  ${s.got || '(nothing fits)'}${s.want !== undefined && !s.ok ? `\n        want ${s.want || '(nothing fits)'}` : ''}${s.keys ? `\n        KEYS ${s.keys} kept node(s) got a new key` : ''}   [${res.m.calls} call${res.m.calls === 1 ? '' : 's'}${res.m.requests > res.m.calls ? ` (${res.m.requests} requests)` : ''}, ${res.m.ms} ms]`)
        }
      }
    }
    const g = GATES[id]?.[set.name]
    const misses = []
    if (g?.exact !== undefined && t.exact / t.n < g.exact) misses.push(`exact < ${g.exact * 100}%`)
    if (g?.keys !== undefined && (t.edits ? t.keysKept / t.edits : 0) < g.keys) misses.push(`keys kept < ${g.keys * 100}%`)
    if (g?.invalid !== undefined && t.invalid > g.invalid) misses.push(`invalid > ${g.invalid}`)
    // a subset of a set (--cases) is reported against the threshold but not gated
    t.gate = !g ? '-' : casePrefixes ? `(subset${misses.length ? `: ${misses.join(', ')}` : ''})` : misses.length ? `MISS (${misses.join(', ')})` : 'pass'
    if (misses.length && !casePrefixes) failedGates++
    rows.push(t)
  }
  // the table
  console.log(`\n${b.label}`)
  console.log(`${pad('set', 14)}${lpad('exact', 10)}${lpad('%', 6)}${lpad('part err', 10)}${lpad('keys kept', 11)}${lpad('invalid', 9)}${lpad('calls', 7)}${lpad('reqs', 7)}${lpad('tokens', 8)}${lpad('median', 9)}  gate`)
  for (const t of rows) {
    console.log(`${pad(t.set, 14)}${lpad(`${t.exact}/${t.n}`, 10)}${lpad(pct(t.exact, t.n), 6)}${lpad(t.partErrors, 10)}${lpad(t.edits ? `${t.keysKept}/${t.edits}` : '-', 11)}${lpad(t.invalid, 9)}${lpad((t.calls / t.n).toFixed(2), 7)}${lpad((t.requests / t.n).toFixed(2), 7)}${lpad(t.tokens ? Math.round(t.tokens / t.n) : '-', 8)}${lpad(`${median(t.ms)} ms`, 9)}  ${t.gate}`)
  }
  summary.push({ id, rows })
}

const skipped = summary.filter((s) => s.skipped)
console.log(`\n${failedGates ? `${failedGates} gated set(s) below the PLAN-9 §3 thresholds` : 'every gated set that ran meets the PLAN-9 §3 thresholds'}${skipped.length ? `; skipped: ${skipped.map((s) => s.id).join(', ')}` : ''}`)
process.exit(failedGates || missingRequired ? 1 : 0)
