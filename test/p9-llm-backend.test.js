// PLAN-9 B-3 compose.llm(): the request, the schema per catalog, the repair, the streamed
// preview, fake() and errors (SYG683). No network. Catalogs come from the real defineCatalog
// (test/p9-llm-helpers.js `catalog()`).
import { describe, it, expect, afterEach } from 'vitest'
import { llm, layoutSchema, systemPrompt, parsePartialJSON } from '../src/extra/ai/compose/llm.ts'
import { check } from '../src/extra/ai/schema/jsonSchema.ts'
import { configureDiagnostics, getDiagnostics, clearDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'
import { catalog, tree, str, names, researchSets } from './p9-llm-helpers.js'

const SHOP = catalog({
  parts: {
    revenue: { description: 'KPI card: revenue' },
    chart: { description: 'Line chart: revenue trend', params: { range: { label: 'time span', default: 'year', options: { month: 'the last 30 days', year: 'the last 12 months' } } } },
    tickets: { description: 'List of support tickets', params: {
      search: { type: 'text', label: 'words a ticket must contain', maxLength: 10, default: '' },
      limit: { type: 'number', label: 'rows', min: 1, max: 50, default: 10, bins: { 5: 'a few', 25: 'a long list' } },
    } },
    poll: { description: 'A poll', params: { options: { type: 'list', label: 'the answer options', min: 2, max: 4, items: { maxLength: 12 } }, question: { type: 'text', label: 'the question', required: true } } },
    project: { description: 'A project card', params: { id: { from: (s) => s.projects, label: 'which project' } } },
    field: { description: 'A form field', in: ['tabs:general'] },
    tab: { description: 'A tab-only note', in: ['tabs'] },
    header: { description: 'The page header', required: true, pin: 'start' },
    priceTable: { description: 'Pricing as a table', group: 'pricing' },
    priceCards: { description: 'Pricing as cards', group: 'pricing' },
  },
  containers: {
    tabs: { description: 'Tabs', slots: { general: 'General settings', billing: 'Billing' }, arranged: true },
  },
})
const STATE = { projects: [{ value: 'apollo', name: 'Apollo', aliases: ['moon'], description: 'the launch site' }, { value: 'zephyr', name: 'Zephyr', description: 'the wind farm' }] }

const run = (cat, value, state = STATE, b = llm()) => {
  const { pending } = b.start({ catalog: cat, state, prompt: 'x', previous: null, names })
  return b.reply({ catalog: cat, state, pending, reply: typeof value === 'string' ? { text: value } : { value, text: JSON.stringify(value) } })
}
const def = (schema, name) => schema.$defs[name]
const alt = (schema, defName, part) => def(schema, defName).anyOf.find((a) => a.properties.part.const === part)

afterEach(() => { _resetDiagnostics() })

describe('the request', () => {
  it('one structured-output chat request: key, latest, reply names, delta when streaming, model, transport options', () => {
    const b = llm({ model: 'm1', body: { temperature: 0 } })
    expect(b.sink).toBe('LLM')
    const { request, pending } = b.start({ catalog: SHOP, state: STATE, prompt: 'Show revenue', previous: null, names })
    expect(request).toMatchObject({ model: 'm1', body: { temperature: 0 }, key: 'compose', latest: true, ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA' })
    expect(request.messages).toEqual([{ role: 'user', content: 'Show revenue' }])
    expect(request.instructions).toBe(systemPrompt(SHOP, STATE))
    expect(request.output['~standard'].jsonSchema.input()).toEqual(layoutSchema(SHOP, STATE))
    // the reply is not rejected by the driver: the backend repairs it
    expect(request.output['~standard'].validate({ nonsense: 1 })).toEqual({ value: { nonsense: 1 } })
    expect(pending).toEqual({ step: 'llm', prompt: 'Show revenue', plan: true })
    expect(JSON.parse(JSON.stringify(pending))).toEqual(pending)
  })

  it('stream: false sends no delta; sink and key options', () => {
    const { request } = llm({ stream: false, sink: 'AI', key: 'k' }).start({ catalog: SHOP, state: STATE, prompt: 'p', previous: null, names })
    expect(request.delta).toBeUndefined()
    expect(request.key).toBe('k')
    expect(llm({ sink: 'AI' }).sink).toBe('AI')
  })

  it('previous: an edit (B-4, ops2: test/p9-llm-edits), kept in pending; an empty page composes fresh', () => {
    const previous = { root: 'page', nodes: { page: { part: 'page', slots: { default: ['revenue'] } }, revenue: { part: 'revenue' } } }
    const { request, pending } = llm().start({ catalog: SHOP, state: STATE, prompt: 'p', previous, names })
    expect(request.messages).toEqual([{ role: 'user', content: 'Current page:\nn0: page\n  n1: revenue\n\nChange: p' }])
    expect(pending).toMatchObject({ step: 'edit', previous, order: ['page', 'revenue'] })
    const empty = { root: 'page', nodes: { page: { part: 'page', slots: { default: [] } } } }
    expect(llm().start({ catalog: SHOP, state: STATE, prompt: 'p', previous: empty, names }).request.messages).toEqual([{ role: 'user', content: 'p' }])
  })

  it('the prompt: params, records, bins, `in`, named slots, guidance, instructions; plan on by default', () => {
    const cat = { ...SHOP, guidance: 'Prefer charts over tables.\n- Never use tabs for one part.' }
    const p = systemPrompt(cat, STATE, { instructions: 'Answer in English.' })
    expect(p).toContain('    param range: time span. one of month = the last 30 days; year = the last 12 months (default year)')
    expect(p).toContain('    param id: which project. one of apollo = Apollo: the launch site (also moon); zephyr = Zephyr: the wind farm')
    expect(p).toContain('    param limit: rows. a number from 1 to 50; 5 = a few; 25 = a long list (default 10)')
    expect(p).toContain('    param search: words a ticket must contain; short text, at most 10 characters; "" when the request does not say')
    expect(p).toContain('    param options: the answer options; a list of 2 to 4 short texts')
    expect(p).toContain('    param question: the question; short text, at most 40 characters; always set it')
    expect(p).toContain('- field: A form field (only inside tabs slot general)')
    expect(p).toContain('- tabs: Tabs (slot general: General settings; slot billing: Billing)')
    expect(p).toContain('- row: Row: shows its parts side by side, left to right (at least 2, at most 4; parts only, no containers)')
    expect(p).toContain('- Prefer charts over tables.\n- Never use tabs for one part.\n- First write asked_for')
    expect(p).toContain('Answer in English.\n\nReply with JSON only')
    expect(p).toContain('instead of "children"')
    expect(p).not.toContain('header')   // required parts are added by finish, not asked (so every finished layout below starts with header: pin 'start')
    expect(systemPrompt(cat, STATE, { instructions: (s) => s.toUpperCase() })).toBe(systemPrompt(cat, STATE).toUpperCase())
  })

  it('examples become few-shot turns; with examples the plan is off by default (research §4)', () => {
    const cat = { ...SHOP, examples: [['Revenue, then the chart for this month', tree('revenue chart{range=month}')], { prompt: 'Play music', tree: [] }] }
    const { request, pending } = llm().start({ catalog: cat, state: STATE, prompt: 'p', previous: null, names })
    expect(pending.plan).toBe(false)
    expect(request.instructions).not.toContain('asked_for')
    expect(request.output['~standard'].jsonSchema.input().required).toEqual(['children'])
    expect(request.messages).toEqual([
      { role: 'user', content: 'Revenue, then the chart for this month' },
      { role: 'assistant', content: '{"children":[{"part":"revenue"},{"part":"chart","params":{"range":"month"}}]}' },
      { role: 'user', content: 'Play music' },
      { role: 'assistant', content: '{"children":[]}' },
      { role: 'user', content: 'p' },
    ])
    const forced = llm({ plan: true }).start({ catalog: cat, state: STATE, prompt: 'p', previous: null, names }).request
    expect(JSON.parse(forced.messages[1].content).asked_for).toEqual(['KPI card: revenue', 'Line chart: revenue trend'])
  })
})

describe('the schema, per catalog', () => {
  const s = layoutSchema(SHOP, STATE)

  it('tree+plan: asked_for first, then children; closed objects', () => {
    expect(Object.keys(s.properties)).toEqual(['asked_for', 'children'])
    expect(s.required).toEqual(['asked_for', 'children'])
    expect(s.properties.asked_for).toEqual({ type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 8 })
    for (const d of Object.values(s.$defs)) for (const a of d.anyOf) expect(a.additionalProperties).toBe(false)
  })

  it('page level: the parts allowed on the page, rows and containers; not required ones, not tab-only ones', () => {
    const page = s.properties.children.items.$ref.split('/').pop()
    const ids = def(s, page).anyOf.map((a) => a.properties.part.const)
    expect(ids).toEqual(['revenue', 'chart', 'tickets', 'poll', 'project', 'priceTable', 'priceCards', 'row', 'tabs'])
  })

  it('params: enum, text, number, list, record enum from state; required where the model must say', () => {
    const page = s.properties.children.items.$ref.split('/').pop()
    expect(alt(s, page, 'chart').properties.params).toEqual({ type: 'object', properties: { range: { enum: ['month', 'year'] } }, required: ['range'], additionalProperties: false })
    expect(alt(s, page, 'chart').required).toEqual(['part', 'params'])
    expect(alt(s, page, 'tickets').properties.params.properties).toEqual({ search: { type: 'string', maxLength: 10 }, limit: { type: 'number', minimum: 1, maximum: 50 } })
    expect(alt(s, page, 'tickets').properties.params.required).toEqual([])
    expect(alt(s, page, 'poll').properties.params).toEqual({ type: 'object', properties: {
      options: { type: 'array', items: { type: 'string', maxLength: 12 }, minItems: 2, maxItems: 4 },
      question: { type: 'string', maxLength: 40 },
    }, required: ['options', 'question'], additionalProperties: false })
    expect(alt(s, page, 'project').properties.params.properties.id).toEqual({ enum: ['apollo', 'zephyr'] })
    expect(alt(s, page, 'project').properties.params.required).toEqual(['id'])
    // records come from state: other state, other enum; none at all → not choosable
    const s2 = layoutSchema(SHOP, { projects: [{ value: 'x' }] })
    expect(alt(s2, s2.properties.children.items.$ref.split('/').pop(), 'project').properties.params.properties.id.enum).toEqual(['x'])
    const s3 = layoutSchema(SHOP, { projects: [] })
    expect(alt(s3, s3.properties.children.items.$ref.split('/').pop(), 'project')).toBeUndefined()
  })

  it('a row holds parts only (no containers), at most 4, in its parent place; tabs: named slots with their own `in`', () => {
    const page = s.properties.children.items.$ref.split('/').pop()
    const row = alt(s, page, 'row')
    expect(row.properties.children.maxItems).toBe(4)
    expect(row.required).toEqual(['part', 'children'])
    const inRow = def(s, row.properties.children.items.$ref.split('/').pop()).anyOf.map((a) => a.properties.part.const)
    expect(inRow).toEqual(['revenue', 'chart', 'tickets', 'poll', 'project', 'priceTable', 'priceCards'])
    const tabs = alt(s, page, 'tabs')
    expect(tabs.required).toEqual(['part', 'general', 'billing'])
    const general = def(s, tabs.properties.general.items.$ref.split('/').pop()).anyOf.map((a) => a.properties.part.const)
    const billing = def(s, tabs.properties.billing.items.$ref.split('/').pop()).anyOf.map((a) => a.properties.part.const)
    expect(general).toEqual(['field', 'tab'])   // arranged: no rows inside
    expect(billing).toEqual(['tab'])
  })

  it('depth: no container below maxDepth (page = 0, its children at 1: finish()\'s rule); places that allow the same parts share one definition', () => {
    const c = catalog({ parts: { a: { description: 'A', in: ['page', 'box'] }, b: { description: 'B', in: ['page', 'box'] } }, containers: { box: { description: 'Box', slots: { default: null }, in: ['page', 'box'] } }, limits: { maxDepth: 1 } })
    const sc = layoutSchema(c, {})
    expect(Object.keys(sc.$defs)).toEqual(['d1', 'd2'])
    expect(def(sc, 'd1').anyOf.map((a) => a.properties.part.const)).toEqual(['a', 'b', 'row', 'box'])
    expect(def(sc, 'd2').anyOf.map((a) => a.properties.part.const)).toEqual(['a', 'b'])
    const deep = layoutSchema({ ...c, limits: { maxDepth: 2 } }, {})
    expect(Object.keys(deep.$defs).length).toBe(3)   // page (a, b, row, box); parts only (a row anywhere, a box at 2); a box at 1 (a, b, row, box: deeper)
  })
})

describe('reply: read, repair, validate', () => {
  it('a clean reply → the layout through fromTree and finish; decisions = the plan', () => {
    const r = run(SHOP, { asked_for: ['revenue', 'monthly chart'], children: [{ part: 'revenue' }, { part: 'chart', params: { range: 'month' } }] })
    expect(str(SHOP, r.layout)).toBe('header revenue chart{range=month}')
    expect(r.layout.nodes.chart).toEqual({ part: 'chart', params: { range: 'month' } })
    expect(r.decisions).toEqual({ asked_for: ['revenue', 'monthly chart'] })
  })

  it('params hold only non-default values', () => {
    const r = run(SHOP, { children: [{ part: 'chart', params: { range: 'year' } }, { part: 'tickets', params: { search: '', limit: 10 } }] })
    expect(r.layout.nodes.chart).toEqual({ part: 'chart' })
    expect(r.layout.nodes.tickets).toEqual({ part: 'tickets' })
  })

  it('an empty list: nothing fits → layout null, unavailable', () => {
    expect(run(SHOP, { asked_for: [], children: [] })).toEqual({ layout: null, unavailable: true, decisions: { asked_for: [] } })
  })

  it('duplicates: kept the first time (maxUses per identity, records count apart), one part per group', () => {
    const r = run(SHOP, { children: [{ part: 'revenue' }, { part: 'chart', params: { range: 'year' } }, { part: 'revenue' },
      { part: 'project', params: { id: 'apollo' } }, { part: 'project', params: { id: 'zephyr' } }, { part: 'project', params: { id: 'apollo' } },
      { part: 'priceTable' }, { part: 'priceCards' }] })
    expect(str(SHOP, r.layout)).toBe('header revenue chart project project priceTable')
    expect(Object.keys(r.layout.nodes)).toContain('project:zephyr')
    expect(r.decisions.repairs.filter((i) => i.kind === 'duplicate').map((i) => i.detail)).toEqual(['revenue', 'project:apollo', 'group pricing: priceCards'])
  })

  it('a row of one part is unwrapped; an empty row dropped; a row over 4 split', () => {
    expect(str(SHOP, run(SHOP, { children: [{ part: 'row', children: [{ part: 'revenue' }] }, { part: 'row', children: [] }] }).layout)).toBe('header revenue')
    const six = ['revenue', 'chart', 'tickets', 'project', 'priceTable', 'poll'].map((part) => ({ part, ...(part === 'project' && { params: { id: 'apollo' } }), ...(part === 'poll' && { params: { options: ['a', 'b'], question: 'q' } }) }))
    expect(str(SHOP, run(SHOP, { children: [{ part: 'row', children: six }] }).layout)).toBe('header row(revenue,chart,tickets,project) row(priceTable,poll)')
  })

  it('aliases (unconstrained output): type/name for part, parts for children, flat params, a bare list, a single node', () => {
    const r = run(SHOP, { parts: [{ type: 'row', parts: [{ name: 'revenue' }, { component: 'chart', range: 'month' }] }] })
    expect(str(SHOP, r.layout)).toBe('header row(revenue,chart{range=month})')
    expect(r.decisions.repairs.filter((i) => i.kind === 'alias').map((i) => i.detail)).toEqual(['parts for children', 'type: row', 'name: revenue', 'component: chart', 'flat params on chart'])
    expect(str(SHOP, run(SHOP, [{ part: 'revenue' }]).layout)).toBe('header revenue')
    expect(str(SHOP, run(SHOP, { part: 'revenue' }).layout)).toBe('header revenue')
  })

  it('unknown parts dropped (their children lifted), children on a leaf lifted, unknown slot → default', () => {
    const r = run(SHOP, { children: [{ part: 'stockTicker', children: [{ part: 'revenue' }] }, { part: 'chart', params: { range: 'month' }, children: [{ part: 'tickets' }] }] })
    expect(str(SHOP, r.layout)).toBe('header revenue chart{range=month} tickets')
    const t = run(SHOP, { children: [{ part: 'tabs', general: [{ part: 'field' }], extra: [{ part: 'tab' }], billing: [] }] })
    expect(t.layout.nodes.tabs.slots).toEqual({ general: ['field', 'tab'] })   // a layout omits empty slots
  })

  it('bad params → defaults; text cut to maxLength; numbers clamped / parsed; lists trimmed and deduped', () => {
    const r = run(SHOP, { children: [
      { part: 'chart', params: { range: 'decade', color: 'red' } },
      { part: 'tickets', params: { search: '  safari checkout bug  ', limit: '200' } },
      { part: 'poll', params: { options: ['yes', 'yes', ' no ', 'a very long option text'], question: 'Lunch?' } },
    ] })
    expect(r.layout.nodes.chart).toEqual({ part: 'chart' })
    expect(r.layout.nodes.tickets.params).toEqual({ search: 'safari che', limit: 50 })
    expect(r.layout.nodes.poll.params).toEqual({ options: ['yes', 'no', 'a very long '], question: 'Lunch?' })
    expect(r.decisions.repairs.filter((i) => i.kind === 'param').map((i) => i.detail)).toEqual(['chart.range=decade', 'chart.color unknown'])
  })

  it('a record outside the state, a missing required text or list: the node is dropped', () => {
    const r = run(SHOP, { children: [{ part: 'project', params: { id: 'mars' } }, { part: 'poll', params: { options: ['a'] } }, { part: 'revenue' }] })
    expect(str(SHOP, r.layout)).toBe('header revenue')
  })

  it('a container in a row, or past maxDepth, is lifted; a part outside its `in` is left to finish', () => {
    const r = run(SHOP, { children: [{ part: 'row', children: [{ part: 'tabs', general: [{ part: 'field' }], billing: [] }, { part: 'revenue' }] }] })
    expect(r.decisions.repairs.map((i) => i.detail)).toContain('tabs too deep or not accepted')
    expect(r.decisions.repairs.map((i) => i.detail)).toContain('field not allowed in page:default')
    expect(r.layout).toBeTruthy()
  })

  it('the research repair cases (llm/REPORT.md §3): every recorded constrained reply was valid; repairs only for blocks/flat/tools', () => {
    // a part used twice, a row of one, children on a leaf, key-as-part (flat) → all repaired, none an error
    const r = run(SHOP, { children: [{ part: 'row', children: [{ part: 'revenue' }] }, { part: 'revenue' }, { part: 'chart', params: { range: 'month' } }] })
    expect(str(SHOP, r.layout)).toBe('header revenue chart{range=month}')
  })
})

describe('reply errors: SYG683, never a layout', () => {
  it('not JSON, not an object, no list of parts, only unknown parts → { error } and SYG683', () => {
    configureDiagnostics({ mode: 'collect' })
    clearDiagnostics()
    for (const bad of ['Sure! Here is your page.', { foo: 'bar' }, { children: [{ part: 'stockTicker' }, { part: 'news' }] }, 42]) {
      const r = typeof bad === 'number' ? run(SHOP, bad) : run(SHOP, bad)
      expect(r.error).toMatch(/not a layout/)
      expect(r.layout).toBeUndefined()
    }
    expect(getDiagnostics().map((d) => d.code)).toEqual(['SYG683', 'SYG683', 'SYG683', 'SYG683'])
    expect(getDiagnostics()[0].component).toBe('compose.llm')
  })

  it('JSON inside prose or a code fence is read', () => {
    expect(str(SHOP, run(SHOP, 'Here you go:\n```json\n{"children":[{"part":"revenue"}]}\n```').layout)).toBe('header revenue')
    expect(str(SHOP, run(SHOP, '<think>hmm</think>{"children":[{"part":"revenue"}]}').layout)).toBe('header revenue')
  })

  it('a required part the model wrote is not an error (finish adds it)', () => {
    expect(run(SHOP, { children: [{ part: 'header' }] })).toMatchObject({ layout: null, unavailable: true })
  })
})

describe('fake(): the JSON text of a target tree, read back to that target', () => {
  it('round-trips a tree with params, records, rows and named slots', () => {
    const b = llm()
    const target = [
      { part: 'row', children: [{ part: 'revenue' }, { part: 'chart', params: { range: 'month' } }] },
      { part: 'project', params: { id: 'zephyr' } },
      { part: 'tabs', children: { general: [{ part: 'field' }], billing: [{ part: 'tab' }] } },
      { part: 'tickets', params: { search: 'safari' } },
    ]
    const { pending } = b.start({ catalog: SHOP, state: STATE, prompt: 'p', previous: null, names })
    const text = b.fake({ catalog: SHOP, state: STATE, pending, target })
    const value = JSON.parse(text)
    expect(check(layoutSchema(SHOP, STATE), value)).toEqual([])
    expect(value.asked_for).toEqual(['revenue', 'chart', 'project', 'field', 'tab', 'tickets'])
    const r = b.reply({ catalog: SHOP, state: STATE, pending, reply: { text } })
    expect(str(SHOP, r.layout, { enumOnly: false })).toBe('header row(revenue,chart{range=month}) project{id=zephyr} tabs(field,tab) tickets{search=safari}')
    expect(r.layout.nodes.tabs.slots).toEqual({ general: ['field'], billing: ['tab'] })
    expect(r.layout.nodes['project:zephyr']).toEqual({ part: 'project', params: { id: 'zephyr' } })
  })

  it('every research case: fake(target) → reply → target', async () => {
    const b = llm()
    for (const { cases } of await researchSets()) {
      for (const k of cases) {
        const { pending } = b.start({ catalog: k.catalog, state: {}, prompt: k.prompt, previous: null, names })
        const target = tree(k.want)
        const r = b.reply({ catalog: k.catalog, state: {}, pending, reply: { text: b.fake({ catalog: k.catalog, state: {}, pending, target }) } })
        const got = r.layout ? str(k.catalog, r.layout) : ''
        const { want } = await import('./p9-llm-helpers.js')
        expect(got, k.id).toBe(want(k.catalog, k.want))
      }
    }
  })

  it('without the plan: no asked_for', () => {
    const b = llm({ plan: false })
    const { pending } = b.start({ catalog: SHOP, state: STATE, prompt: 'p', previous: null, names })
    expect(b.fake({ catalog: SHOP, state: STATE, pending, target: [{ part: 'revenue' }] })).toBe('{"children":[{"part":"revenue"}]}')
  })
})

describe('streaming: a preview of the complete parts so far', () => {
  const parents = (layout) => {
    const out = {}
    for (const [k, n] of Object.entries(layout.nodes)) for (const ks of Object.values(n.slots || {})) for (const c of ks) out[c] = k
    return out
  }

  it('parsePartialJSON closes what is open and drops an unfinished value', () => {
    expect(parsePartialJSON('{"a": [1, 2')).toEqual({ a: [1] })   // a number at the end may go on
    expect(parsePartialJSON('{"a": [1, 2]')).toEqual({ a: [1, 2] })
    expect(parsePartialJSON('{"a": "unfini')).toEqual({})
    expect(parsePartialJSON('{"a": 12')).toEqual({})
    expect(parsePartialJSON('')).toBeUndefined()
  })

  it('a leaf shows once its object closes (params final); a row shows what it holds', () => {
    const b = llm()
    const { pending } = b.start({ catalog: SHOP, state: STATE, prompt: 'p', previous: null, names })
    const at = (text) => b.delta({ catalog: SHOP, state: STATE, pending, delta: { text } }).preview
    expect(at('{"asked_for": ["rev')).toBeUndefined()
    expect(at('{"asked_for": ["revenue"], "children": [{"part": "chart", "params": {"range": "mo')).toBeUndefined()
    expect(str(SHOP, at('{"asked_for": ["revenue"], "children": [{"part": "chart", "params": {"range": "month"}}'))).toBe('chart{range=month}')
    expect(str(SHOP, at('{"asked_for": [], "children": [{"part": "row", "children": [{"part": "revenue"}, {"part": "tick'))).toBe('row(revenue)')
  })

  it('chunked streams of the recorded replies: no node disappears, changes key or moves; the end is the reply', async () => {
    const { readFileSync } = await import('node:fs')
    const answers = JSON.parse(readFileSync(new URL('../dev-plans/research/ai-compose/llm/frontier/qwen3-8b-answers.json', import.meta.url), 'utf8')).answers
    const byId = Object.fromEntries(answers.map((a) => [a.id, a.output]))
    let checked = 0
    for (const { cases } of await researchSets()) {
      for (const k of cases) {
        const b = llm()
        const { pending } = b.start({ catalog: k.catalog, state: {}, prompt: k.prompt, previous: null, names })
        const text = byId[k.id]
        let last = null
        for (let i = 1; i <= text.length; i += 7) {
          const { preview } = b.delta({ catalog: k.catalog, state: {}, pending, delta: { text: text.slice(0, i) } })
          if (!preview) { expect(last, `${k.id}@${i}: a preview disappeared`).toBeNull(); continue }
          if (last) {
            const was = parents(last), now = parents(preview)
            for (const [key, n] of Object.entries(last.nodes)) {
              expect(preview.nodes[key], `${k.id}@${i}: ${key} disappeared`).toBeTruthy()
              expect(preview.nodes[key].part).toBe(n.part)
              expect(preview.nodes[key].params).toEqual(n.params)
              expect(now[key], `${k.id}@${i}: ${key} moved`).toBe(was[key])
            }
          }
          last = preview
          checked++
        }
        const done = b.reply({ catalog: k.catalog, state: {}, pending, reply: { text } })
        // the final layout keeps the preview's keys (a row of one is unwrapped at the end)
        if (done.layout && last) for (const key of Object.keys(last.nodes)) if (last.nodes[key].part !== 'row') expect(done.layout.nodes[key], `${k.id}: ${key}`).toBeTruthy()
      }
    }
    expect(checked).toBeGreaterThan(300)
  })

  it('the preview is capped at limits.maxParts', () => {
    const c = { ...SHOP, limits: { ...SHOP.limits, maxParts: 2 } }
    const b = llm()
    const { pending } = b.start({ catalog: c, state: STATE, prompt: 'p', previous: null, names })
    const { preview } = b.delta({ catalog: c, state: STATE, pending, delta: { text: '{"children": [{"part": "revenue"}, {"part": "priceTable"}, {"part": "tickets"}, ' } })
    expect(str(c, preview)).toBe('revenue priceTable')
  })
})
