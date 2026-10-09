// PLAN-6 1-A: spike 0-S4's 21 schemas (dev-plans/research/p6-spikes/s4/cases.mjs on exp/p6-s4), the same
// schema in Zod 4, Valibot 1 (wrapped by toStandardJsonSchema) and ArkType 2.
// Each case: [name, zod, valibot, arktype, valid sample, invalid sample]
import { z } from 'zod'
import * as v from 'valibot'
import { toStandardJsonSchema as vj } from '@valibot/to-json-schema'
import { type } from 'arktype'

const zItem = z.object({ id: z.number().int(), text: z.string() })
const vItem = v.object({ id: v.pipe(v.number(), v.integer()), text: v.string() })
const aItem = type({ id: 'number.integer', text: 'string' })

const zTree = z.object({ name: z.string(), get children() { return z.array(zTree) } })
const vTree = v.object({ name: v.string(), children: v.array(v.lazy(() => vTree)) })
const aTree = type.module({ tree: { name: 'string', children: 'tree[]' } }).tree

const zNested = z.array(z.union([z.string(), z.lazy(() => zNested)]))
const vNested = v.array(v.union([v.string(), v.lazy(() => vNested)]))
const aNested = type.module({ nested: '(string | nested)[]' }).nested

export const cases = [
  ['string', z.string(), v.string(), type('string'), 'buy milk', 42],
  ['string+min+describe',
    z.string().min(1).describe('The todo text'),
    v.pipe(v.string(), v.minLength(1), v.description('The todo text')),
    type('string > 0').describe('The todo text'), 'buy milk', ''],
  ['integer', z.number().int(), v.pipe(v.number(), v.integer()), type('number.integer'), 3, 3.5],
  ['number range', z.number().min(1).max(5), v.pipe(v.number(), v.minValue(1), v.maxValue(5)), type('1 <= number <= 5'), 3, 9],
  ['enum', z.enum(['all', 'active', 'done']), v.picklist(['all', 'active', 'done']), type("'all' | 'active' | 'done'"), 'done', 'some'],
  ['literal', z.literal('x'), v.literal('x'), type("'x'"), 'x', 'y'],
  ['object req/opt',
    z.object({ text: z.string().describe('The text'), priority: z.number().optional() }),
    v.object({ text: v.pipe(v.string(), v.description('The text')), priority: v.optional(v.number()) }),
    type({ text: type('string').describe('The text'), 'priority?': 'number' }),
    { text: 'a' }, { priority: 1 }],
  ['array', z.array(z.string()), v.array(v.string()), type('string[]'), ['a'], [1]],
  ['tuple', z.tuple([z.string(), z.number()]), v.tuple([v.string(), v.number()]), type(['string', 'number']), ['a', 1], [1, 'a']],
  ['union', z.union([z.string(), z.number()]), v.union([v.string(), v.number()]), type('string | number'), 1, true],
  ['discriminated union',
    z.discriminatedUnion('kind', [z.object({ kind: z.literal('a'), x: z.string() }), z.object({ kind: z.literal('b'), y: z.number() })]),
    v.variant('kind', [v.object({ kind: v.literal('a'), x: v.string() }), v.object({ kind: v.literal('b'), y: v.number() })]),
    type({ kind: "'a'", x: 'string' }).or({ kind: "'b'", y: 'number' }),
    { kind: 'b', y: 1 }, { kind: 'b', x: 'a' }],
  ['nullable', z.string().nullable(), v.nullable(v.string()), type('string | null'), null, 1],
  ['default (in object)',
    z.object({ filter: z.enum(['all', 'done']).default('all') }),
    v.object({ filter: v.optional(v.picklist(['all', 'done']), 'all') }),
    type({ filter: "'all' | 'done' = 'all'" }),
    {}, { filter: 'x' }],
  ['transform', z.string().transform((s) => s.length), v.pipe(v.string(), v.transform((s) => s.length)), type('string').pipe((s) => s.length), 'abc', 1],
  ['refinement', z.string().refine((s) => s.includes('@'), 'needs @'), v.pipe(v.string(), v.check((s) => s.includes('@'), 'needs @')), type('string').narrow((s) => s.includes('@')), 'a@b', 'ab'],
  ['email format', z.email(), v.pipe(v.string(), v.email()), type('string.email'), 'a@b.co', 'ab'],
  ['date', z.date(), v.date(), type('Date'), new Date(), 'x'],
  ['record', z.record(z.string(), z.number()), v.record(v.string(), v.number()), type('Record<string, number>'), { a: 1 }, { a: 'x' }],
  ['reused object', z.object({ a: zItem, b: zItem }), v.object({ a: vItem, b: vItem }), type({ a: aItem, b: aItem }), { a: { id: 1, text: 'x' }, b: { id: 2, text: 'y' } }, { a: {} }],
  ['recursive', zTree, vTree, aTree, { name: 'r', children: [{ name: 'c', children: [] }] }, { name: 'r', children: [{}] }],
  ['recursive non-object root', zNested, vNested, aNested, ['a', ['b', ['c']]], ['a', [1]]],
].map(([name, zs, vs, as, ok, bad]) => ({ name, schemas: { zod: zs, valibot: vj(vs), arktype: as }, ok, bad }))
