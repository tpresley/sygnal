// PLAN-9 B-4: compose.decisions() edits (params-edits REPORT.md §3). With a layout on the page,
// COMPOSE is an edit in at most 2 calls: call 1 asks per node (remove, settings), the adds, the
// gates and the move slots; call 2 (only when something moves or is added) one `where` per mover.
// Covers the labelled edit cases of the research (tuned + held-out) as round trips through fake(),
// the key rules, random edits of random layouts over every research catalog, nested containers
// (`into:`), and the wording. No network.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.ts'
import { composeWith, compose } from '../src/extra/ai/index.ts'
import { makeApp, catalog as appCatalog } from './p9-compose-app.js'
import { decisions, editLeaves, EDIT } from '../src/extra/ai/compose/decisions.js'
import { defineCatalog } from '../src/extra/ai/compose/catalog'
import { fromTree, toTree, finish } from '../src/extra/ai/compose/layout'
import { answers } from '../src/extra/ai/answers'
import { declareParams, STRUCTURE, OPS, SHOP, PM40, PM200 } from './p9-decisions-catalogs.js'
import { formatTree } from './p9-decisions-helpers.js'
import { rng, randomTarget, pickOne } from './p9-decisions-random.js'
import CASES from '../dev-plans/research/ai-compose/params-edits/evals/cases.json'

const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
const json = (x) => JSON.parse(JSON.stringify(x))
const CAT = Object.fromEntries(Object.entries(CASES.catalogs).map(([id, c]) => [id, defineCatalog(declareParams(c))]))

/** start (an edit of `previous`) → (fake → reply)*: the result, the calls and the requests */
function editTrip(backend, catalog, previous, prompt, target, state = {}) {
  const first = backend.start({ catalog, state, prompt, previous, names })
  let pending = json(first.pending)
  const requests = [first.request]
  for (;;) {
    const reply = backend.fake({ catalog, state, pending, target })
    const out = backend.reply({ catalog, state, pending, reply, names })
    if (!out.request) return { out, calls: requests.length, requests, pending }
    requests.push(out.request)
    pending = json(out.pending)
  }
}
/** a layout's leaves: key → identity (part + record) */
const leafKeys = (catalog, layout) => Object.fromEntries(editLeaves(catalog, layout, {}).map((l) => [l.key, l.part + JSON.stringify(l.params?.project ?? l.params?.member ?? l.params?.report ?? '')]))
/**
 * every key of `previous` still in `next` names the same part (and record): kept nodes keep their
 * keys, and new nodes never take a key of the previous layout (research keyErrors = 0)
 */
function expectKeysKept(catalog, previous, next) {
  const before = leafKeys(catalog, previous), after = leafKeys(catalog, next)
  for (const [k, id] of Object.entries(after)) if (k in before) expect(id, `key ${k}`).toBe(before[k])
  // a part that can be on the page once, on both pages: the same key (one with copies may be removed and added again)
  const once = (m) => Object.entries(m).filter(([k]) => (catalog.parts[(next.nodes[k] ?? previous.nodes[k]).part].maxUses ?? 1) === 1).map(([, id]) => id)
  for (const id of once(before).filter((id) => once(after).includes(id))) {
    expect(Object.keys(after).find((k) => after[k] === id), id).toBe(Object.keys(before).find((k) => before[k] === id))
  }
}
/** the keys of the parts that can be on the page once (copies may trade keys or be removed and added again: a tree target can't tell them apart) */
const sortedLeafKeys = (catalog, l, previous) => {
  const m = leafKeys(catalog, l), ids = [...Object.values(m), ...Object.values(leafKeys(catalog, previous))]
  return Object.keys(m).filter((k) => (catalog.parts[l.nodes[k].part].maxUses ?? 1) === 1 && ids.filter((id) => id === m[k]).length <= 2).sort()
}
const layoutOf = (catalog, tree, previous) => finish(catalog, fromTree(catalog, tree, previous), {})

// ---------- the research's labelled edits ----------
describe('compose.decisions() edits: the labelled cases (params-edits evals/cases.json) round-trip', () => {
  for (const set of ['tuned', 'heldout']) {
    const cases = CASES.edits.filter((e) => e.set === set && e.expected)
    it(`${set}: ${cases.length} edits, ≤ 2 calls, keys kept`, () => {
      const backend = decisions({ model: 'test' })
      let calls = 0
      for (const e of cases) {
        const catalog = CAT[e.catalog]
        const previous = layoutOf(catalog, toTree(e.previousLayout))
        const want = layoutOf(catalog, toTree(e.expected), previous)
        const r = editTrip(backend, catalog, previous, e.prompt, toTree(e.expected))
        calls += r.calls
        if (formatTree(toTree(want)) === formatTree(toTree(previous))) { expect(r.out.unavailable, e.prompt).toBe(true); continue }
        expect(r.out.keyed, e.prompt).toBe(true)
        expect(formatTree(toTree(r.out.layout)), e.prompt).toBe(formatTree(toTree(want)))
        expect(r.calls, e.prompt).toBeLessThanOrEqual(2)
        expectKeysKept(catalog, previous, r.out.layout)
      }
      // research: 1.56–1.59 calls per edit
      expect(calls / cases.length).toBeLessThan(2)
    })
  }

  it('"Thanks, looks good" (nothing to change) and an empty target: unavailable in 1 call, the layout kept', () => {
    const backend = decisions({ model: 'test' })
    const e = CASES.edits.find((x) => x.prompt === 'Thanks, looks good')
    const catalog = CAT[e.catalog]
    const previous = layoutOf(catalog, toTree(e.previousLayout))
    for (const target of [[], toTree(previous)]) {
      const r = editTrip(backend, catalog, previous, e.prompt, target)
      expect(r.out).toMatchObject({ layout: null, unavailable: true })
      expect(r.calls).toBe(1)
    }
  })

  it('"Make it simpler": the simpler gate removes the secondary nodes, never all of them', () => {
    const backend = decisions({ model: 'test' })
    const e = CASES.edits.find((x) => x.accept === 'simpler')
    const catalog = CAT[e.catalog]
    const previous = layoutOf(catalog, toTree(e.previousLayout))
    const { request, pending } = backend.start({ catalog, state: {}, prompt: e.prompt, previous, names })
    const q = request.json.questions
    const leaves = editLeaves(catalog, previous, {})
    // every node secondary: the explicit remove answers decide (none: the page stays whole)
    const picks = { simpler: true, ...Object.fromEntries(leaves.map((l) => [`simpler_${l.key}`, true])) }
    const out = backend.reply({ catalog, state: {}, pending, reply: answers(q, picks), names })
    expect(out.unavailable).toBe(true)
    const some = { simpler: true, [`simpler_${leaves[1].key}`]: true, [`simpler_${leaves[3].key}`]: true }
    const two = backend.reply({ catalog, state: {}, pending, reply: answers(q, some), names })
    expect(toTree(two.layout).map((n) => n.part)).toEqual([leaves[0].part, leaves[2].part])
  })
})

// ---------- the encoding ----------
describe('compose.decisions() edits: the questions', () => {
  const catalog = CAT.ops
  const previous = layoutOf(catalog, [{ part: 'revenue' }, { part: 'revenueChart', params: { range: 'quarter' } }, { part: 'row', children: [{ part: 'orders' }, { part: 'tickets' }] }])

  it('call 1: per node remove / simpler / set_ (keep + the other options), adds with inline params, the gates, 2 move slots; the research wording', () => {
    const backend = decisions({ model: 'test' })
    const { request, pending } = backend.start({ catalog, state: {}, prompt: 'Add the weather', previous, names })
    expect(pending.step).toBe('edit')
    const { state, questions: q } = request.json
    expect(state.user_request).toBe('Add the weather')
    expect(state.current_page).toHaveLength(4)
    expect(state.current_page[1]).toMatch(/^Line chart.*; time range: the last 3 months/)
    expect(q.remove_revenueChart).toEqual({ type: 'noul', instructions: EDIT.remove(state.current_page[1]) })
    expect(q.remove_revenueChart.instructions).toContain('Answer no for elements user_request does not mention.')
    expect(Object.keys(q.set_revenueChart__range.criteria)).toEqual(['keep', 'week', 'month', 'year'])
    expect(q.set_revenueChart__range.criteria.keep).toBe('keep the current time range: the last 3 months (this quarter)')
    expect(q.add_weather.criteria).toEqual({ omit: 'None of these elements is needed.', use: catalog.parts.weather.description })
    expect(q.add_revenue).toBeUndefined()
    expect(q.param_tasks__limit ?? q.param_orders__status).toBeUndefined()
    for (const g of ['swap', 'simpler', 'placed', 'change']) expect(q[g].type).toBe('noul')
    expect(q.change.instructions).toMatch(/such as its time range, order status, number of rows/)
    expect(Object.keys(q.moved_1.criteria)).toEqual(['none', 'revenue', 'revenueChart', 'orders', 'tickets'])
    expect(q.moved_2.instructions).toMatch(/other than the ones already named\? Answer the second such element/)
    expect(q.row).toBeUndefined()
  })

  it('call 2: one where per mover over not_stated / top / bottom / above / below / beside; nothing moves or is added: 1 call', () => {
    const backend = decisions({ model: 'test' })
    const s = backend.start({ catalog, state: {}, prompt: 'Add the weather', previous, names })
    const r = backend.reply({ catalog, state: {}, pending: s.pending, reply: answers(s.request.json.questions, { add_weather: 'use' }), names })
    expect(r.pending.step).toBe('where')
    expect(r.keyed).toBe(true)
    // the preview: the weather at the bottom (where it goes when the request doesn't say)
    expect(toTree(r.preview).map((n) => n.part)).toEqual(['revenue', 'revenueChart', 'row', 'weather'])
    const q = r.request.json.questions
    expect(Object.keys(q)).toEqual(['where_weather'])
    expect(q.where_weather.instructions).toBe(EDIT.where(catalog.parts.weather.description, true))
    expect(Object.keys(q.where_weather.criteria)).toEqual(['not_stated', 'top', 'bottom',
      ...['revenue', 'revenueChart', 'orders', 'tickets'].flatMap((k) => [`above:${k}`, `below:${k}`, `beside:${k}`])])
    const only = backend.start({ catalog, state: {}, prompt: 'Remove the chart', previous, names })
    const one = backend.reply({ catalog, state: {}, pending: only.pending, reply: answers(only.request.json.questions, { remove_revenueChart: true }), names })
    expect(one.request).toBeUndefined()
    expect(toTree(one.layout).map((n) => n.part)).toEqual(['revenue', 'row'])
  })

  it('fresh: true (previous null) and an empty page compose from scratch', () => {
    const backend = decisions({ model: 'test' })
    expect(backend.start({ catalog, state: {}, prompt: 'x', previous: null, names }).pending.step).toBe('select')
    expect(backend.start({ catalog, state: {}, prompt: 'x', previous: layoutOf(catalog, []), names }).pending.step).toBe('select')
  })
})

// ---------- the key rules ----------
describe('compose.decisions() edits: the key rules', () => {
  const catalog = CAT.ops
  const backend = decisions({ model: 'test' })
  const previous = layoutOf(catalog, [{ part: 'revenue' }, { part: 'revenueChart' }, { part: 'row', children: [{ part: 'orders' }, { part: 'tickets' }] }, { part: 'tasks' }])
  const run = (prompt, call1, call2) => {
    const s = backend.start({ catalog, state: {}, prompt, previous, names })
    const r = backend.reply({ catalog, state: {}, pending: s.pending, reply: answers(s.request.json.questions, call1), names })
    if (!r.request) return r.layout
    return backend.reply({ catalog, state: {}, pending: json(r.pending), reply: answers(r.request.json.questions, call2 || {}), names }).layout
  }

  it('a param change keeps the node key (and its place); a node whose settings change is never removed', () => {
    const l = run('Show last quarter instead', { change: true, set_revenueChart__range: 'quarter', remove_revenueChart: true, swap: true })
    expect(l.nodes.revenueChart).toEqual({ part: 'revenueChart', params: { range: 'quarter' } })
    expect(l.nodes.page.slots.default).toEqual(previous.nodes.page.slots.default)
  })

  it('without the change gate, set_ answers are ignored', () => {
    const l = run('Remove the tasks', { remove_tasks: true, set_revenueChart__range: 'week' })
    expect(l.nodes.revenueChart.params).toBeUndefined()
  })

  it('a replacement takes the old node\'s place and row (not_stated), or goes where its where says', () => {
    const inPlace = run('Swap the tickets for the weather', { swap: true, remove_tickets: true, add_weather: 'use' })
    expect(toTree(inPlace)).toEqual(toTree(layoutOf(catalog, [{ part: 'revenue' }, { part: 'revenueChart' }, { part: 'row', children: [{ part: 'orders' }, { part: 'weather' }] }, { part: 'tasks' }])))
    expect(inPlace.nodes.row).toBeTruthy()
    const top = run('Drop the tickets and add the weather at the top', { swap: true, remove_tickets: true, add_weather: 'use' }, { where_weather: 'top' })
    expect(toTree(top).map((n) => n.part)).toEqual(['weather', 'revenue', 'revenueChart', 'orders', 'tasks'])
  })

  it('a reference node never moves: both flagged, the subject goes next to the anchor', () => {
    const l = run('Put the tasks next to the revenue', { moved_1: 'tasks', moved_2: 'revenue' }, { where_tasks: 'beside:revenue', where_revenue: 'beside:tasks' })
    expect(toTree(l)[0]).toEqual({ part: 'row', children: [{ part: 'revenue' }, { part: 'tasks' }] })
    expect(l.nodes.revenue).toBeTruthy()
    // of two naming each other, the surer one moves
    const s = backend.start({ catalog, state: {}, prompt: 'x', previous, names })
    const r = backend.reply({ catalog, state: {}, pending: s.pending, reply: answers(s.request.json.questions, { moved_1: 'tasks', moved_2: 'revenue' }), names })
    const q = r.request.json.questions
    const out = backend.reply({ catalog, state: {}, pending: json(r.pending), names, reply: answers(q, { where_tasks: { choice: 'below:revenue', confidence: 0.4 }, where_revenue: { choice: 'below:tasks', confidence: 0.9 } }) })
    expect(toTree(out.layout).map((n) => n.part)).toEqual(['revenueChart', 'row', 'tasks', 'revenue'])
  })

  it('a moved node answered not_stated stays; placed with no move slot asks every node', () => {
    const s = backend.start({ catalog, state: {}, prompt: 'Show the tasks at the top', previous, names })
    const r = backend.reply({ catalog, state: {}, pending: s.pending, reply: answers(s.request.json.questions, { placed: true }), names })
    expect(Object.keys(r.request.json.questions)).toEqual(['where_revenue', 'where_revenueChart', 'where_orders', 'where_tickets', 'where_tasks'])
    const out = backend.reply({ catalog, state: {}, pending: json(r.pending), names, reply: answers(r.request.json.questions, { where_tasks: 'top' }) })
    expect(toTree(out.layout).map((n) => n.part)).toEqual(['tasks', 'revenue', 'revenueChart', 'row'])
    expectKeysKept(catalog, previous, out.layout)
  })

  it('copies keep their keys when one moves (no re-keying by identity), and an added copy never takes a removed one\'s key', () => {
    const cat = defineCatalog({ parts: { note: { component: () => null, description: 'A sticky note', maxUses: 3 }, chart: { component: () => null, description: 'A chart' } } })
    const prev = layoutOf(cat, [{ part: 'note' }, { part: 'chart' }, { part: 'note' }])
    expect(prev.nodes.page.slots.default).toEqual(['note', 'chart', 'note~2'])
    const b = decisions({ model: 'test' })
    const s = b.start({ catalog: cat, state: {}, prompt: 'Move the first note to the bottom', previous: prev, names })
    const r = b.reply({ catalog: cat, state: {}, pending: s.pending, reply: answers(s.request.json.questions, { moved_1: 'note' }), names })
    const out = b.reply({ catalog: cat, state: {}, pending: json(r.pending), names, reply: answers(r.request.json.questions, { where_note: 'bottom' }) })
    expect(out.layout.nodes.page.slots.default).toEqual(['chart', 'note~2', 'note'])
    const s2 = b.start({ catalog: cat, state: {}, prompt: 'Replace the first note with another one at the top', previous: prev, names })
    const r2 = b.reply({ catalog: cat, state: {}, pending: s2.pending, reply: answers(s2.request.json.questions, { remove_note: true, add_note: 'use' }), names })
    const out2 = b.reply({ catalog: cat, state: {}, pending: json(r2.pending), names, reply: answers(r2.request.json.questions, { 'where_note_3': 'top' }) })
    expect(out2.layout.nodes.page.slots.default).toEqual(['note~3', 'chart', 'note~2'])
  })
})

// ---------- random edits of random layouts ----------
/** a random but plausible edit: random call-1 answers, then random where answers, read by the module itself */
function randomEdit(backend, catalog, previous, r, prompt) {
  const s = backend.start({ catalog, state: {}, prompt, previous, names })
  const picks = {}
  const q = s.request.json.questions
  const leaves = editLeaves(catalog, previous, {})
  let adds = 0
  for (const [name, x] of Object.entries(q)) {
    const keys = x.criteria ? Object.keys(x.criteria) : []
    if (name.startsWith('remove_')) picks[name] = r() < 0.2
    else if (name.startsWith('set_') && !/__c\d+$/.test(name)) picks[name] = r() < 0.25 ? pickOne(r, keys) : 'keep'
    else if (name.startsWith('add_')) picks[name] = r() < 0.2 && adds++ < 2 ? pickOne(r, keys.filter((k) => k !== 'omit')) : 'omit'
    else if (name.startsWith('rec_') || name.startsWith('param_')) picks[name] = r() < 0.4 ? pickOne(r, keys) : keys[0]
    else if (name === 'swap') picks[name] = r() < 0.2
    else if (name === 'placed') picks[name] = r() < 0.1
  }
  picks.change = Object.entries(picks).some(([k, v]) => k.startsWith('set_') && v !== 'keep')
  const moving = leaves.filter(() => r() < 0.2).slice(0, 2)
  moving.forEach((l, i) => { picks[`moved_${i + 1}`] = l.key })
  const real = Object.fromEntries(Object.entries(picks).filter(([k]) => q[k]))
  const out1 = backend.reply({ catalog, state: {}, pending: s.pending, reply: answers(q, real), names })
  if (!out1.request) return out1.layout ?? previous
  const q2 = out1.request.json.questions
  const where = Object.fromEntries(Object.entries(q2).map(([k, x]) => [k, pickOne(r, Object.keys(x.criteria))]))
  return backend.reply({ catalog, state: {}, pending: json(out1.pending), reply: answers(q2, where), names }).layout
}

const CATALOGS = [...Object.values(STRUCTURE).map((s) => [s.id, s.catalog]), ['ops', OPS], ['shop', SHOP], ['pm40', PM40], ['pm200', PM200]]

/** n random edits of random layouts of `catalog`: each round-trips through fake() (or is counted as unreachable) */
function randomEdits(id, catalog, seed, n, { strict }) {
  const backend = decisions({ model: 'test' })
  const r = rng(seed)
  let tried = 0, missed = 0
  for (let i = 0; i < n; i++) {
    const { target: start, prompt } = randomTarget(catalog, r, { maxLeaves: 7 })
    const previous = layoutOf(catalog, start)
    if (!editLeaves(catalog, previous, {}).length) continue
    const edited = randomEdit(backend, catalog, previous, r, prompt)
    const target = toTree(edited)
    const label = `${id} #${i} ${formatTree(toTree(previous))} → ${formatTree(target)}`
    if (!editLeaves(catalog, edited, {}).length || JSON.stringify(target) === JSON.stringify(toTree(previous))) continue
    tried++
    let trip
    try { trip = editTrip(backend, catalog, previous, prompt, target) } catch (e) {
      if (strict || !/can't reach the target/.test(e.message)) throw e
      missed++
      continue
    }
    // a fake reply always reads as its target (it is checked), and keys are kept
    expect(formatTree(toTree(trip.out.layout)), label).toBe(formatTree(target))
    expect(trip.calls, label).toBeLessThanOrEqual(2)
    expectKeysKept(catalog, previous, trip.out.layout)
    expectKeysKept(catalog, previous, edited)
    expect(sortedLeafKeys(catalog, trip.out.layout, previous), label).toEqual(sortedLeafKeys(catalog, edited, previous))
  }
  return { tried, missed }
}

describe('compose.decisions() edits: random edits of random layouts round-trip through fake()', () => {
  for (const [id, catalog] of CATALOGS) {
    it(`${id}: 150 random edits, every one reached`, () => {
      const { tried } = randomEdits(id, catalog, id.length * 31 + 7, 150, { strict: true })
      expect(tried).toBeGreaterThan(100)
    })
  }

  // the fake searches the answers; an edit whose result finish() reshapes (a group's second part
  // dropped, an over-full row split, a pinned part reordered after a move next to a mover) may have
  // no answers it finds: measured at 1,500 edits per catalog, 25 of 13,500 (0.2%). 300 per catalog
  // took 4.4 s alone and over vitest's 5 s default timeout under a loaded run: the
  // default run takes 100 per catalog (fixed seeds, other edits than the 150 above: 845 tried, 1
  // missed, 1.8 s alone), P9_HEAVY=1 the 300 (2,556 tried, 6 missed, 4.7 s); the timeout covers both
  // on a loaded machine
  const MORE = process.env.P9_HEAVY ? 300 : 100
  it(`${MORE} more per catalog: ≥ 99% reached`, () => {
    let tried = 0, missed = 0
    for (const [id, catalog] of CATALOGS) {
      const x = randomEdits(id, catalog, id.length * 97 + 3, MORE, { strict: false })
      tried += x.tried
      missed += x.missed
    }
    expect(tried).toBeGreaterThan(MORE * CATALOGS.length * 0.74)
    expect(missed / tried).toBeLessThan(0.01)
  }, 20_000)
})

// ---------- through the compose behavior ----------
describe('compose.decisions() edits in the compose behavior', () => {
  let t
  beforeEach(() => setupChecks())
  afterEach(() => { t?.dispose(); t = null })

  it('a follow-up is an edit: a preview after call 1, keys and instances kept, a setting changed in place, a part moved into a tab', async () => {
    const backend = compose.decisions({ model: 'jev-latest' })
    t = renderComponent(makeApp(backend), { strict: true })
    t.simulateAction('page.COMPOSE', 'The revenue chart, my tasks and the orders')
    await t.next((s) => s.page.status === 'composing')
    await composeWith(t, appCatalog, [{ part: 'revenueChart' }, { part: 'tasks' }, { part: 'orders' }])
    await t.waitForState((s) => s.page.status === 'done')
    t.simulateEvent('.task-toggle[data-id="2"]', 'change')
    await t.next((s) => s.tasks[1].done)
    const before = t.state.page.layout
    const ids = () => t.inspect().components.filter((c) => c.name === 'Checklist').map((c) => c.id)
    const checklist = ids()

    t.simulateAction('page.COMPOSE', 'Quarterly chart, and put the tasks and the orders in tabs')
    await t.next((s) => s.page.status === 'composing')
    expect(t.state.page.pending.step).toBe('edit')
    const target = [{ part: 'revenueChart', params: { range: 'quarter' } }, { part: 'tabs', children: { overview: [{ part: 'tasks' }], billing: [{ part: 'orders' }] } }]
    // call 1 only: the preview shows the settings change while call 2 places the movers
    await t.respond('HTTP', backend.fake({ catalog: appCatalog, state: t.state, pending: t.state.page.pending, target }), 'page.REPLY')
    await t.waitForState((s) => s.page.status === 'preview')
    expect(t.state.page.preview.nodes.revenueChart.params).toEqual({ range: 'quarter' })
    expect(t.state.page.pending.step).toBe('where')
    await composeWith(t, appCatalog, target)
    await t.waitForState((s) => s.page.status === 'done' && s.page.layout.nodes.tabs)
    const after = t.state.page.layout
    expect(toTree(after)).toEqual(target)
    for (const k of ['revenueChart', 'tasks', 'orders']) expect(after.nodes[k].part).toBe(before.nodes[k].part)
    expect(Object.keys(t.state.page.decisions)).toEqual(['edit', 'where'])
    expect(t.state.tasks[1].done).toBe(true)
    expect(ids()).toEqual(checklist)
    expect(t.query('[data-range]')?.getAttribute('data-range') ?? t.query('.chart').getAttribute('data-range')).toBe('quarter')
    t.expectNoDiagnostics()
  })
})
