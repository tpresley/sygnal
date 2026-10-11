/**
 * agent.queries (sygnal/ai): read-only tools, `run(state, input) => result`.
 *
 *   SYG246  a query without run, or with an async run
 *   SYG247  a query with the tool name of an action (snake case)
 *   SYG240 / SYG243 judge query inputs too
 *   --graph: agent.queries; strict-clean samples
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, graphFiles, validateSchema, CODES } from '../src/index.js'
import { formatGraph } from '../src/graphText.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(fs.readFileSync(path.join(here, '../schema/inspect.schema.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
function write(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-queries-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return Object.keys(files).map(f => path.join(tmp, f))
}
const check = (files, opts = {}) => checkFiles(write(files), { cwd: tmp, ...opts })
const only = (...cs) => (d) => d.filter(x => cs.includes(x.code))

const invoices = (agent, extra = '') => `import { z } from 'zod'
export default function Invoices({ state }) {
  return <p>{state.invoices.length} invoices</p>
}
Invoices.initialState = { invoices: [] }
Invoices.model = {
  PAY: (state, id) => ({ ...state, invoices: state.invoices.filter((i) => i.id !== id) }),
}
Invoices.agent = ${agent}
${extra}`

const CLEAN = invoices(`{
  name: 'invoices',
  description: 'The invoices',
  read: (state) => ({ count: state.invoices.length }),
  actions: { PAY: { description: 'Mark an invoice paid', input: z.number().int() } },
  queries: {
    find: {
      description: 'Invoices of a customer',
      input: z.object({ customer: z.string() }),
      run: (state, { customer }) => state.invoices.filter((i) => i.customer === customer),
    },
    total: { description: 'The sum of all invoices', run(state) { return state.invoices.reduce((n, i) => n + i.total, 0) } },
  },
}`)

describe('queries: clean', () => {
  it('a declaration with actions and queries has no findings under --strict', () => {
    expect(check({ 'Invoices.jsx': CLEAN }, { strict: true }).map(d => `${d.code} ${d.message}`)).toEqual([])
  })
  it('a declaration with queries only, run through a const', () => {
    const src = invoices(`{ name: 'stats', queries: { total: { description: 'Total', run: total } } }`, 'function total(state) { return state.invoices.length }').replace(/Invoices\.model = \{[\s\S]*?\n\}\n/, '')
    expect(check({ 'Invoices.jsx': src }, { strict: true }).map(d => d.code)).toEqual([])
  })
})

describe('SYG246: a query is a synchronous function', () => {
  const syg246 = only('SYG246')
  it('reports a missing run and an async one (arrow, method, function expression, through a const)', () => {
    const d = check({ 'Invoices.jsx': invoices(`{ name: 'i', queries: {
    none: { description: 'No run' },
    a: { description: 'A', run: async (state) => state.invoices },
    b: { description: 'B', async run(state) { return state.invoices } },
    c: { description: 'C', run: async function (state) { return 1 } },
    d: { description: 'D', run: load },
  } }`, 'const load = async () => fetch("/api")') })
    expect(syg246(d).map(x => x.data)).toEqual([
      { query: 'none', run: 'missing' }, { query: 'a', run: 'async' }, { query: 'b', run: 'async' }, { query: 'c', run: 'async' }, { query: 'd', run: 'async' },
    ])
    expect(syg246(d)[0]).toMatchObject({ severity: 'error', message: expect.stringContaining('Invoices.agent.queries.none has no run') })
    expect(syg246(d)[1].message).toContain('Invoices.agent.queries.a.run is async')
  })
  it('is quiet for a sync run, an unknown one, or a query object with spreads', () => {
    const d = check({ 'Invoices.jsx': invoices(`{ name: 'i', queries: {
    a: { description: 'A', run: helpers.a },
    b: { ...shared, description: 'B' },
    c: { description: 'C', run: (s) => s.invoices },
  } }`, 'const helpers = {}\nconst shared = {}') })
    expect(syg246(d)).toEqual([])
  })
})

describe('SYG247: a query with the tool name of an action', () => {
  it('compares snake-case tool names', () => {
    const d = check({ 'Invoices.jsx': invoices(`{ name: 'i', actions: { PAY: { description: 'Pay', input: z.number() } }, queries: { pay: { description: 'Shadowed', run: () => 1 }, payNow: { description: 'Ok', run: () => 2 } } }`) })
    expect(only('SYG247')(d).map(x => [x.severity, x.data])).toEqual([['warn', { query: 'pay', action: 'PAY' }]])
  })
})

describe('SYG240 / SYG243 on query inputs', () => {
  it('a raw JSON Schema and a Date', () => {
    const d = check({ 'Invoices.jsx': invoices(`{ name: 'i', queries: {
    raw: { description: 'Raw', input: { type: 'string' }, run: () => 1 },
    since: { description: 'Since', input: z.object({ from: z.date() }), run: () => 2 },
  } }`) })
    expect(only('SYG240', 'SYG243')(d).map(x => [x.code, x.data])).toEqual([['SYG240', { query: 'raw', kind: 'json' }], ['SYG243', { query: 'since' }]])
    expect(only('SYG240')(d)[0].message).toContain('Invoices.agent.queries.raw.input')
  })
})

describe('graph', () => {
  it('lists the queries; validates against the schema', () => {
    const g = graphFiles(write({ 'Invoices.jsx': CLEAN }), { cwd: tmp })
    expect(validateSchema(schema, g)).toEqual([])
    expect(g.components[0].agent).toEqual({
      name: 'invoices', tools: 'invoices', description: 'The invoices', read: true,
      actions: [{ name: 'PAY', consequential: false, input: true }],
      queries: [{ name: 'find', input: true }, { name: 'total', input: false }],
    })
    expect(formatGraph(g)).toContain('agent     invoices (read): PAY (input), find (query, input), total (query)')
  })
  it('no queries key without queries', () => {
    const g = graphFiles(write({ 'Invoices.jsx': invoices(`{ name: 'i', actions: { PAY: { description: 'Pay', input: z.number() } } }`) }), { cwd: tmp })
    expect(g.components[0].agent.queries).toBeUndefined()
  })
})

describe('codes', () => {
  it('registers SYG246 and SYG247', () => {
    expect(CODES.SYG246).toMatchObject({ severity: 'error', title: 'Agent query is not a synchronous function' })
    expect(CODES.SYG247).toMatchObject({ severity: 'warn', title: 'Agent query has the tool name of an action' })
  })
})
