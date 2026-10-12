// PLAN-9 compose.decisions(): every choice respects the backend's candidate limit (Ollama's
// /v1/systemone takes 2–26 candidates; `maxOptions` 25 for an Ollama url), not only params and
// records: pick_ (groups), count_ (maxUses), parent_ (places), beside_ (rows), gap_ (copies), and the
// edit's set_ / add_g_ / moved_ / where_ choices are split into chunks (head options repeated), read
// back as one answer, and fake() still inverts them. Also: rows up to the row container's `max`.
import { describe, it, expect } from 'vitest'
import { decisions, editLeaves } from '../src/extra/ai/compose/decisions.js'
import { defineCatalog } from '../src/extra/ai/compose/catalog'
import { fromTree, toTree, finish } from '../src/extra/ai/compose/layout'
import { answers } from '../src/extra/ai/answers'
import { STRUCTURE, OPS, SHOP } from './p9-decisions-catalogs.js'
import { formatTree } from './p9-decisions-helpers.js'
import { rng, randomTarget, pickOne } from './p9-decisions-random.js'

const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
const json = (x) => JSON.parse(JSON.stringify(x))
const Stub = () => null
const OLLAMA = 'http://localhost:11434/v1/systemone'

/** start → (fake → reply)*, checking every request's choices against `max` */
function trip(backend, catalog, prompt, target, previous = null, max = 25) {
  let r = backend.start({ catalog, state: {}, prompt, previous, names })
  let pending = json(r.pending)
  const requests = [r.request]
  for (;;) {
    const reply = backend.fake({ catalog, state: {}, pending, target })
    const out = backend.reply({ catalog, state: {}, pending, reply, names })
    if (!out.request) { checkLimit(requests, max); return { out, requests } }
    requests.push(out.request)
    pending = json(out.pending)
  }
}
function checkLimit(requests, max) {
  for (const req of requests) for (const [name, q] of Object.entries(req.json.questions)) {
    if (q.type !== 'choice') continue
    const n = Object.keys(q.criteria).length
    expect(n, name).toBeLessThanOrEqual(max)
    expect(n, name).toBeGreaterThanOrEqual(2)
  }
}
const layoutOf = (catalog, tree, previous) => finish(catalog, fromTree(catalog, tree, previous), {})

// 30 KPIs in one group, a 30-copy note, a 30-slot board, 30 plain cards (rows), on one page
const ids = Array.from({ length: 30 }, (_, i) => i + 1)
const BIG = defineCatalog({
  limits: { maxParts: 40 },
  parts: {
    ...Object.fromEntries(ids.map((i) => [`kpi${i}`, { component: Stub, group: 'kpi', description: `KPI card number ${i}` }])),
    note: { component: Stub, maxUses: 30, description: 'A sticky note' },
    pin: { component: Stub, in: [...ids.map((i) => `board:s${i}`), 'page'], description: 'A pinned card' },
    ...Object.fromEntries(ids.map((i) => [`card${i}`, { component: Stub, description: `Card number ${i}`, params: { size: { label: 'size', options: Object.fromEntries(ids.map((j) => [`z${j}`, `size ${j}`])) } } }])),
  },
  containers: { board: { slots: Object.fromEntries(ids.map((i) => [`s${i}`, `Column ${i} of the board`])), render: Stub }, row: { max: 30 } },
})

describe('compose.decisions(): every question within Ollama\'s 25 options', () => {
  it('pick_ over 30 group members, count_ up to 30 copies, param over 30 options: chunked, read back as one answer', () => {
    const b = decisions({ model: 'nimble', url: OLLAMA })
    const { request } = b.start({ catalog: BIG, state: {}, prompt: 'x', previous: null, names })
    const q = request.json.questions
    expect(Object.keys(q).filter((k) => k.startsWith('pick_kpi'))).toEqual(['pick_kpi__c0', 'pick_kpi__c1'])
    expect(Object.keys(q.pick_kpi__c0.criteria)).toHaveLength(16)
    expect(q.pick_kpi__c1.criteria.omit).toBeTruthy()
    expect(Object.keys(q).filter((k) => k.startsWith('count_note'))).toEqual(['count_note__c0', 'count_note__c1'])
    checkLimit([request], 25)
    for (const target of [
      [{ part: 'kpi27' }, { part: 'note' }, { part: 'note' }, { part: 'card3', params: { size: 'z29' } }],
      [{ part: 'kpi2' }, ...Array.from({ length: 28 }, () => ({ part: 'note' }))],
    ]) {
      const r = trip(b, BIG, 'x', target)
      expect(formatTree(toTree(r.out.layout))).toBe(formatTree(toTree(layoutOf(BIG, target))))
    }
  })

  it('parent_ over 31 places and beside_ over 29 others: chunked; rows of up to the row max (here 30)', () => {
    const b = decisions({ model: 'nimble', url: OLLAMA })
    const pinOnBoard = [{ part: 'board', children: { s29: [{ part: 'pin' }] } }, { part: 'card1' }, { part: 'card2' }]
    const r = trip(b, BIG, 'x', pinOnBoard)
    expect(Object.keys(r.requests[1].json.questions).filter((k) => k.startsWith('parent_pin'))).toEqual(['parent_pin__c0', 'parent_pin__c1'])
    expect(formatTree(toTree(r.out.layout))).toBe(formatTree(toTree(layoutOf(BIG, pinOnBoard))))
    const wide = [{ part: 'row', children: ids.slice(0, 27).map((i) => ({ part: `card${i}` })) }]
    const w = trip(b, BIG, 'x', wide)
    expect(Object.keys(w.requests[1].json.questions).filter((k) => k.startsWith('beside_card1__'))).toEqual(['beside_card1__c0', 'beside_card1__c1'])
    expect(formatTree(toTree(w.out.layout))).toBe(formatTree(toTree(layoutOf(BIG, wide))))
  })

  it('edits: set_, add_g_, moved_ and where_ chunked on a 28-node page', () => {
    const b = decisions({ model: 'nimble', url: OLLAMA })
    const previous = layoutOf(BIG, [{ part: 'kpi1' }, ...ids.slice(0, 27).map((i) => ({ part: `card${i}` }))])
    expect(editLeaves(BIG, previous, {})).toHaveLength(28)
    const target = [{ part: 'card27', params: { size: 'z30' } }, { part: 'kpi1' }, ...ids.slice(0, 25).map((i) => ({ part: `card${i}` })), { part: 'note' }]
    const r = trip(b, BIG, 'x', target, previous)
    expect(Object.keys(r.requests[0].json.questions).filter((k) => k.startsWith('moved_1'))).toEqual(['moved_1__c0', 'moved_1__c1'])
    expect(Object.keys(r.requests[0].json.questions).filter((k) => k.startsWith('set_card27__size'))).toEqual(['set_card27__size__c0', 'set_card27__size__c1'])
    expect(Object.keys(r.requests[1].json.questions).some((k) => /^where_card27__c\d$/.test(k))).toBe(true)
    expect(formatTree(toTree(r.out.layout))).toBe(formatTree(toTree(layoutOf(BIG, target, previous))))
  })

  it('a chunked answer reads as the most probable option across its chunks (head options only when every chunk says so)', () => {
    const b = decisions({ model: 'nimble', url: OLLAMA })
    const { request, pending } = b.start({ catalog: BIG, state: {}, prompt: 'x', previous: null, names })
    const q = request.json.questions
    const pick = (c0, c1) => b.reply({ catalog: BIG, state: {}, pending, names, reply: answers(q, { pick_kpi__c0: c0, pick_kpi__c1: c1 }) })
    const parts = (out) => (out.layout ? toTree(out.layout).map((n) => n.part) : [])
    expect(parts(pick({ choice: 'kpi3', confidence: 0.4 }, { choice: 'kpi20', confidence: 0.9 }))).toEqual(['kpi20'])
    expect(parts(pick({ choice: 'kpi3', confidence: 0.9 }, 'omit'))).toEqual(['kpi3'])
    expect(pick('omit', 'omit').unavailable).toBe(true)
  })

  it('maxOptions 5 on the research catalogs: every question ≤ 5 options; random compositions and edits still round-trip', () => {
    const b = decisions({ model: 'test', maxOptions: 5 })
    // (records are prefiltered to maxOptions - 1, not chunked: the record catalogs are covered at 25 elsewhere)
    const all = [...Object.values(STRUCTURE).map((s) => [s.id, s.catalog]), ['ops', OPS], ['shop', SHOP]]
    for (const [id, catalog] of all) {
      const r = rng(id.length * 13)
      for (let i = 0; i < 40; i++) {
        const { target, prompt } = randomTarget(catalog, r, { maxLeaves: 5 })
        const want = layoutOf(catalog, target)
        const first = trip(b, catalog, prompt, target, null, 5)
        if (!first.out.layout) continue
        expect(formatTree(toTree(first.out.layout)), `${id} #${i}`).toBe(formatTree(toTree(want)))
        // an edit of it: drop one part
        const leaves = editLeaves(catalog, want, {})
        if (leaves.length < 2) continue
        const drop = pickOne(r, leaves).key
        const edited = toTree(finish(catalog, { ...want, nodes: Object.fromEntries(Object.entries(want.nodes).map(([k, n]) => [k, n.slots ? { ...n, slots: Object.fromEntries(Object.entries(n.slots).map(([s, l]) => [s, l.filter((x) => x !== drop)])) } : n]).filter(([k]) => k !== drop)) }, {}))
        if (formatTree(edited) === formatTree(toTree(want))) continue // a required part comes back
        const e = trip(b, catalog, prompt, edited, want, 5)
        expect(formatTree(toTree(e.out.layout)), `${id} #${i} edit`).toBe(formatTree(edited))
      }
    }
  })
})

// ---------- rows up to the row container's max ----------
describe('compose.decisions(): rows of up to the row container\'s max', () => {
  const letters = 'abcdefgh'.split('')
  const rowCatalog = (max) => defineCatalog({ parts: Object.fromEntries(letters.map((x) => [x, { component: Stub, description: `Part ${x}` }])), ...(max && { containers: { row: { max } } }) })
  const row = (n) => [{ part: 'row', children: letters.slice(0, n).map((part) => ({ part })) }]

  for (const max of [undefined, 6, 8]) {
    it(`row max ${max ?? '4 (built-in)'}: one row of every size up to it round-trips; a longer one is split by finish()`, () => {
      const catalog = rowCatalog(max)
      const b = decisions({ model: 'test' })
      for (let n = 2; n <= 8; n++) {
        const r = trip(b, catalog, 'x', row(n))
        expect(formatTree(toTree(r.out.layout)), `${n}`).toBe(formatTree(toTree(layoutOf(catalog, row(n)))))
        if (n <= (max ?? 4)) expect(toTree(r.out.layout), `${n}`).toEqual(row(n))
      }
    })
  }

  it('4+ elements that may share rows: same-row nouls per pair; a chain of beside answers plus them reads as one row', () => {
    const catalog = rowCatalog(6)
    const b = decisions({ model: 'test' })
    const s = b.start({ catalog, state: {}, prompt: 'a, b, c, d and e side by side', previous: null, names })
    const sel = b.reply({ catalog, state: {}, pending: s.pending, names, reply: answers(s.request.json.questions, { use_a: 'use', use_b: 'use', use_c: 'use', use_d: 'use', use_e: 'use', row: true }) })
    const q = sel.request.json.questions
    expect(Object.keys(q).filter((k) => k.startsWith('same_'))).toHaveLength(10)
    expect(q.same_a_vs_b.instructions).toMatch(/^Does user_request want these two elements in the same row, side by side: Part a; and Part b\?/)
    // what a model answers: each element names one neighbour (a chain), every pair "same row"
    const chain = { beside_a: 'b', beside_b: 'c', beside_c: 'd', beside_d: 'e', beside_e: 'd' }
    const pairs = Object.fromEntries(Object.keys(q).filter((k) => k.startsWith('same_')).map((k) => [k, 0.9]))
    const first = Object.fromEntries(Object.keys(q).filter((k) => k.startsWith('first_') || k.startsWith('left_')).map((k) => [k, k.split('_')[1]]))
    const one = b.reply({ catalog, state: {}, pending: json(sel.pending), names, reply: answers(q, { ...chain, ...pairs, ...first }) })
    expect(toTree(one.layout)).toEqual(row(5))
    // the chain alone (no pair says "same row"): average-linkage splits it, as before
    const none = Object.fromEntries(Object.keys(pairs).map((k) => [k, 0.05]))
    const split = b.reply({ catalog, state: {}, pending: json(sel.pending), names, reply: answers(q, { ...chain, ...none, ...first }) })
    expect(toTree(split.layout).length).toBeGreaterThan(1)
    // two rows of two stay two rows when only the pairs inside them say "same row"
    const s2 = b.start({ catalog, state: {}, prompt: 'a and b side by side, then c and d side by side', previous: null, names })
    const sel2 = b.reply({ catalog, state: {}, pending: s2.pending, names, reply: answers(s2.request.json.questions, { use_a: 'use', use_b: 'use', use_c: 'use', use_d: 'use', row: true }) })
    const q2 = sel2.request.json.questions
    const two = b.reply({ catalog, state: {}, pending: json(sel2.pending), names, reply: answers(q2, {
      beside_a: 'b', beside_b: 'c', beside_c: 'd', beside_d: 'c', same_a_vs_b: 0.95, same_c_vs_d: 0.95, same_a_vs_c: 0.05, same_a_vs_d: 0.05, same_b_vs_c: 0.2, same_b_vs_d: 0.05,
      ...Object.fromEntries(Object.keys(q2).filter((k) => k.startsWith('first_') || k.startsWith('left_')).map((k) => [k, k.split('_')[1]])),
    }) })
    expect(toTree(two.layout)).toEqual([{ part: 'row', children: [{ part: 'a' }, { part: 'b' }] }, { part: 'row', children: [{ part: 'c' }, { part: 'd' }] }])
  })

  it('3 or fewer such elements: no same-row nouls (the measured encoding)', () => {
    const catalog = rowCatalog(6)
    const b = decisions({ model: 'test' })
    const r = trip(b, catalog, 'x', row(3))
    expect(Object.keys(r.requests[1].json.questions).some((k) => k.startsWith('same_'))).toBe(false)
  })
})
