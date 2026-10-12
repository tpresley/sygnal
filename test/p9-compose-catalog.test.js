// PLAN-9 K-1 (worker A): defineCatalog normalization and validation, options/records, byId, and
// the X-1 codes' registration.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.ts'
import { defineCatalog } from '../src/extra/ai/index.ts'
import { byId } from '../src/extra/lens.ts'
import * as sygnal from '../src/index.ts'
import { configureDiagnostics, getDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.ts'
import { CODE_TITLES, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.ts'
import { EXPLANATIONS } from '../sygnal-check/src/explanations.js'

beforeEach(() => { _resetDiagnostics(); configureDiagnostics({ mode: 'collect' }) })
afterEach(() => _resetDiagnostics())
const codes = () => getDiagnostics().map((d) => d.code)

const A = () => h('div', null, 'a')
const S = (state) => ({ customers: [{ id: 7, name: 'Northwind' }, { id: 9, name: 'Globex' }], ...state })

describe('defineCatalog', () => {
  it('normalizes parts, the built-ins and the defaults', () => {
    const c = defineCatalog({ parts: { a: { component: A, description: 'A (one)' } } })
    expect(Object.keys(c.containers)).toEqual(['page', 'row'])
    expect(c.containers.row).toMatchObject({ direction: 'row', min: 2, max: 4, accepts: 'leaves', slotNames: ['default'] })
    expect(c.parts.a).toMatchObject({ id: 'a', kind: 'part', in: ['page:default'], maxUses: 1, required: false, companions: [], result: false, params: {} })
    expect(c.limits).toEqual({ maxParts: 12, maxDepth: 4 })
    expect(c.examples).toEqual([])
    expect(c.get('a')).toBe(c.parts.a)
    expect(c.get('row')).toBe(c.containers.row)
    expect(c.get('toString')).toBe(undefined)
    expect(codes()).toEqual([])
  })

  it('params: options (default: the first), number, text, list, record', () => {
    const c = defineCatalog({ parts: { a: { component: A, description: 'A', params: {
      range: { options: { week: 'w', month: 'm' } },
      limit: { type: 'number', default: 10, bins: { 5: 'few' } },
      title: { type: 'text', maxLength: 10, required: true },
      tags: { type: 'list', max: 3 },
      id: { from: (s) => s.customers.map((x) => ({ value: x.id, name: x.name })) },
    } } } })
    const p = c.parts.a.params
    expect(p.range).toMatchObject({ kind: 'options', default: 'week' })
    expect(p.limit).toMatchObject({ kind: 'number', default: 10 })
    expect(p.title).toMatchObject({ kind: 'text', required: true, maxLength: 10 })
    expect(p.tags).toMatchObject({ kind: 'list', max: 3 })
    expect(p.id.kind).toBe('record')
    expect(c.parts.a.record).toBe('id')
  })

  it('throws on ids that cannot be keys, shared ids, malformed params, two records', () => {
    expect(() => defineCatalog({ parts: { 'a:b': { component: A } } })).toThrow(/node key/)
    expect(() => defineCatalog({ parts: { row: { component: A } } })).toThrow(/built in/)
    expect(() => defineCatalog({ parts: { tabs: { component: A } }, containers: { tabs: { render: () => null } } })).toThrow(/both a part and a container/)
    expect(() => defineCatalog({ parts: { a: { component: A, params: { x: { foo: 1 } } } } })).toThrow(/options/)
    expect(() => defineCatalog({ parts: { a: { component: A, params: { x: { options: { a: 1 }, default: 'b' } } } } })).toThrow(/default/)
    expect(() => defineCatalog({ parts: { a: { component: A, params: { x: { from: () => [] }, y: { from: () => [] } } } } })).toThrow(/two record/)
  })

  it('SYG161: a component as a container render; SYG162: a part with nothing to render', () => {
    function Tabs() { return null }
    Tabs.model = { X: (s) => s }
    const c = defineCatalog({ parts: { a: { description: 'A' } }, containers: { tabs: { render: Tabs } } })
    expect(codes()).toEqual(['SYG161', 'SYG162'])
    expect(getDiagnostics().map((d) => d.severity)).toEqual(['error', 'error'])
    expect(c.render({ layout: { root: 'page', nodes: { page: { part: 'page', slots: { default: ['a'] } }, a: { part: 'a' } } } }, {})).toBeTruthy()
  })

  it('SYG450: `in` naming an unknown container or slot, or row; invalid min / max / accepts', () => {
    const c = defineCatalog({
      parts: { a: { component: A, in: ['nope', 'tabs:other', 'row', 'tabs:one'] }, b: { component: A, in: ['nope'] } },
      containers: { tabs: { slots: { one: null, two: null }, min: -1, max: 2, accepts: 'all' }, box: { min: 3, max: 1 } },
    })
    expect(c.parts.a.in).toEqual(['tabs:one'])
    expect(c.parts.b.in).toEqual(['page:default'])
    expect(c.containers.tabs).toMatchObject({ min: undefined, max: 2, accepts: undefined, in: ['page:default'] })
    expect(c.containers.box).toMatchObject({ min: undefined, max: undefined })
    expect(codes().filter((x) => x === 'SYG450').length).toBe(7)
  })

  it('companions naming no part are dropped (SYG250); `in: "tabs"` expands to every slot', () => {
    const c = defineCatalog({ parts: { a: { component: A, companions: ['b', 'zzz'], in: 'tabs' }, b: { component: A } }, containers: { tabs: { slots: { x: null, y: null } } } })
    expect(c.parts.a.companions).toEqual(['b'])
    expect(c.parts.a.in).toEqual(['tabs:x', 'tabs:y'])
    expect(codes()).toEqual(['SYG250'])
  })

  it('options(state): one per part, one per record; records() validates from() (SYG252)', () => {
    const c = defineCatalog({ parts: {
      a: { component: A, description: 'A (one)' },
      cust: { component: A, description: 'Customer', params: { id: { from: (s) => s.customers.map((x) => ({ value: x.id, name: x.name })) } } },
      bad: { component: A, description: 'Bad', params: { id: { from: () => 'nope' } } },
      half: { component: A, description: 'Half', params: { id: { from: () => [{ value: 1, description: 'one' }, { name: 'x' }] } } },
      boom: { component: A, description: 'Boom', params: { id: { from: () => { throw new Error('no state') } } } },
    } })
    expect(c.options(S())).toEqual([
      { option: 'a', part: 'a', description: 'A (one)' },
      { option: 'cust:7', part: 'cust', params: { id: 7 }, description: 'Customer: Northwind' },
      { option: 'cust:9', part: 'cust', params: { id: 9 }, description: 'Customer: Globex' },
      { option: 'half:1', part: 'half', params: { id: 1 }, description: 'Half: one' },
    ])
    expect(codes()).toEqual(['SYG252', 'SYG252', 'SYG252'])
    c.options(S())
    expect(codes().length).toBe(3)   // once per catalog and part
  })

  it('description, categories, container description / in; rows: false (or containers.row: false) drops the row', () => {
    const c = defineCatalog({ description: 'The dashboard', categories: { money: 'Money' },
      parts: { a: { component: A, description: 'A', category: 'money', in: ['page', 'card'] } },
      containers: { tabs: { slots: { one: 'One' } }, card: { description: 'A card', in: ['tabs:one'] } } })
    expect(c).toMatchObject({ description: 'The dashboard', categories: { money: 'Money' }, rows: true })
    expect(c.parts.a.category).toBe('money')
    expect(c.containers.card).toMatchObject({ description: 'A card', in: ['tabs:one'] })
    for (const decl of [{ rows: false }, { containers: { row: false } }]) {
      const n = defineCatalog({ parts: { a: { component: A, description: 'A' } }, ...decl })
      expect(n.rows).toBe(false)
      expect(n.get('row')).toBe(undefined)
      const l = n.finish({ root: 'page', nodes: { page: { part: 'page', slots: { default: ['row'] } }, row: { part: 'row', slots: { default: ['a'] } }, a: { part: 'a' } } })
      expect(l.nodes.page.slots.default).toEqual(['a'])
    }
    expect(() => defineCatalog({ rows: false, parts: { row: { component: A } } })).toThrow(/built in/)
  })

  it('container params are normalized; a record param on a container throws', () => {
    const c = defineCatalog({ parts: {}, containers: { section: { params: { tone: { options: { calm: 'c', loud: 'l' } } } } } })
    expect(c.containers.section.params.tone).toMatchObject({ kind: 'options', default: 'calm' })
    expect(() => defineCatalog({ containers: { s: { params: { id: { from: () => [] } } } } })).toThrow(/record/)
  })
})

describe('byId', () => {
  it('reads and writes one array element by id (any id key); missing: undefined / unchanged', () => {
    const s = { todos: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }], other: 1 }
    const l = byId('todos', 2)
    expect(l.get(s)).toBe(s.todos[1])
    const n = l.set(s, { id: 2, t: 'B' })
    expect(n).toEqual({ todos: [{ id: 1, t: 'a' }, { id: 2, t: 'B' }], other: 1 })
    expect(n.todos[0]).toBe(s.todos[0])
    expect(byId('todos', 3).get(s)).toBe(undefined)
    expect(byId('todos', 3).set(s, {})).toBe(s)
    expect(byId('nope', 1).get(s)).toBe(undefined)
    expect(byId('todos', 'a', 'key').get({ todos: [{ key: 'a' }] })).toEqual({ key: 'a' })
    expect(sygnal.byId).toBe(byId)
    expect(sygnal.defineCatalog).toBe(defineCatalog)
  })
})

describe('X-1 codes', () => {
  it('are registered in both tables and explained', () => {
    for (const code of ['SYG161', 'SYG162', 'SYG250', 'SYG251', 'SYG252', 'SYG450', 'SYG452', 'SYG681']) {
      expect(CODE_TITLES[code], code).toBeTruthy()
      expect(DEV_CODE_SEVERITY[code], code).toBeTruthy()
      expect(EXPLANATIONS[code]?.severity, code).toBe(DEV_CODE_SEVERITY[code])
    }
  })
})
