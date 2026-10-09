// PLAN-6 1-A (A-1 input contract, 0-S4): the portable normalization, the { value } wrap and the
// lenient unwrap, repair, the jsonSchema() subset validator and SYG240 / SYG243 conversions, for
// spike 0-S4's 21 cases in Zod, Valibot and ArkType. No network.
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import * as zm from 'zod/mini'
import * as v from 'valibot'
import { toStandardJsonSchema } from '@valibot/to-json-schema'
import { type } from 'arktype'
import { cases } from './p6-1a-schema-cases.js'
import { toJsonSchema, parseInput, repair, normalize } from '../src/extra/ai/schema/index.ts'
import { jsonSchema, check } from '../src/extra/ai/schema/jsonSchema.ts'

const json = (x) => JSON.parse(JSON.stringify(x))
// 0-S4's table: lossy conversions (the model doesn't see the part; validation still checks it)
const LOSSY = { refinement: ['valibot', 'arktype'], date: ['zod', 'valibot', 'arktype'] }
const WRAPPED = new Set(['string', 'string+min+describe', 'integer', 'number range', 'enum', 'literal', 'array', 'tuple', 'union', 'discriminated union', 'nullable', 'transform', 'refinement', 'email format', 'date', 'recursive non-object root'])
/** the portable rules every consumer relies on */
const portable = (s) => {
  const str = JSON.stringify(s)
  expect(s.type).toBe('object')
  expect(str).not.toMatch(/"\$schema"|"oneOf"|"items":false|"\$ref":"#"/)
  expect(str).not.toContain('9007199254740991')
}

describe('normalization: 21 cases x Zod, Valibot, ArkType', () => {
  for (const c of cases) {
    for (const [lib, s] of Object.entries(c.schemas)) {
      it(`${c.name} (${lib})`, async () => {
        const conv = toJsonSchema(s)
        expect(conv.error).toBeUndefined()
        expect(!!conv.lossy).toBe(!!LOSSY[c.name]?.includes(lib))
        expect(conv.wrapped).toBe(WRAPPED.has(c.name))
        portable(conv.schema)
        // the schema accepts the sample as a model would send it (the subset validator agrees with Ajv, 0-S4)
        const sample = json(c.ok)
        const args = conv.wrapped ? { value: sample } : sample
        if (c.name !== 'email format') expect(check(conv.schema, args)).toEqual([])
        // round trip through the library: valid, except a Date (JSON can't carry one)
        const r = await parseInput(s, args)
        if (c.name === 'date') expect(r.issues).toBeDefined()
        else expect(r.issues).toBeUndefined(), expect('value' in r).toBe(true)
        // the invalid sample is rejected with { message, path } issues
        const bad = await parseInput(s, conv.wrapped ? { value: json(c.bad) } : json(c.bad))
        if (c.name !== 'date') expect(bad.issues?.[0]).toMatchObject({ message: expect.any(String) })
        // cached by schema object (ArkType rebuilds ~standard per read, G-608)
        expect(toJsonSchema(s)).toBe(conv)
      })
    }
  }

  it('Zod: the safe-integer bounds are dropped; descriptions stay on the wrapped value', () => {
    expect(toJsonSchema(z.number().int().describe('how many')).schema).toEqual({ type: 'object', properties: { value: { type: 'integer', description: 'how many' } }, required: ['value'], additionalProperties: false })
  })
  it('Zod recursion: "$ref": "#" moves into $defs.__root; ArkType: a $ref-only object root is inlined', () => {
    const zs = toJsonSchema(cases.find((c) => c.name === 'recursive').schemas.zod).schema
    expect(zs.$defs.__root.properties.children.items).toEqual({ $ref: '#/$defs/__root' })
    expect(zs.type).toBe('object')
    const as = toJsonSchema(cases.find((c) => c.name === 'recursive').schemas.arktype).schema
    expect(as.type).toBe('object')
    expect(as.properties.name).toEqual({ type: 'string' })
    const nested = toJsonSchema(cases.find((c) => c.name === 'recursive non-object root').schemas.zod).schema
    expect(nested.properties.value).toEqual({ $ref: '#/$defs/__root' })
    expect(nested.$defs.__root.type).toBe('array')
  })
  it('a closed tuple: items: false becomes maxItems; oneOf becomes anyOf', () => {
    const t = toJsonSchema(z.tuple([z.string(), z.number()])).schema.properties.value
    expect(t).toMatchObject({ prefixItems: [{ type: 'string' }, { type: 'number' }], maxItems: 2 })
    expect(t.items).toBeUndefined()
    expect(normalize({ oneOf: [{ type: 'string' }, { type: 'number' }] }).schema.properties.value).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] })
  })
})

describe('the { value } wrap: lenient unwrap and repair', () => {
  const du = z.discriminatedUnion('kind', [z.object({ kind: z.literal('color'), id: z.number().int(), color: z.string() }), z.object({ kind: z.literal('label'), text: z.string() })])
  it('accepts bare arguments for a wrapped schema (0-S4: models sent a wrapped object union bare)', async () => {
    expect(toJsonSchema(du).wrapped).toBe(true)
    expect(await parseInput(du, { kind: 'color', id: 2, color: 'red' })).toEqual({ value: { kind: 'color', id: 2, color: 'red' } })
    expect(await parseInput(du, { value: { kind: 'label', text: 'x' } })).toEqual({ value: { kind: 'label', text: 'x' } })
    expect(await parseInput(z.string(), 'bare')).toEqual({ value: 'bare' })
  })
  it('repair: numeric and boolean strings where the schema says number / integer / boolean (D264)', async () => {
    expect(await parseInput(z.number().int(), { value: '3' })).toEqual({ value: 3 })
    expect(await parseInput(du, { kind: 'color', id: '3', color: 'red' })).toEqual({ value: { kind: 'color', id: 3, color: 'red' } })
    expect(await parseInput(z.object({ done: z.boolean(), n: z.number() }), { done: 'true', n: '1.5' })).toEqual({ value: { done: true, n: 1.5 } })
    // a string field stays a string; an integer schema doesn't take '3.5'
    expect(await parseInput(z.object({ text: z.string() }), { text: '3' })).toEqual({ value: { text: '3' } })
    expect((await parseInput(z.number().int(), { value: '3.5' })).issues).toBeDefined()
    expect(repair(['1', 'x'], { type: 'array', items: { type: 'integer' } })).toEqual([1, 'x'])
    expect(repair('2', { anyOf: [{ type: 'null' }, { type: 'integer' }] })).toBe(2)
    // repair: false leaves the string, and validation decides
    expect((await parseInput(z.number().int(), { value: '3' }, { repair: false })).issues[0].message).toMatch(/number/)
  })
  it('issues carry key paths', async () => {
    const r = await parseInput(z.object({ a: z.object({ b: z.number() }) }), { a: { b: 'x' } })
    expect(r.issues[0].path).toEqual(['a', 'b'])
  })
})

describe('SYG240 / SYG243: schemas without a (full) JSON Schema form', () => {
  it('not a Standard Schema, a raw JSON Schema, Valibot unwrapped, Zod Mini', () => {
    expect(toJsonSchema((x) => x).error).toBe('not a Standard Schema')
    expect(toJsonSchema({ type: 'string' }).error).toBe('a plain JSON Schema: wrap it with jsonSchema()')
    expect(toJsonSchema(v.string()).error).toMatch(/valibot schema has no JSON Schema form: wrap it with toStandardJsonSchema\(\)/)
    expect(toJsonSchema(zm.string()).error).toMatch(/Zod Mini.*jsonSchema\(z\.toJSONSchema\(s\), \{ validate: s \}\)/)
    expect(toJsonSchema(null).error).toBe('not a Standard Schema')
  })
  it('lossy: the refinement is left out of the schema but still validated', async () => {
    const s = toStandardJsonSchema(v.pipe(v.string(), v.check((x) => x.includes('@'), 'needs @')))
    const c = toJsonSchema(s)
    expect(c.lossy).toBeTruthy()
    expect(c.schema.properties.value).toEqual({ type: 'string' })
    expect((await parseInput(s, { value: 'ab' })).issues[0].message).toBe('needs @')
    expect(toJsonSchema(type('string').narrow((x) => x.length > 1)).lossy).toBeTruthy()
  })
  it('parseInput on a schema with no form is an { error }', async () => {
    expect(await parseInput(v.string(), 'x')).toEqual({ error: expect.stringMatching(/toStandardJsonSchema/) })
  })
})

describe('jsonSchema(): plain JSON Schema through the subset validator (D262)', () => {
  it('validates the subset and sends the schema as is', async () => {
    const s = jsonSchema({ type: 'object', properties: { id: { type: 'integer', minimum: 1 }, tags: { type: 'array', items: { enum: ['a', 'b'] } } }, required: ['id'], additionalProperties: false })
    expect(toJsonSchema(s).schema).toMatchObject({ type: 'object', required: ['id'] })
    expect(await parseInput(s, { id: 2, tags: ['a'] })).toEqual({ value: { id: 2, tags: ['a'] } })
    expect((await parseInput(s, { id: 0 })).issues).toEqual([{ message: 'at least 1', path: ['id'] }])
    expect((await parseInput(s, { tags: ['c'] })).issues.map((i) => i.message)).toEqual(['id is required', 'expected one of ["a","b"]'])
    expect((await parseInput(s, { id: 1, x: 1 })).issues).toEqual([{ message: 'no value allowed', path: ['x'] }])
    // repair runs before it: '2' for an integer
    expect(await parseInput(s, { id: '2' })).toEqual({ value: { id: 2 } })
  })
  it('a primitive root is wrapped; $ref, anyOf, const, pattern, prefixItems', async () => {
    const tree = jsonSchema({ $defs: { n: { type: 'object', properties: { kids: { type: 'array', items: { $ref: '#/$defs/n' } } } } }, $ref: '#/$defs/n' })
    expect(check(toJsonSchema(tree).schema, { kids: [{ kids: [] }] })).toEqual([])
    expect(check({ anyOf: [{ const: 1 }, { type: 'string', pattern: '^a' }] }, 'b')).toEqual([{ message: 'matches no alternative', path: [] }])
    expect(check({ prefixItems: [{ type: 'string' }], items: false }, ['a', 1])).toEqual([{ message: 'no value allowed', path: [1] }])
    const p = jsonSchema({ type: 'string', enum: ['all', 'done'] })
    expect(toJsonSchema(p).wrapped).toBe(true)
    expect(await parseInput(p, { value: 'done' })).toEqual({ value: 'done' })
    expect(await parseInput(p, 'all')).toEqual({ value: 'all' })
  })
  it('{ validate } keeps a library\'s own validation (Zod Mini)', async () => {
    const mini = zm.string().check(zm.minLength(2))
    const s = jsonSchema(zm.toJSONSchema(mini), { validate: mini })
    expect(toJsonSchema(s).schema.properties.value).toMatchObject({ type: 'string', minLength: 2 })
    expect((await parseInput(s, { value: 'a' })).issues).toBeDefined()
    expect(await parseInput(s, { value: 'ab' })).toEqual({ value: 'ab' })
  })
  it('the subset agrees with each case\'s samples (formats are not checked)', () => {
    for (const c of cases) {
      const conv = toJsonSchema(c.schemas.zod)
      const wrap = (x) => (conv.wrapped ? { value: json(x) } : json(x))
      if (c.name === 'date') continue
      expect(check(conv.schema, wrap(c.ok)), c.name).toEqual([])
      if (!['email format', 'refinement', 'transform'].includes(c.name)) expect(check(conv.schema, wrap(c.bad)).length, c.name).toBeGreaterThan(0)
    }
  })
})
