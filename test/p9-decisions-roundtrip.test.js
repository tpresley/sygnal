// PLAN-9 B-1 / B-2: compose.decisions() round trips (the research's selftest.mjs, on the real
// module): for a target tree, start → fake → reply (→ fake → reply) must rebuild the target
// exactly. Covers every labelled case of the five structure catalogs and the params / records
// sets, plus seeded random targets over each catalog. No network.
//
// layout.ts is worker A's: until A's branch is merged it is mocked with the stand-in in
// p9-decisions-helpers.js (drop the vi.mock at merge to run on A's finish / fromTree / toTree).
import { describe, it, expect, vi } from 'vitest'
vi.mock('../src/extra/ai/compose/layout', async () => await import('./p9-decisions-helpers.js'))
import { decisions, llmOnly } from '../src/extra/ai/compose/decisions.js'
import { fromTree, toTree, finish, formatTree } from './p9-decisions-helpers.js'
import { STRUCTURE, OPS, SHOP, PM40, PM200, PARAM_CASES, RECORD_CASES } from './p9-decisions-catalogs.js'

const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
const json = (x) => JSON.parse(JSON.stringify(x))

/** start → (fake → reply)* : the final result and the number of calls */
export function roundTrip(backend, catalog, prompt, target, state = {}) {
  const first = backend.start({ catalog, state, prompt, previous: null, names })
  let pending = json(first.pending) // pending is plain JSON, kept in state
  const requests = [first.request]
  for (;;) {
    const reply = backend.fake({ catalog, state, pending, target })
    const out = backend.reply({ catalog, state, pending, reply, names })
    if (!out.request) return { out, calls: requests.length, requests }
    requests.push(out.request)
    pending = json(out.pending)
  }
}
const normalized = (catalog, target) => toTree(finish(catalog, fromTree(catalog, target), {}))
const got = (out) => (out.layout ? toTree(out.layout) : [])

function expectRoundTrip(backend, catalog, prompt, target, state) {
  const r = roundTrip(backend, catalog, prompt, target, state)
  const want = normalized(catalog, target)
  const nothing = !want.some((n) => !catalog.parts[n.part]?.required) && !want.some((n) => n.children)
  if (nothing && r.out.unavailable) return r
  expect(formatTree(got(r.out)), prompt).toBe(formatTree(want))
  expect(got(r.out)).toEqual(want)
  return r
}

// ---------- seeded random targets ----------
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pickOne = (r, list) => list[Math.floor(r() * list.length)]
const shuffle = (r, list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
const slotsOf = (catalog, id) => Object.keys(catalog.containers[id]?.slots || { default: null })
function places(catalog, def) {
  const out = []
  for (const d of def.in || ['page']) {
    if (d === 'page') out.push('page:default')
    else if (d.includes(':')) out.push(d)
    else if (catalog.containers[d]) for (const s of slotsOf(catalog, d)) out.push(`${d}:${s}`)
  }
  return out
}
const recordParam = (part) => Object.keys(part.params || {}).find((k) => part.params[k].from)

/**
 * A random target the encoding can express: parts from the selectable ones (one per group), records,
 * copies, enum / number params, places from `in`, random order, rows of 2–3 leaves in a
 * non-arranged slot (no pinned parts, no copies). Returns { target, prompt }.
 */
function randomTarget(catalog, r, { maxLeaves = 6 } = {}) {
  const ids = Object.keys(catalog.parts).filter((id) => !catalog.parts[id].required && !llmOnly(catalog.parts[id]))
  const chosen = []
  const groups = new Set()
  const recordNames = []
  for (const id of shuffle(r, ids).slice(0, 1 + Math.floor(r() * maxLeaves))) {
    const part = catalog.parts[id]
    if (part.group != null) { if (groups.has(part.group)) continue; groups.add(part.group) }
    const params = {}
    for (const [k, p] of Object.entries(part.params || {})) {
      if (p.from || r() < 0.5) continue
      const keys = Object.keys(p.type === 'number' ? p.bins : p.options || {})
      if (!keys.length) continue
      const v = pickOne(r, keys)
      params[k] = p.type === 'number' ? Number(v) : v
    }
    const rp = recordParam(part)
    if (rp) {
      const records = shuffle(r, part.params[rp].from({})).slice(0, 1 + Math.floor(r() * 3))
      for (const rec of records) { chosen.push({ part: id, params: { ...params, [rp]: rec.value } }); recordNames.push(rec.name) }
    } else {
      const n = part.maxUses > 1 ? 1 + Math.floor(r() * part.maxUses) : 1
      for (let i = 0; i < n; i++) chosen.push({ part: id, ...(Object.keys(params).length && { params }), copy: n > 1 })
    }
  }
  for (const p of Object.values(catalog.parts)) if (p.required) chosen.push({ part: p.id })
  for (const x of [...chosen]) for (const c of catalog.parts[x.part].companions || []) if (!chosen.some((y) => y.part === c)) chosen.push({ part: c })
  // places: each leaf picks one of its places; a container used picks its own (recursively)
  const slots = new Map([['page:default', []]])
  const placed = new Set()
  const placeContainer = (id) => {
    if (placed.has(id)) return
    placed.add(id)
    const where = pickOne(r, places(catalog, catalog.containers[id]).filter((d) => d.split(':')[0] !== id))
    if (where !== 'page:default') placeContainer(where.split(':')[0])
    if (!slots.has(where)) slots.set(where, [])
    slots.get(where).push({ container: id })
    for (const s of slotsOf(catalog, id)) if (!slots.has(`${id}:${s}`)) slots.set(`${id}:${s}`, [])
  }
  for (const x of chosen) {
    const def = catalog.parts[x.part]
    const where = def.pin || x.copy ? 'page:default' : pickOne(r, places(catalog, def))
    if (where !== 'page:default') placeContainer(where.split(':')[0])
    if (!slots.has(where)) slots.set(where, [])
    slots.get(where).push({ leaf: x })
  }
  const build = (where) => {
    const list = shuffle(r, slots.get(where) || [])
    const pin = (e) => (e.leaf && catalog.parts[e.leaf.part].pin) || null
    const ordered = [...list.filter((e) => pin(e) === 'start'), ...list.filter((e) => !pin(e)), ...list.filter((e) => pin(e) === 'end')]
    let nodes = ordered.map((e) => {
      if (e.leaf) { const { copy, ...n } = e.leaf; void copy; return { node: n, rowable: !pin(e) && !e.leaf.copy } }
      const k = slotsOf(catalog, e.container)
      const children = k.length === 1 && k[0] === 'default' ? build(`${e.container}:default`) : Object.fromEntries(k.map((s) => [s, build(`${e.container}:${s}`)]))
      return { node: { part: e.container, children } }
    })
    const [c] = where.split(':')
    if (catalog.containers.row && (c === 'page' || !catalog.containers[c].arranged) && r() < 0.6) {
      const free = nodes.filter((n) => n.rowable)
      while (free.length >= 2 && r() < 0.7) {
        const size = Math.min(free.length, 2 + Math.floor(r() * 2))
        const members = free.splice(0, size)
        const at = nodes.indexOf(members[0])
        nodes = nodes.filter((n) => !members.includes(n))
        nodes.splice(at, 0, { node: { part: 'row', children: members.map((m) => m.node) } })
      }
    }
    return nodes.map((n) => n.node)
  }
  return { target: build('page:default'), prompt: `Show ${recordNames.join(' and ') || 'the page'}` }
}

// ---------- the structure catalogs ----------
describe('compose.decisions(): the labelled structure cases round-trip', () => {
  for (const { id, catalog, cases } of Object.values(STRUCTURE)) {
    it(`${id}: ${cases.length} cases`, () => {
      const backend = decisions({ model: 'test' })
      for (const { prompt, want } of cases) expectRoundTrip(backend, catalog, prompt, want)
    })
  }

  it('calls: 1 when nothing fits or for a single part in one place, else 2 (the research counts)', () => {
    const backend = decisions({ model: 'test' })
    const { catalog, cases } = STRUCTURE.dashboard
    const counts = cases.map(({ prompt, want }) => roundTrip(backend, catalog, prompt, want).calls)
    // 'Show me the stock price of Apple' (nothing fits), 'What is on my plate today?' (one part): 1 call
    expect(counts).toEqual(cases.map(({ want }) => (want.length === 0 || (want.length === 1 && !want[0].children) ? 1 : 2)))
  })

  it('ops with the category prefilter (call 0): every case round-trips in 3 calls (2 when nothing fits)', () => {
    const backend = decisions({ model: 'test', prefilter: true })
    const { catalog, cases } = STRUCTURE.ops
    for (const { prompt, want } of cases) {
      const r = expectRoundTrip(backend, catalog, prompt, want)
      const single = want.length === 1 && !want[0].children
      expect(r.calls, prompt).toBe(want.length === 0 ? 1 : single ? 2 : 3)
      expect(Object.keys(r.requests[0].json.questions).every((q) => q.startsWith('cat_'))).toBe(true)
    }
  })

  for (const rowMean of [0.25, 0.5]) {
    it(`rowMean ${rowMean}: 150 random targets per catalog round-trip`, () => {
      const backend = decisions({ model: 'test', rowMean })
      for (const { id, catalog } of Object.values(STRUCTURE)) {
        const r = rng(id.length * 1000 + rowMean * 10)
        for (let i = 0; i < 150; i++) {
          const { target, prompt } = randomTarget(catalog, r)
          expectRoundTrip(backend, catalog, `${id} #${i} ${prompt}`, target)
        }
      }
    })
  }
})

// ---------- params and records ----------
describe('compose.decisions(): params and records round-trip', () => {
  it('the 20 labelled params cases (enum params, number bins)', () => {
    const backend = decisions({ model: 'test' })
    for (const { catalog, prompt, want } of PARAM_CASES) expectRoundTrip(backend, catalog, prompt, want)
  })

  for (const [scale, catalog] of [['40', PM40], ['200', PM200]]) {
    it(`the 20 labelled records cases at ${scale} projects (prefilter, groups, record slots)`, () => {
      const backend = decisions({ model: 'test' })
      for (const { prompt, want } of RECORD_CASES) expectRoundTrip(backend, catalog, prompt, want)
    })
  }

  it('the records cases through an Ollama url (≤ 25 options per choice)', () => {
    const backend = decisions({ model: 'nimble', url: 'http://localhost:11434/v1/systemone' })
    for (const { prompt, want } of RECORD_CASES) {
      const r = expectRoundTrip(backend, PM200, prompt, want)
      for (const req of r.requests) for (const q of Object.values(req.json.questions)) if (q.criteria) expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(25)
    }
  })

  it('200 random targets per params catalog (records named in the prompt)', () => {
    const backend = decisions({ model: 'test' })
    for (const [id, catalog] of [['ops', OPS], ['shop', SHOP], ['pm40', PM40], ['pm200', PM200]]) {
      const r = rng(id.length * 7)
      for (let i = 0; i < 200; i++) {
        const { target, prompt } = randomTarget(catalog, r, { maxLeaves: 5 })
        expectRoundTrip(backend, catalog, prompt, target)
      }
    }
  })
})
