// sygnal/api (dev preview), function-first: query / mutation / stream in *.server.ts modules,
// mounted with serverFunctions() on a real oRPC OpenAPIHandler (@orpc/server, @orpc/openapi,
// pinned), and called through the client stubs sygnal/vite generates (__serverFunction with a
// { kind, errors } spec). Also the build-time manifest of a contract (api.contracts).
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { os } from '@orpc/server'
import { oc, eventIterator } from '@orpc/contract'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import {
  query, mutation, stream, serverFunctions, __serverFunction, fnNamespace, fnFiles,
  contractManifest, contractHash, orpcClient, fixture, errorFixture,
} from '../src/extra/api/index.js'

// a *.server.ts module as import.meta.glob gives it: { path: namespace object }
const quotesModule = () => {
  const quotes = [{ id: 1, text: 'Start where you are.', at: new Date(0) }]
  return {
    list: query(z.object({ tag: z.string().optional() }), async ({ tag }, { context }) => quotes.map((q) => ({ ...q, tag, user: context.user }))),
    count: query(() => quotes.length),
    add: mutation(z.object({ text: z.string().min(3) }), ({ text }, { errors }) => {
      if (quotes.some((q) => q.text === text)) throw errors.DUPLICATE({ data: { text } })
      const q = { id: quotes.length + 1, text, at: new Date(1000) }
      quotes.push(q)
      return q
    }, { errors: { DUPLICATE: { status: 409, message: 'Already there', data: z.object({ text: z.string() }) } }, output: z.object({ id: z.number(), text: z.string(), at: z.date() }) }),
    ticks: stream(z.object({ n: z.coerce.number() }), async function* ({ n }) { for (let i = 0; i < n; i++) yield { i } }),
    // not a server function: never mounted, never stubbed
    SECRET: 'sk-server-only',
  }
}

/** a stub's request (FetchRequest / SseConnection) as a fetch Request */
const toRequest = (r) => {
  if (r.sse) return new Request('http://x' + r.sse, { headers: r.headers })
  const qs = r.query ? '?' + new URLSearchParams(r.query) : ''
  return new Request('http://x' + r.url + qs, {
    method: r.method || 'GET',
    headers: { ...(r.json !== undefined && { 'content-type': 'application/json' }), ...r.headers },
    body: r.json !== undefined ? JSON.stringify(r.json) : undefined,
  })
}

const mount = (modules, options = {}) => {
  const fns = serverFunctions(modules, { os, ...options })
  const handler = new OpenAPIHandler(fns.router)
  const handle = async (request, context = {}) => fns.skew(request) ?? (await handler.handle(request, { prefix: '/api', context })).response
  return { fns, handle }
}
// the client stubs of one file, as the plugin generates them
const stubs = (modules, file, options = {}) => {
  const [f] = fnFiles({ [file]: modules[file] }, options.dir)
  const out = {}
  for (const [name, meta] of f.fns) {
    const errors = {}
    Object.keys(meta.errors).forEach((c) => { errors[c] = { status: meta.errors[c].status } })
    out[name] = __serverFunction(f.keys.concat(name).join('.'), { kind: meta.kind, errors }, { prefix: '/api', headers: { 'x-api-functions': `${f.ns}:${f.hash}` } })
  }
  return out
}

describe('query / mutation / stream', () => {
  it('validation is mandatory: the input must be a Standard Schema (or left out)', () => {
    expect(() => query({ tag: 'not a schema' }, () => 1)).toThrow(/Standard Schema/)
    expect(() => mutation(z.string(), 'no fn')).toThrow(/fn must be a function/)
    expect(() => query(z.string(), () => 1, { output: {} })).toThrow(/options.output/)
    expect(() => query(() => 1)).not.toThrow()
  })

  it('a function without an id says how to get one', () => {
    expect(() => query(() => 1)()).toThrow(/api: \{ functions: true \}/)
  })

  it('names a module by its path under dir', () => {
    expect(fnNamespace('src/quotes.server.ts')).toBe('quotes')
    expect(fnNamespace('/src/admin/users.server.tsx')).toBe('admin/users')
    expect(fnNamespace('../src/quotes.server.js')).toBe('quotes')
    expect(fnNamespace('./quotes.server.mts')).toBe('quotes')
    expect(fnNamespace('app/x.server.ts', 'app')).toBe('x')
  })
})

describe('serverFunctions on oRPC, called through the client stubs', () => {
  it('needs oRPC\'s os (no server of its own)', () => {
    expect(() => serverFunctions({}, {})).toThrow(/@orpc\/server/)
  })

  it('a query and a mutation: POST JSON, the input validated, declared errors typed by code', async () => {
    const modules = { '/src/quotes.server.ts': quotesModule() }
    const { handle, fns } = mount(modules)
    const api = stubs(modules, '/src/quotes.server.ts')
    expect(Object.keys(api).sort()).toEqual(['add', 'count', 'list', 'ticks'])   // SECRET is not a function
    expect(Object.keys(fns.router.quotes).sort()).toEqual(['add', 'count', 'list', 'ticks'])

    const list = api.list({ tag: 'calm' }, { ok: 'LISTED' })
    expect(list).toMatchObject({ url: '/api/quotes/list', method: 'POST', json: { tag: 'calm' }, endpoint: 'quotes.list', tags: ['api:quotes.list'], ok: 'LISTED' })
    let res = await handle(toRequest(list), { user: 'ana' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 1, text: 'Start where you are.', at: '1970-01-01T00:00:00.000Z', tag: 'calm', user: 'ana' }])

    res = await handle(toRequest(api.count()))
    expect(await res.json()).toBe(1)

    // invalid input never reaches the function
    res = await handle(toRequest(api.add({ text: 'no' })))
    expect(res.status).toBe(400)
    expect((await res.json()).data.issues[0].path).toEqual(['text'])

    res = await handle(toRequest(api.add({ text: 'Less, but better.' }, { invalidates: [api.list] })))
    expect(await res.json()).toMatchObject({ id: 2, text: 'Less, but better.', at: '1970-01-01T00:00:01.000Z' })
    expect(api.add({ text: 'x' }, { invalidates: [api.list] }).invalidates).toEqual(['api:quotes.list'])

    res = await handle(toRequest(api.add({ text: 'Less, but better.' })))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ defined: true, code: 'DUPLICATE', status: 409, message: 'Already there', data: { text: 'Less, but better.' } })
    expect(errorFixture(api.add, 'DUPLICATE', { text: 't' }).status).toBe(409)
  })

  it('a no-input function takes only an empty input', async () => {
    const modules = { '/src/q.server.ts': { count: query(() => 7) } }
    const { handle } = mount(modules)
    const req = (json) => new Request('http://x/api/q/count', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) })
    expect(await (await handle(req(null))).json()).toBe(7)
    expect((await handle(req({ drop: 'table' }))).status).toBe(400)
  })

  it('a stream: GET, read as server-sent events, each event checked against output', async () => {
    const modules = {
      '/src/quotes.server.ts': quotesModule(),
      '/src/bad.server.ts': { events: stream(async function* () { yield { n: 1 }; yield { n: 'x' } }, { output: z.object({ n: z.number() }) }) },
    }
    const { handle } = mount(modules)
    const conn = stubs(modules, '/src/quotes.server.ts').ticks({ n: 2 }, { message: 'TICK' })
    expect(conn).toMatchObject({ sse: '/api/quotes/ticks?n=2', endpoint: 'quotes.ticks', message: 'TICK' })
    const res = await handle(toRequest(conn))
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const text = await res.text()
    expect(text.match(/data: .*/g)).toEqual(['data: {"i":0}', 'data: {"i":1}'])

    const bad = await (await handle(toRequest(stubs(modules, '/src/bad.server.ts').events()))).text()
    expect(bad).toContain('data: {"n":1}')
    expect(bad).toMatch(/event: error/)
  })

  it('skew: each file has its hash; a client built against another version of it gets 409', async () => {
    const modules = { '/src/quotes.server.ts': quotesModule(), '/src/other.server.ts': { ping: query(() => 'pong') } }
    const { handle, fns } = mount(modules)
    const api = stubs(modules, '/src/quotes.server.ts')
    expect(Object.keys(fns.hashes).sort()).toEqual(['other', 'quotes'])
    expect((await handle(toRequest(api.count()))).status).toBe(200)

    // the server's quotes.server.ts changed (a new input field): its hash changes, other's does not
    const changed = { ...modules, '/src/quotes.server.ts': { ...quotesModule(), count: query(z.object({ tag: z.string() }), () => 0) } }
    const next = mount(changed)
    expect(next.fns.hashes.other).toBe(fns.hashes.other)
    expect(next.fns.hashes.quotes).not.toBe(fns.hashes.quotes)
    const res = await next.handle(toRequest(api.count()))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('CONTRACT_SKEW')
    // another file's stubs are unaffected; a request without the header passes (curl)
    expect((await next.handle(toRequest(stubs(modules, '/src/other.server.ts').ping()))).status).toBe(200)
    expect((await next.handle(new Request('http://x/api/other/ping', { method: 'POST' }))).status).toBe(200)
  })

  it('a module\'s own exports, named (server code and tests), are endpoints and fixtures check their output', () => {
    const mod = quotesModule()
    __serverFunction('quotes.add', mod.add, { prefix: '/api' })
    expect(mod.add.id).toBe('quotes.add')
    expect(mod.add({ text: 'abc' })).toMatchObject({ url: '/api/quotes/add', method: 'POST', endpoint: 'quotes.add' })
    expect(mod.add.match({ endpoint: 'quotes.add' })).toBe(true)
    expect(fixture(mod.add, { id: 1, text: 'x', at: new Date(0) })).toEqual({ id: 1, text: 'x', at: '1970-01-01T00:00:00.000Z' })
    expect(() => fixture(mod.add, { id: '1', text: 'x', at: new Date(0) })).toThrow(/does not match/)
    // serverFunctions keeps the id it was given
    serverFunctions({ '/src/quotes.server.ts': mod }, { os })
    expect(mod.add.id).toBe('quotes.add')
  })
})

describe('contractManifest (sygnal/vite api.contracts)', () => {
  const Quote = z.object({ id: z.number(), text: z.string() })
  const contract = {
    quotes: {
      list: oc.route({ method: 'GET', path: '/quotes' }).input(z.object({ tag: z.string().optional() })).output(z.array(Quote)),
      add: oc.route({ method: 'POST', path: '/quotes' }).input(z.object({ text: z.string() })).output(Quote)
        .errors({ DUPLICATE: { status: 409, data: z.object({ id: z.number() }) } }),
      feed: oc.route({ method: 'GET', path: '/quotes/feed' }).output(eventIterator(Quote)),
    },
  }

  it('is plain JSON without schemas, carries the hash, and builds the same requests', () => {
    const { manifest, hash, count } = contractManifest(contract)
    expect(count).toBe(3)
    expect(hash).toBe(contractHash(contract))
    const json = JSON.stringify(manifest)
    expect(json).not.toMatch(/standard|zod|inputSchema|outputSchema/)
    const shipped = Object.defineProperty(JSON.parse(json), '~hash', { value: hash })
    expect(contractHash(shipped)).toBe(hash)
    const real = orpcClient(contract, { prefix: '/api' })
    const lean = orpcClient(shipped, { prefix: '/api' })
    expect(lean.quotes.list({ tag: 'a' })).toEqual(real.quotes.list({ tag: 'a' }))
    expect(lean.quotes.add({ text: 'x' }, { ok: 'A', invalidates: [lean.quotes.list] })).toEqual(real.quotes.add({ text: 'x' }, { ok: 'A', invalidates: [real.quotes.list] }))
    expect(lean.quotes.feed()).toEqual(real.quotes.feed())
    expect(lean.quotes.feed.kind).toBe('stream')
    expect(lean.quotes.add.errors.DUPLICATE.status).toBe(409)
    expect(() => orpcClient(shipped, { validate: true })).toThrow(/validate: true needs them/)
  })

  it('a module export that is no contract (a schema) has no procedures', () => {
    expect(contractManifest(Quote).count).toBe(0)
    expect(contractManifest({ a: 1 }).count).toBe(0)
  })
})
