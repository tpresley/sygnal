// PLAN-9 B-4: compose.llm() edits (ops2). The research's edit request, exactly (system prompt, user
// message, schema: llm-composer.mjs opsSystemPromptV2 / opsSchemaV2, evals/requests.mjs); qwen3:8b's
// recorded ops2 replies (frontier/qwen3-8b-answers.json) through reply(): edits 9/10, a2 edits
// 18/21, keys kept in every case (REPORT.md §2); the key rules op by op; streaming previews; fake()
// round trips over random edits. No network.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { llm, editPrompt, opsSchema, applyOps, preorder, currentPage } from '../src/extra/ai/compose/llm.ts'
import { fromTree, toTree, finish } from '../src/extra/ai/compose/layout.ts'
import { catalog, fromResearch, tree, str, want, names } from './p9-llm-helpers.js'

const R = new URL('../dev-plans/research/ai-compose/llm/', import.meta.url)
const research = await import(new URL('llm-composer.mjs', R))
const { editRequest } = await import(new URL('evals/requests.mjs', R))
const { EXT, EDIT_CASES } = await import(new URL('evals/cases.mjs', R))
const { toCatalog, blocksToString } = await import(new URL('evals/a2.mjs', R))
const A2 = await import(new URL('../params-edits/evals/cases.mjs', R))
const answers = Object.fromEntries(JSON.parse(readFileSync(new URL('frontier/qwen3-8b-answers.json', R), 'utf8')).answers.map((a) => [a.id, a.output]))

// the research's edit sets: edits (10, the EXT catalog) and a2 edits (21: a2.mjs loadA2('edits'))
const ext = fromResearch(EXT)
const a2cats = new Map()
const SETS = [
  { set: 'edits', cases: EDIT_CASES.map((k) => ({ ...k, rc: EXT, catalog: ext })) },
  { set: 'a2-edits', cases: A2.EDIT_CASES.filter(([, , , w]) => w).map(([c, prev, prompt, w], i) => {
    if (!a2cats.has(c)) a2cats.set(c, [toCatalog(c), fromResearch(toCatalog(c))])
    const [rc, cat] = a2cats.get(c)
    return { id: `a2-edit-${i + 1}`, rc, catalog: cat, prev: blocksToString(prev), prompt, want: blocksToString(w) }
  }) },
]
/** a labelled previous page as the app holds it */
const layoutOf = (cat, s) => finish(cat, fromTree(cat, tree(s)), {})
const canon = (v) => JSON.stringify(v, (_k, x) => x && typeof x == 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x)

describe('the research edit request, exactly', () => {
  for (const { set, cases } of SETS) {
    it(`${set}: system prompt, user message and schema as llm-composer.mjs ops2`, () => {
      for (const k of cases) {
        const prev = layoutOf(k.catalog, k.prev)
        const r = editRequest(k.rc, 'tree', k.prev, k.prompt, 'ops2')
        const { request, pending } = llm().start({ catalog: k.catalog, state: {}, prompt: k.prompt, previous: prev, names })
        expect(request.instructions).toBe(r.system)
        expect(request.messages).toEqual(r.messages)
        expect(opsSchema(k.catalog, {}, prev)).toEqual(r.schema)
        expect(request.output['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toEqual(r.schema)
        expect(request).toMatchObject({ key: 'compose', latest: true, parse: false, ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA' })
        expect(pending).toMatchObject({ step: 'edit', prompt: k.prompt, previous: prev, order: preorder(prev) })
      }
    })
  }

  it('the edit prompt drops the plan line and keeps guidance and instructions', () => {
    const cat = catalog({ parts: { a: { description: 'A' }, b: { description: 'B' } }, guidance: 'Prefer a.' })
    const p = editPrompt(cat, {}, { instructions: 'Be brief.' })
    expect(p).not.toContain('asked_for')
    expect(p).toContain('- Prefer a.\n\nBe brief.\n\nThe user message gives the current page')
    expect(p.endsWith('Reply with JSON only: {"ops": [ ... ]}')).toBe(true)
    expect(editPrompt(cat, {}, { instructions: (s) => s + '\nX' }).endsWith('\nX')).toBe(true)
  })
})

describe("qwen3:8b's recorded ops2 replies through reply()", () => {
  // research REPORT.md §2: ops2 9/10 and 18/21, keys all kept
  const expected = { edits: 9, 'a2-edits': 18 }
  for (const { set, cases } of SETS) {
    it(`${set}: ${expected[set]}/${cases.length} exact, keys kept in every case, none invalid`, () => {
      const b = llm()
      let exact = 0, keys = 0
      const misses = []
      for (const k of cases) {
        const prev = layoutOf(k.catalog, k.prev)
        const { pending } = b.start({ catalog: k.catalog, state: {}, prompt: k.prompt, previous: prev, names })
        const r = b.reply({ catalog: k.catalog, state: {}, pending, reply: { text: answers[k.id] } })
        expect(r.error).toBeUndefined()
        const layout = r.unavailable ? prev : r.layout
        if (!r.unavailable) expect(r.keyed).toBe(true)
        if (str(k.catalog, layout) === want(k.catalog, k.want)) exact++
        else misses.push(k.id)
        // every leaf part in the previous page and the expected one keeps its key (score.mjs keyKept)
        const W = tree(k.want).flatMap(function leaves(n) { return n.children ? n.children.flatMap(leaves) : [n.part] })
        const byPart = (l) => Object.fromEntries(Object.entries(l.nodes).filter(([, n]) => k.catalog.get(n.part)?.kind === 'part').map(([key, n]) => [n.part, key]))
        const p = byPart(prev), g = byPart(layout)
        if (W.filter((x) => p[x] && g[x]).every((x) => p[x] === g[x])) keys++
      }
      expect(exact).toBe(expected[set])
      expect(keys).toBe(cases.length)
      // the research's misses: row order ("Put them side by side"); a spurious setParams ("Show last
      // quarter instead" also sets a limit; "Show jackets instead" also rates the reviews); "Add
      // signups and churn" placed near the revenue (the label wants them at the bottom)
      expect(misses).toEqual({ edits: ['edit-5'], 'a2-edits': ['a2-edit-6', 'a2-edit-9', 'a2-edit-15'] }[set])
    })
  }
})

// a catalog with enum params, a record part, a row and a tabs container
const CAT = catalog({
  parts: {
    revenue: { description: 'KPI card: revenue' },
    churn: { description: 'KPI card: churn' },
    chart: { description: 'Line chart', params: { range: { label: 'span', default: 'year', options: { month: 'last 30 days', quarter: 'last 3 months', year: 'last 12 months' } } } },
    orders: { description: 'Orders', params: { status: { default: 'all', options: { all: 'every order', paid: 'paid only', refunded: 'refunded only' } } } },
    tickets: { description: 'Tickets' },
    weather: { description: 'Weather', in: ['page', 'tabs'] },
    tasks: { description: 'Tasks', in: ['page', 'tabs'] },
    project: { description: 'A project card', maxUses: 3, params: { id: { from: (s) => s.projects, label: 'which project' } } },
  },
  containers: { tabs: { slots: { one: 'Tab one', two: 'Tab two' }, minSlots: 2 } },
})
const STATE = { projects: [{ value: 'atlas', name: 'Atlas' }, { value: 'borealis', name: 'Borealis' }, { value: 'cedar', name: 'Cedar' }] }
const L = (s) => finish(CAT, fromTree(CAT, tree(s)), STATE)
const S = (l) => str(CAT, l, { enumOnly: false })

function edit(prevS, ops) {
  const prev = L(prevS)
  const b = llm()
  const { pending } = b.start({ catalog: CAT, state: STATE, prompt: 'x', previous: prev, names })
  const r = b.reply({ catalog: CAT, state: STATE, pending, reply: { text: JSON.stringify({ ops }) } })
  return { prev, r, layout: r.layout }
}

describe('the operations and the key rules', () => {
  it('the user message names the nodes n0, n1, … in preorder, params with their defaults', () => {
    const prev = L('row(revenue,churn) chart{range=month} orders project{id=atlas}')
    expect(currentPage(prev, { ctx: undefined })).toBe('n0: page\n  n1: row\n    n2: revenue\n    n3: churn\n  n4: chart range="month"\n  n5: orders\n  n6: project id="atlas"')
    const { request } = llm().start({ catalog: CAT, state: STATE, prompt: 'Only paid orders', previous: prev, names })
    expect(request.messages[0].content).toBe('Current page:\nn0: page\n  n1: row\n    n2: revenue\n    n3: churn\n  n4: chart range="month"\n  n5: orders status="all"\n  n6: project id="atlas"\n\nChange: Only paid orders')
  })

  it('setParams keeps the key; a record change is another node in the same place', () => {
    const a = edit('chart orders project{id=atlas} tasks', [{ op: 'setParams', node: 'n1', params: { range: 'quarter' } }, { op: 'setParams', node: 'n3', params: { id: 'cedar' } }])
    expect(S(a.layout)).toBe('chart{range=quarter} orders project{id=cedar} tasks')
    expect(a.layout.nodes.chart).toEqual({ part: 'chart', params: { range: 'quarter' } })
    expect(a.layout.nodes['project:cedar']).toBeTruthy()
    expect(a.layout.nodes['project:atlas']).toBeUndefined()
    // back to the default: stored without params, same key
    expect(edit('chart{range=month}', [{ op: 'setParams', node: 'n1', params: { range: 'year' } }]).layout.nodes.chart).toEqual({ part: 'chart' })
  })

  it('replace: a new node in the old one\'s place; the same part is a setParams; a part already there moves in', () => {
    let a = edit('revenue orders tickets', [{ op: 'replace', node: 'n2', part: 'weather' }])
    expect(S(a.layout)).toBe('revenue weather tickets')
    expect(Object.keys(a.layout.nodes).sort()).toEqual(['page', 'revenue', 'tickets', 'weather'])
    a = edit('revenue orders tickets', [{ op: 'replace', node: 'n2', part: 'orders', params: { status: 'paid' } }])
    expect(a.layout.nodes.orders).toEqual({ part: 'orders', params: { status: 'paid' } })
    expect(a.r.decisions.repairs[0].detail).toMatch(/same part = setParams/)
    a = edit('revenue orders tickets', [{ op: 'replace', node: 'n1', part: 'tickets' }])
    expect(S(a.layout)).toBe('tickets orders')
  })

  it('places: top, bottom, above / below (around the row), left of / right of (a new row, or in the row)', () => {
    expect(S(edit('revenue chart', [{ op: 'add', part: 'weather', where: 'top' }]).layout)).toBe('weather revenue chart')
    expect(S(edit('revenue chart', [{ op: 'add', part: 'weather', where: 'bottom' }]).layout)).toBe('revenue chart weather')
    expect(S(edit('row(revenue,churn) chart', [{ op: 'add', part: 'weather', where: 'below n2' }]).layout)).toBe('row(revenue,churn) weather chart')
    expect(S(edit('row(revenue,churn) chart', [{ op: 'add', part: 'weather', where: 'above n3' }]).layout)).toBe('weather row(revenue,churn) chart')
    let a = edit('revenue chart', [{ op: 'move', node: 'n2', where: 'right of n1' }])
    expect(S(a.layout)).toBe('row(revenue,chart)')
    expect(a.layout.nodes.chart && a.layout.nodes.revenue).toBeTruthy()
    a = edit('row(revenue,churn) chart', [{ op: 'add', part: 'weather', where: 'left of n3' }])
    expect(S(a.layout)).toBe('row(revenue,weather,churn) chart')
    expect(a.layout.nodes.row.slots.default).toEqual(['revenue', 'weather', 'churn'])
    // a second row gets a fresh key; the first one keeps its key
    a = edit('row(revenue,churn) chart orders', [{ op: 'move', node: 'n5', where: 'right of n4' }])
    expect(S(a.layout)).toBe('row(revenue,churn) row(chart,orders)')
    expect(a.layout.nodes.row.slots.default).toEqual(['revenue', 'churn'])
    expect(a.layout.nodes['row~2'].slots.default).toEqual(['chart', 'orders'])
  })

  it('the reference node never moves; a move relative to itself is skipped; unknown nodes and places are repairs', () => {
    let a = edit('revenue chart orders', [{ op: 'move', node: 'n1', where: 'below n1' }, { op: 'move', node: 'n3', where: 'top' }])
    expect(S(a.layout)).toBe('orders revenue chart')
    expect(a.r.decisions.repairs.map((i) => i.detail)).toEqual(['place: {"op":"move","node":"n1","where":"below n1"}'])
    a = edit('row(revenue,churn) chart', [{ op: 'move', node: 'n1', where: 'right of n2' }, { op: 'remove', node: 'n9' }, { op: 'add', part: 'weather', where: 'beside n2' }])
    expect(S(a.layout)).toBe('row(revenue,churn) chart weather')
    expect(a.r.decisions.repairs.map((i) => i.detail.split(':')[0])).toEqual(['place', 'no such node', 'place beside n2'])
  })

  it('remove takes the subtree; a row left with one part is unwrapped (the part keeps its key)', () => {
    let a = edit('row(revenue,churn) chart', [{ op: 'remove', node: 'n3' }])
    expect(S(a.layout)).toBe('revenue chart')
    expect(a.layout.nodes.revenue).toEqual({ part: 'revenue' })
    a = edit('row(revenue,churn) chart', [{ op: 'remove', node: 'n1' }])
    expect(S(a.layout)).toBe('chart')
  })

  it('an add of a part on the page moves it (key kept); real keys work as node names too', () => {
    const a = edit('revenue chart', [{ op: 'add', part: 'revenue', where: 'bottom' }, { op: 'setParams', node: 'chart', params: { range: 'month' } }])
    expect(S(a.layout)).toBe('chart{range=month} revenue')
    expect(a.r.decisions.ops).toEqual([{ op: 'move', node: 'revenue', where: 'bottom' }, { op: 'setParams', node: 'chart', params: { range: 'month' } }])
  })

  it('no operation: unavailable (the layout stays); none applies: error + SYG683; a whole page: read as a composition', () => {
    const prev = L('revenue chart')
    const b = llm()
    const { pending } = b.start({ catalog: CAT, state: STATE, prompt: 'x', previous: prev, names })
    expect(b.reply({ catalog: CAT, state: STATE, pending, reply: { text: '{"ops": []}' } })).toMatchObject({ layout: null, unavailable: true })
    const bad = b.reply({ catalog: CAT, state: STATE, pending, reply: { text: '{"ops": [{"op":"remove","node":"n7"}]}' } })
    expect(bad.error).toMatch(/does not apply \(no such node/)
    const whole = b.reply({ catalog: CAT, state: STATE, pending, reply: { text: '{"children": [{"part":"chart"},{"part":"revenue"},{"part":"weather"}]}' } })
    expect(S(whole.layout)).toBe('chart revenue weather')
    expect(whole.keyed).toBeUndefined()
    // a single operation, a bare list, `operations`
    for (const text of ['{"op":"remove","node":"n1"}', '[{"op":"remove","node":"n1"}]', '{"operations":[{"op":"remove","node":"n1"}]}']) {
      expect(S(b.reply({ catalog: CAT, state: STATE, pending, reply: { text } }).layout)).toBe('chart')
    }
  })

  it('applyOps never touches the previous layout', () => {
    const prev = L('row(revenue,churn) chart')
    const copy = JSON.parse(JSON.stringify(prev))
    applyOps(CAT, STATE, prev, preorder(prev), [{ op: 'remove', node: 'n2' }, { op: 'move', node: 'n4', where: 'top' }])
    expect(prev).toEqual(copy)
  })
})

describe('streaming an edit', () => {
  it('delta: the complete operations so far, applied (keys kept), never a half operation', () => {
    const prev = L('revenue chart orders')
    const b = llm()
    const { pending } = b.start({ catalog: CAT, state: STATE, prompt: 'x', previous: prev, names })
    const text = '{"ops": [{"op":"move","node":"n3","where":"top"}, {"op":"remove","node":"n1"}]}'
    const at = (n) => b.delta({ catalog: CAT, state: STATE, pending, delta: { text: text.slice(0, n) } })
    expect(at(20)).toEqual({})
    expect(at(text.indexOf('{"op":"remove"') + 10)).toEqual({ preview: expect.anything(), keyed: true })
    expect(S(at(text.indexOf('{"op":"remove"') + 10).preview)).toBe('orders revenue chart')
    expect(S(at(text.length).preview)).toBe('orders chart')
  })
})

// ------------------------------------------------------------------ fake() round trips
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) }
const LEAVES = ['revenue', 'churn', 'chart', 'orders', 'tickets', 'weather', 'tasks', 'project']
function randomTree(r) {
  const pool = LEAVES.filter(() => r() < 0.6)
  const ps = []
  const projects = ['atlas', 'borealis', 'cedar'].filter(() => r() < 0.5)
  for (const p of pool) {
    if (p === 'project') { for (const id of projects) ps.push({ part: 'project', params: { id } }); continue }
    if (p === 'chart' && r() < 0.5) ps.push({ part: 'chart', params: { range: ['month', 'quarter', 'year'][Math.floor(r() * 3)] } })
    else if (p === 'orders' && r() < 0.5) ps.push({ part: 'orders', params: { status: ['all', 'paid', 'refunded'][Math.floor(r() * 3)] } })
    else ps.push({ part: p })
  }
  for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]] }
  const out = []
  for (let i = 0; i < ps.length;) {
    const n = r() < 0.3 ? 2 + Math.floor(r() * 2) : 1
    const g = ps.slice(i, i + n)
    i += n
    out.push(g.length > 1 ? { part: 'row', children: g } : g[0])
  }
  return out
}

describe('fake(): the operations that make the target, round trips', () => {
  it('300 random edits: reply(fake) is the target, every kept part keeps its key; most are operations', () => {
    const r = rng(42)
    const b = llm()
    let viaOps = 0, n = 0
    for (let i = 0; i < 300; i++) {
      const prevT = randomTree(r), target = randomTree(r)
      if (!prevT.length || !target.length) continue
      n++
      const prev = finish(CAT, fromTree(CAT, prevT), STATE)
      const { pending } = b.start({ catalog: CAT, state: STATE, prompt: 'x', previous: prev, names })
      const text = b.fake({ catalog: CAT, state: STATE, pending, target })
      const out = b.reply({ catalog: CAT, state: STATE, pending, reply: { text } })
      const goal = finish(CAT, fromTree(CAT, target, prev), STATE)
      expect(out.error, text).toBeUndefined()
      expect(canon(toTree(out.layout)), text).toBe(canon(toTree(goal)))
      for (const [k, node] of Object.entries(prev.nodes)) if (CAT.get(node.part)?.kind === 'part' && goal.nodes[k]?.part === node.part) expect(out.layout.nodes[k]?.part, `${k} in ${text}`).toBe(node.part)
      if (JSON.parse(text).ops) viaOps++
    }
    expect(n).toBeGreaterThan(250)
    // a row made only of new parts can't be built by operations (they name existing nodes): the whole page
    expect(viaOps / n).toBeGreaterThan(0.75)
  })

  it('the operations are minimal for simple edits; [] is "nothing fits"; a new tabs container is the whole page', () => {
    const prev = L('revenue chart orders')
    const b = llm()
    const { pending } = b.start({ catalog: CAT, state: STATE, prompt: 'x', previous: prev, names })
    const fake = (target) => JSON.parse(b.fake({ catalog: CAT, state: STATE, pending, target: tree(target) }))
    expect(fake('orders revenue chart')).toEqual({ ops: [{ op: 'move', node: 'n3', where: 'top' }] })
    expect(fake('revenue chart{range=month} orders')).toEqual({ ops: [{ op: 'setParams', node: 'n2', params: { range: 'month' } }] })
    expect(fake('revenue orders')).toEqual({ ops: [{ op: 'remove', node: 'n2' }] })
    expect(fake('row(revenue,weather) chart orders')).toEqual({ ops: [{ op: 'add', part: 'weather', where: 'right of n1' }] })
    expect(JSON.parse(b.fake({ catalog: CAT, state: STATE, pending, target: [] }))).toEqual({ ops: [] })
    const tabs = JSON.parse(b.fake({ catalog: CAT, state: STATE, pending, target: [{ part: 'tabs', children: { one: [{ part: 'tasks' }], two: [{ part: 'weather' }] } }] }))
    expect(tabs.children[0].part).toBe('tabs')
  })
})
