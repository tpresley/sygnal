// PLAN-6 3-W2: G-629 (A-1's normalize walker is map-aware: a property named `oneOf` or `items` is a
// name, not a keyword, and `const` / `enum` / `default` / `examples` are data) and the strict layer
// sharing that walker; D285 (`strictSchemas` is the strict option, `strict: true` is SYG672).
import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { normalize, toJsonSchema } from '../src/extra/ai/schema/index.ts'
import { strictSchemas } from '../src/extra/ai/schema/strict.ts'
import { openResponses } from '../src/extra/ai/transports/openResponses.ts'
import { chatCompletions } from '../src/extra/ai/transports/chatCompletions.ts'
import { encodeOpenResponses } from '../src/extra/ai/transports/encodeOpenResponses.ts'
import { toSSE, dataSSE, fixtureFetch, collect } from './helpers/p6-sse-fixture.js'
import { configureDiagnostics, getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.ts'
import { setupChecks } from './diagnostics/helpers.js'

afterEach(() => { configureDiagnostics({ mode: 'off' }); clearDiagnostics() })

// properties whose names are JSON Schema keywords
const KEYWORDS = {
  type: 'object',
  properties: {
    oneOf: { type: 'string' },
    items: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
    prefixItems: { type: 'string' },
    title: { type: 'string' },
    default: { type: 'string' },
    minLength: { type: 'number' },
    properties: { type: 'object', properties: { oneOf: { oneOf: [{ type: 'string' }, { type: 'number' }] } }, required: ['oneOf'] },
  },
  required: ['oneOf', 'items'],
  $defs: { oneOf: { type: 'string' } },
}

describe('G-629: normalize walks maps as maps', () => {
  it('keeps properties named after keywords; still rewrites the real keywords inside them', () => {
    const { schema, wrapped } = normalize(KEYWORDS)
    expect(wrapped).toBe(false)
    expect(Object.keys(schema.properties)).toEqual(['oneOf', 'items', 'prefixItems', 'title', 'default', 'minLength', 'properties'])
    expect(schema.properties.oneOf).toEqual({ type: 'string' })
    expect(schema.$defs).toEqual({ oneOf: { type: 'string' } })
    // a real oneOf inside -> anyOf; Zod's safe-integer bounds on a property named items -> dropped
    expect(schema.properties.properties.properties.oneOf).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] })
    expect(schema.properties.items).toEqual({ type: 'integer' })
  })

  it('const / enum / default / examples are data', () => {
    const { schema } = normalize({ type: 'object', properties: { a: { type: 'object', default: { oneOf: 1 }, examples: [{ oneOf: 2 }] }, b: { const: { oneOf: 3 } }, c: { enum: [{ oneOf: 4 }] } } })
    expect(schema.properties).toEqual({ a: { type: 'object', default: { oneOf: 1 }, examples: [{ oneOf: 2 }] }, b: { const: { oneOf: 3 } }, c: { enum: [{ oneOf: 4 }] } })
  })

  it('end to end from Zod', () => {
    const s = toJsonSchema(z.object({ oneOf: z.string(), items: z.array(z.string()), properties: z.number() })).schema
    expect(Object.keys(s.properties)).toEqual(['oneOf', 'items', 'properties'])
    expect(s.properties.items).toEqual({ type: 'array', items: { type: 'string' } })
  })
})

describe('the strict layer on the same walker', () => {
  it('openai: keyword-named properties stay properties (all required, the optional ones nullable)', () => {
    const { schema, errors } = strictSchemas(normalize(KEYWORDS).schema)
    expect(errors).toEqual([])
    expect(schema.required).toEqual(['oneOf', 'items', 'prefixItems', 'title', 'default', 'minLength', 'properties'])
    expect(schema.properties.title).toEqual({ type: ['string', 'null'] })
    expect(schema.properties.minLength).toEqual({ type: ['number', 'null'] })
  })

  it('anthropic: required as is, keyword-named properties not moved, counts of optional and union parameters', () => {
    const r = strictSchemas(normalize(KEYWORDS).schema, 'anthropic')
    expect(r.errors).toEqual([])
    expect(r.schema.required).toEqual(['oneOf', 'items'])
    expect(r.schema.additionalProperties).toBe(false)
    expect(Object.keys(r.schema.properties)).toEqual(['oneOf', 'items', 'prefixItems', 'title', 'default', 'minLength', 'properties'])
    expect(r.schema.properties.properties).toEqual({ type: 'object', additionalProperties: false, required: ['oneOf'], properties: { oneOf: { anyOf: [{ type: 'string' }, { type: 'number' }] } } })
    expect(r.optional).toBe(5)
    expect(r.unions).toBe(1)
  })

  it('anthropic: a $ref cycle and a # reference are recursive; a shared non-recursive $def is fine', () => {
    expect(strictSchemas({ type: 'object', properties: { a: { $ref: '#/$defs/A' } }, $defs: { A: { type: 'object', properties: { b: { $ref: '#/$defs/B' } } }, B: { type: 'object', properties: { a: { $ref: '#/$defs/A' } } } } }, 'anthropic').errors).toContain('a recursive schema has no strict form')
    expect(strictSchemas({ type: 'object', properties: { a: { $ref: '#' } } }, 'anthropic').errors).toContain('a recursive schema has no strict form')
    expect(strictSchemas({ type: 'object', properties: { a: { $ref: '#/$defs/S' }, b: { $ref: '#/$defs/S' } }, $defs: { S: { type: 'string' } } }, 'anthropic').errors).toEqual([])
  })
})

describe('D285: strict is an import', () => {
  it('openResponses and chatCompletions with strict: true send non-strict and report SYG672 once each', async () => {
    setupChecks()
    configureDiagnostics({ mode: 'collect' })
    const tools = { add: { inputSchema: { type: 'object', properties: { a: { type: 'string' } } } } }
    const fo = fixtureFetch(() => toSSE(encodeOpenResponses(['ok'])))
    const o = openResponses({ model: 'm', fetch: fo.fetch, strict: true })
    await collect(o, { messages: [{ role: 'user', content: 'x' }], tools })
    await collect(o, { messages: [{ role: 'user', content: 'x' }], tools })
    const fc = fixtureFetch(() => dataSSE([{ id: 'c', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]))
    await collect(chatCompletions({ model: 'm', fetch: fc.fetch, strict: true }), { messages: [{ role: 'user', content: 'x' }], tools })
    expect(fo.calls[0].json.tools[0].strict).toBe(false)
    expect(fc.calls[0].json.tools[0].function.strict).toBeUndefined()
    expect(getDiagnostics().filter(d => d.code == 'SYG672').map(d => d.data.transport)).toEqual(['openResponses', 'chatCompletions'])
  })

  it('strict: strictSchemas sends strict', async () => {
    const fo = fixtureFetch(() => toSSE(encodeOpenResponses(['ok'])))
    await collect(openResponses({ model: 'm', fetch: fo.fetch, strict: strictSchemas }), { messages: [{ role: 'user', content: 'x' }], tools: { add: { inputSchema: { type: 'object', properties: { a: { type: 'string' } } } } } })
    expect(fo.calls[0].json.tools[0]).toMatchObject({ strict: true, parameters: { required: ['a'], additionalProperties: false } })
  })
})
