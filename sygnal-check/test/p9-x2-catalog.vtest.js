/**
 * PLAN-9 X-2: defineCatalog declarations (sygnal/ai), statically (rules/syg253-catalog.js).
 *
 *   SYG162  part with neither component nor render     SYG161  container render is a component with a model
 *   SYG450  `in` names an unknown container / slot / row; container min / max / accepts
 *   SYG250  unknown companion                          SYG680  required text param under compose.decisions()
 *   SYG253  misspelled declaration key (+ rename fix)  SYG254  description lint (model/catalogLint.js),
 *           calibrated on the research catalogs (dev-plans/research/ai-compose)
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles } from '../src/index.js'
import { applyEdits } from '../src/edits.js'
import { lintCatalog } from '../src/model/catalogLint.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const research = path.join(repo, 'dev-plans/research/ai-compose')

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function write(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p9-x2-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return Object.keys(files).map(f => path.join(tmp, f))
}
const check = (files, opts = {}) => checkFiles(write(files), { cwd: tmp, ...opts })
const CATALOG_CODES = /^SYG(161|162|250|253|254|450|680)$/
const found = (diags) => diags.filter(d => CATALOG_CODES.test(d.code)).map(d => `${d.code} ${d.line}`)
const only = (code, diags) => diags.filter(d => d.code === code)

const WIDGETS = `export function Kpi() { return <div /> }
export function Chart() { return <div /> }
export function Tabs({ slots }) { return <div>{slots.default}</div> }
export function Stateful({ state }) { return <div>{state.n}</div> }
Stateful.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
Stateful.initialState = { n: 0 }
`
const cat = (body, extra = '') => ({
  'widgets.jsx': WIDGETS,
  'catalog.js': `import { defineCatalog, compose } from 'sygnal/ai'
import { defineComponent } from 'sygnal'
import { Kpi, Chart, Tabs, Stateful } from './widgets.jsx'
${extra}
export const catalog = defineCatalog(${body})
`,
})

describe('SYG162: a part with neither component nor render', () => {
  it('reports the part', async () => {
    const d = await check(cat(`{ parts: {
      revenue: { component: Kpi, description: 'Revenue (KPI card)' },
      empty: { description: 'Nothing (renders nothing)' },
    } }`))
    expect(found(d)).toEqual(['SYG162 7'])
    expect(only('SYG162', d)[0].severity).toBe('error')
    expect(only('SYG162', d)[0].message).toMatch(/part 'empty' has neither a component nor a render function/)
  })
  it('render is enough; a spread may bring the component', async () => {
    const d = await check(cat(`{ parts: {
      a: { render: (p) => <div />, description: 'A (a view)' },
      b: { ...base, description: 'B (from a spread)' },
    } }`, `const base = { component: Kpi }`))
    expect(found(d)).toEqual([])
  })
})

describe('SYG161: a container render that is a component with a model', () => {
  it('reports an imported component with statics, and defineComponent({ model })', async () => {
    const d = await check(cat(`{
      containers: {
        tabs: { slots: { a: 'A', b: 'B' }, render: Stateful },
        box: { render: Boxed },
        plain: { render: Tabs },
        inline: { render: ({ slots }) => <div>{slots.default}</div> },
      },
      parts: { revenue: { component: Kpi, description: 'Revenue (KPI card)', in: ['page', 'tabs:a'] } },
    }`, `const Boxed = defineComponent({ view: () => <div />, model: { X: (s) => s } })`))
    expect(found(d)).toEqual(['SYG161 7', 'SYG161 8'])
    expect(only('SYG161', d)[0].message).toMatch(/its render is Stateful, a component with \.model, \.initialState/)
  })
})

describe('SYG450: in names an unknown container or slot', () => {
  it('reports unknown containers, slots and row; accepts known places', async () => {
    const d = await check(cat(`{
      containers: { tabs: { slots: { overview: 'Overview', billing: 'Billing' } }, card: { in: ['tabs:overview', 'drawer'] } },
      parts: {
        a: { component: Kpi, description: 'A (one)', in: ['page', 'tabs', 'tabs:billing', 'card', 'card:default'] },
        b: { component: Kpi, description: 'B (two)', in: ['sidebar', 'tabs:settings', 'row', 'page:top'] },
      },
    }`))
    expect(found(d)).toEqual(['SYG450 6', 'SYG450 9', 'SYG450 9', 'SYG450 9', 'SYG450 9'])
    const msgs = only('SYG450', d).map(x => x.message)
    expect(msgs[0]).toMatch(/container 'card': `in` names an unknown container 'drawer'/)
    expect(msgs[1]).toMatch(/unknown container 'sidebar'/)
    expect(msgs[2]).toMatch(/unknown slot 'settings' of 'tabs' \(its slots: overview, billing\)/)
    expect(msgs[3]).toMatch(/'row' \(a row is placed where its parts may go\)/)
    expect(msgs[4]).toMatch(/unknown slot 'top' of 'page'/)
  })
  it('a string in, and container counts', async () => {
    const d = await check(cat(`{
      containers: { grid: { min: -1, max: 2.5, accepts: 'parts' }, pair: { min: 3, max: 2 } },
      parts: { a: { component: Kpi, description: 'A (one)', in: 'gird' } },
    }`))
    expect(found(d)).toEqual(['SYG450 6', 'SYG450 6', 'SYG450 6', 'SYG450 6', 'SYG450 7'])
  })
  it('containers the checker cannot list: no unknown-container finding', async () => {
    const d = await check(cat(`{ containers: { ...more }, parts: { a: { component: Kpi, description: 'A (one)', in: 'drawer' } } }`, `const more = {}`))
    expect(found(d)).toEqual([])
  })
})

describe('SYG250: a companion that is not a part', () => {
  it('reports it', async () => {
    const d = await check(cat(`{ parts: {
      name: { component: Kpi, description: 'Name (text field)', companions: ['save', 'cancle', 'name'] },
      save: { component: Kpi, description: 'Save (button)' },
    } }`))
    expect(found(d)).toEqual(['SYG250 6', 'SYG250 6'])
    expect(only('SYG250', d).map(x => x.data.companion)).toEqual(['cancle', 'name'])
  })
})

describe('SYG253: misspelled declaration keys', () => {
  const files = cat(`{
      parts: {
        revenue: { compnent: Kpi, descrption: 'Revenue (KPI card)', title: 'my own data' },
        chart: {
          component: Chart, description: 'Revenue chart (line chart)', maxuses: 2,
          params: { range: { options: { month: 'the last 30 days', year: 'the last 12 months' }, deafult: 'year' } },
        },
      },
      containers: { tabs: { slot: { a: 'A' } } },
      guidence: 'Put the chart first',
    }`)
  it('suggests the key, with a rename fix', async () => {
    const d = await check(files)
    const m = only('SYG253', d)
    expect(m.map(x => `${x.line} ${x.data.key}->${x.data.expected}`)).toEqual([
      '7 compnent->component', '7 descrption->description', '9 maxuses->maxUses', '10 deafult->default', '13 slot->slots', '14 guidence->guidance',
    ])
    // the part with `compnent` also has no component (SYG162), with the hint
    expect(only('SYG162', d)[0].message).toMatch(/`compnent` is not `component`/)
    // `title` (an app's own data) is not reported
    expect(m.some(x => x.data.key === 'title')).toBe(false)
    // the fixes rename the key
    const file = path.join(tmp, 'catalog.js')
    const src = fs.readFileSync(file, 'utf8')
    const edits = m.map(x => x.fixes[0].edits[0])
    expect(m.every(x => x.fixes[0].kind === 'quickfix' && x.fixes[0].preferred)).toBe(true)
    const fixed = applyEdits(src, edits)
    for (const k of ['guidance:', 'slots:', 'component: Kpi', "description: 'Revenue (KPI card)'", 'maxUses: 2', "default: 'year'"]) expect(fixed).toContain(k)
    const again = await checkFiles([file], { cwd: tmp, sources: { [file]: fixed } })
    expect(only('SYG253', again)).toEqual([])
    expect(only('SYG162', again)).toEqual([])
  })
})

describe('SYG680: a required text param under compose.decisions()', () => {
  const parts = `{ parts: {
      note: { component: Kpi, description: 'Note (a scratch note)', params: { heading: { type: 'text', required: true } } },
      memo: { component: Kpi, description: 'Memo (a short memo)', params: { heading: { type: 'text', required: true, default: 'Memo' } } },
      tags: { component: Kpi, description: 'Tags (a tag cloud)', params: { words: { type: 'list', required: true } } },
    } }`
  it('reports the part when the catalog is composed with compose.decisions()', async () => {
    const d = await check({ ...cat(parts), 'App.jsx': `import { compose } from 'sygnal/ai'
import { catalog } from './catalog.js'
const backend = compose.decisions({ model: 'jev' })
export default function App({ state }) { return <main /> }
App.uses = { page: compose(catalog, { backend }) }
` })
    expect(found(d)).toEqual(['SYG680 6', 'SYG680 8'])
    expect(only('SYG680', d).map(x => `${x.severity} ${x.data.part}.${x.data.param}`)).toEqual(['info note.heading', 'info tags.words'])
  })
  it('not under compose.llm(), nor when the backend is unknown', async () => {
    const d = await check({ ...cat(parts), 'App.jsx': `import { compose } from 'sygnal/ai'
import { catalog } from './catalog.js'
import { pick } from './backends.js'
export function A() { return <main /> }
A.uses = { page: compose(catalog, { backend: compose.llm({ model: 'x' }) }) }
export function B() { return <main /> }
B.uses = { page: compose(catalog, { backend: pick() }) }
` })
    expect(found(d)).toEqual([])
  })
})

describe('literal declarations only', () => {
  it('follows a const bound to an object literal; ignores a defineCatalog that is not sygnal\'s', async () => {
    const d = await check({
      'widgets.jsx': WIDGETS,
      'a.js': `import { defineCatalog } from 'sygnal/ai'
const parts = { x: { description: 'X (nothing)' } }
const decl = { parts }
export const a = defineCatalog(decl)
`,
      'b.js': `import { defineCatalog } from './lib.js'
export const b = defineCatalog({ parts: { x: { description: 'X (nothing)' } } })
`,
      'c.js': `import { defineCatalog } from 'sygnal/ai'
export const c = defineCatalog(makeDecl())
`,
    })
    expect(d.filter(x => CATALOG_CODES.test(x.code)).map(x => `${x.code} ${x.file}:${x.line}`)).toEqual(['SYG162 a.js:2'])
  })
})

// ---------------------------------------------------------------- SYG254: the description lint

describe('SYG254: overlapping descriptions and options', () => {
  it('flags the known bad pair ("monthly revenue" on the KPI and the chart) and the 12 months on the chart', async () => {
    const d = await check(cat(`{ parts: {
      revenue: { component: Kpi, description: 'KPI card: monthly revenue total ($48.2k)' },
      revenueChart: {
        component: Chart, description: 'Line chart: monthly revenue over the last 12 months',
        params: { range: { label: 'time range', default: 'year', options: { month: 'the last 30 days', quarter: 'the last 3 months', year: 'the last 12 months' } } },
      },
      orders: { component: Kpi, description: 'Orders (table of the most recent orders)' },
    } }`))
    const m = only('SYG254', d)
    expect(m.map(x => `${x.line} ${x.data.kind}`)).toEqual(['6 parts', '8 mentions'])
    expect(m[0].severity).toBe('info')
    expect(m[0].data.parts).toEqual(['revenue', 'revenueChart'])
    expect(m[0].message).toMatch(/share the phrase "monthly revenue"/)
    expect(m[0].related[0].line).toBe(8)
    expect(m[1].data).toMatchObject({ part: 'revenueChart', param: 'range', option: 'month' })
    expect(m[1].related[0].line).toBe(9)
  })
  it('the fixed wording (examples/ai-compose) is clean', async () => {
    const d = await check(cat(`{ parts: {
      revenue: { component: Kpi, description: "Revenue (KPI card: this month's revenue total as one number, $48.2k)" },
      revenueChart: {
        component: Chart, description: 'Revenue chart (line chart of the revenue trend over time)',
        params: { range: { label: 'time range', default: 'year', options: { year: 'the last 12 months (this year)', quarter: 'the last 3 months (this quarter)', month: 'the last 30 days (this month)' } } },
      },
    } }`))
    expect(only('SYG254', d)).toEqual([])
  })
  it('flags options of two params that share a word (the held-out tickets miss), not two defaults', async () => {
    const d = await check(cat(`{ parts: {
      tickets: { component: Kpi, description: 'List of support tickets', params: {
        status: { label: 'ticket status', default: 'open', options: { open: 'open tickets', closed: 'closed (resolved) tickets', all: 'all tickets, open and closed' } },
        priority: { label: 'priority', default: 'any', options: { any: 'tickets of any priority', high: 'high-priority (urgent) tickets only' } },
      } },
      projects: { component: Kpi, description: 'List of projects', params: {
        status: { default: 'any', options: { any: 'any status', done: 'done (finished)' } },
        owner: { default: 'anyone', options: { anyone: 'owned by anyone', maya: 'owned by Maya' } },
      } },
    } }`))
    const m = only('SYG254', d)
    expect(m.map(x => `${x.line} ${x.data.kind} ${x.data.params} ${x.data.options}`)).toEqual(['7 options status,priority all,any'])
    expect(m[0].related[0].line).toBe(8)
  })
  it('parts of one group may overlap', async () => {
    const d = await check(cat(`{ parts: {
      pricingTable: { component: Kpi, group: 'pricing', description: 'Pricing plans as a comparison table' },
      pricingCards: { component: Kpi, group: 'pricing', description: 'Pricing plans as three cards' },
    } }`))
    expect(only('SYG254', d)).toEqual([])
  })
})

describe('SYG254 calibration: the research catalogs', () => {
  const conv = (list) => ({ parts: Object.fromEntries(list.filter(p => !p.slots && !p.container).map(p => [p.id, {
    description: p.description, group: p.group ?? p.resource,
    params: Object.fromEntries(Object.entries(p.params || {}).filter(([, v]) => v.options).map(([k, v]) => [k, { options: v.options, default: v.default }])),
  }])) })
  const summary = (f) => f.map(x => x.kind === 'parts' ? `parts ${x.parts.join(',')}` : `${x.kind} ${x.part} ${x.param}${x.other ? ',' + x.other : ''}`)

  it('structure: dashboard, settings, CRM and landing are clean; ops (13 part errors in 45, pre noun-first wording) has 4', async () => {
    const { CATALOGS } = await import(path.join(research, 'structure/evals/catalogs.mjs'))
    for (const k of ['dashboard', 'settings', 'crm', 'landing']) expect(lintCatalog(conv(CATALOGS[k].parts)), k).toEqual([])
    expect(summary(lintCatalog(conv(CATALOGS.ops.parts)))).toEqual([
      'parts cpuChart,memChart', // "usage of the server fleet": likely a false positive (CPU vs memory leads)
      'parts dbLatency,slowQueries',
      'parts monthlySpend,spendChart,spendForecast',
      'parts flagList,flagChanges,staleFlags,flagToggle',
    ])
  })
  it('params: only the tickets wording the held-out case measured as a miss', async () => {
    const PE = await import(path.join(research, 'params-edits/evals/catalogs.mjs'))
    expect(summary(lintCatalog(conv(PE.OPS.parts)))).toEqual(['options tickets status,priority'])
    expect(lintCatalog(conv(PE.SHOP.parts))).toEqual([])
    expect(lintCatalog(conv(PE.pm().parts))).toEqual([])
  })
  it('llm: BASE and EXT are clean', async () => {
    const { BASE, EXT } = await import(path.join(research, 'llm/evals/cases.mjs'))
    expect(lintCatalog(conv(BASE.parts))).toEqual([])
    expect(lintCatalog(conv(EXT.parts))).toEqual([])
  })
  it('examples/ai-compose: no catalog finding', async () => {
    const file = path.join(repo, 'examples/ai-compose/src/catalog.js')
    const d = await checkFiles([file], { cwd: repo })
    expect(d.filter(x => CATALOG_CODES.test(x.code))).toEqual([])
  })
})
