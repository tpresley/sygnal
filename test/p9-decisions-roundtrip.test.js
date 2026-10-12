// PLAN-9 B-1 / B-2: compose.decisions() round trips (the research's selftest.mjs, on the real
// module): for a target tree, start → fake → reply (→ fake → reply) must rebuild the target
// exactly. Covers every labelled case of the five structure catalogs and the params / records
// sets, plus seeded random targets over each catalog. No network.
//
// It runs on the real defineCatalog and layout.ts (finish / fromTree / toTree).
import { describe, it, expect } from 'vitest'
import { decisions, llmOnly } from '../src/extra/ai/compose/decisions.js'
import { fromTree, toTree, finish } from '../src/extra/ai/compose/layout'
import { formatTree } from './p9-decisions-helpers.js'
import { rng, randomTarget } from './p9-decisions-random.js'
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
