// @vitest-environment jsdom
// sygnal/api (dev preview): orpcClient against a real oRPC OpenAPIHandler (@orpc/openapi, pinned),
// in-process: the real fetch and socket drivers with a fetch that calls the handler. Pins the
// wire format (query brackets, path params, JSON bodies, error shape, SSE events).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { oc, eventIterator } from '@orpc/contract'
import { implement } from '@orpc/server'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { makeSocketDriver } from '../src/extra/socketDriver.js'
import { _resetDiagnostics, getDiagnostics } from '../src/extra/diagnostics/index.js'
import { orpcClient, contractHash, contractSkew, isContractSkew, contractFetch, fixture, errorFixture } from '../src/extra/api/index.js'

const Quote = z.object({ id: z.number(), text: z.string(), tag: z.string(), at: z.date().optional() })
const contract = {
  quotes: {
    list: oc.route({ method: 'GET', path: '/quotes' })
      .input(z.object({ tag: z.string().optional(), tags: z.array(z.string()).optional(), limit: z.coerce.number().optional() }))
      .output(z.array(Quote)),
    get: oc.route({ method: 'GET', path: '/quotes/{id}' }).input(z.object({ id: z.coerce.number() })).output(Quote),
    add: oc.route({ method: 'POST', path: '/quotes' })
      .input(z.object({ text: z.string().min(3), tag: z.string() }))
      .output(Quote)
      .errors({ DUPLICATE: { status: 409, message: 'Already there', data: z.object({ id: z.number() }) } }),
    rename: oc.route({ method: 'PATCH', path: '/quotes/{id}' }).input(z.object({ id: z.coerce.number(), text: z.string() })).output(Quote),
    feed: oc.route({ method: 'GET', path: '/quotes/feed' }).input(z.object({ tag: z.string().optional() })).output(eventIterator(Quote)),
  },
  files: { read: oc.route({ method: 'GET', path: '/files/{+path}' }).input(z.object({ path: z.string() })).output(z.string()) },
  ping: oc.output(z.literal('pong')),       // no route: POST /ping
}

function server() {
  const quotes = [{ id: 1, text: 'Start where you are.', tag: 'calm', at: new Date(0) }]
  const listeners = new Set()
  const seen = []
  const os = implement(contract)
  const router = os.router({
    quotes: {
      list: os.quotes.list.handler(({ input }) => { seen.push(['list', input]); return quotes.filter(q => !input.tag || q.tag === input.tag) }),
      get: os.quotes.get.handler(({ input }) => quotes.find(q => q.id === input.id)),
      add: os.quotes.add.handler(({ input, errors }) => {
        const dup = quotes.find(q => q.text === input.text)
        if (dup) throw errors.DUPLICATE({ data: { id: dup.id } })
        const q = { id: quotes.length + 1, ...input }
        quotes.push(q)
        listeners.forEach(l => l(q))
        return q
      }),
      rename: os.quotes.rename.handler(({ input }) => { seen.push(['rename', input]); return { ...quotes[0], text: input.text } }),
      feed: os.quotes.feed.handler(async function* ({ signal }) {
        const queue = []
        let wake = () => {}
        const l = q => { queue.push(q); wake() }
        listeners.add(l)
        try {
          while (!signal?.aborted) {
            if (!queue.length) await new Promise(r => { wake = r; signal?.addEventListener('abort', r, { once: true }) })
            while (queue.length) yield queue.shift()
          }
        } finally { listeners.delete(l) }
      }),
    },
    files: { read: os.files.read.handler(({ input }) => input.path) },
    ping: os.ping.handler(() => 'pong'),
  })
  const handler = new OpenAPIHandler(router)
  const hash = contractHash(contract)
  const fetch = async (url, init) => {
    const req = new Request(new URL(String(url), 'http://localhost'), init)
    const skew = contractSkew(req, { hash, header: 'x-api-contract' })
    if (skew) return skew
    const { matched, response } = await handler.handle(req, { prefix: '/api' })
    return matched ? response : new Response('Not found', { status: 404 })
  }
  return { fetch, quotes, seen, hash }
}

const until = async (cond, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)) }
}

afterEach(() => { vi.restoreAllMocks(); _resetDiagnostics?.() })

describe('orpcClient: requests', () => {
  const api = orpcClient(contract, { prefix: '/api' })

  it('a GET procedure is a tagged GET request, its input in the query in bracket notation', () => {
    expect(api.quotes.list({ tag: 'calm', tags: ['a'], limit: 5 }, { ok: 'LIST' })).toEqual({
      url: '/api/quotes', endpoint: 'quotes.list', query: { tag: 'calm', 'tags[0]': 'a', limit: 5 }, tags: ['api:quotes.list'], ok: 'LIST',
    })
    expect(api.quotes.list()).toEqual({ url: '/api/quotes', endpoint: 'quotes.list', tags: ['api:quotes.list'] })
    expect(api.quotes.list.kind).toBe('query')
    expect(api.quotes.list.id).toBe('quotes.list')
  })

  it('path parameters fill the path and leave the query or body', () => {
    expect(api.quotes.get({ id: 7 })).toMatchObject({ url: '/api/quotes/7' })
    expect(api.quotes.get({ id: 7 }).query).toBeUndefined()
    expect(api.quotes.rename({ id: 3, text: 'x y' })).toMatchObject({ url: '/api/quotes/3', method: 'PATCH', json: { text: 'x y' } })
    expect(api.files.read({ path: 'a b/c.txt' }).url).toBe('/api/files/a%20b/c.txt')
    expect(() => api.quotes.get({})).toThrow(/needs the path parameter 'id'/)
  })

  it('other methods send the input as JSON; reply options and invalidates by endpoint', () => {
    const r = api.quotes.add({ text: 'abc', tag: 't' }, { ok: 'ADDED', error: 'FAILED', invalidates: [api.quotes.list, 'other'] })
    expect(r).toEqual({ url: '/api/quotes', endpoint: 'quotes.add', method: 'POST', json: { text: 'abc', tag: 't' }, ok: 'ADDED', error: 'FAILED', invalidates: ['api:quotes.list', 'other'] })
    expect(api.ping()).toEqual({ url: '/api/ping', endpoint: 'ping', method: 'POST', json: null })
    expect(api.quotes.add.kind).toBe('mutation')
  })

  it('an event iterator is an SSE connection; headers go on every request and stream', () => {
    const c = orpcClient(contract, { prefix: '/api', headers: { 'x-api-contract': 'h1' } })
    expect(c.quotes.feed({ tag: 'calm' }, { message: 'ARRIVED', resume: true })).toEqual({
      sse: '/api/quotes/feed?tag=calm', endpoint: 'quotes.feed', headers: { 'x-api-contract': 'h1' }, message: 'ARRIVED', resume: true,
    })
    expect(c.quotes.feed.kind).toBe('stream')
    expect(c.quotes.list(undefined, { headers: { a: '1' } }).headers).toEqual({ 'x-api-contract': 'h1', a: '1' })
  })

  it('validate: true checks replies with the output schema; unsupported shapes throw early', () => {
    expect(orpcClient(contract, { validate: true }).quotes.get({ id: 1 }).validate).toBe(contract.quotes.get['~orpc'].outputSchema)
    expect(() => orpcClient({ s: oc.route({ method: 'POST' }).output(eventIterator(z.string())) })).toThrow(/method: 'GET'/)
    expect(() => orpcClient({ d: oc.route({ method: 'GET', inputStructure: 'detailed' }) })).toThrow(/detailed/)
  })

  it('match() recognises its own requests', () => {
    expect(api.quotes.add.match(api.quotes.add({ text: 'abc', tag: 't' }))).toBe(true)
    expect(api.quotes.add.match(api.quotes.list())).toBe(false)
  })
})

describe('orpcClient against the oRPC OpenAPIHandler', () => {
  it('the wire format: brackets, single-element arrays, coerced numbers, path params with a body, {+path}, Dates as strings', async () => {
    const s = server()
    const api = orpcClient(contract, { prefix: '/api' })
    const t = renderComponent(() => h('div'), { drivers: { HTTP: makeFetchDriver({ fetch: s.fetch }) } })
    await t.ready()
    const send = async (req) => {
      const res = await s.fetch(req.url + (req.query ? '?' + new URLSearchParams(Object.entries(req.query).map(([k, v]) => [k, String(v)])) : ''), {
        method: req.method || 'GET', body: req.json !== undefined ? JSON.stringify(req.json) : undefined, headers: { 'content-type': 'application/json' },
      })
      return [res.status, await res.json()]
    }
    const [st, list] = await send(api.quotes.list({ tag: 'calm', tags: ['only'], limit: 2 }))
    expect(st).toBe(200)
    expect(list[0].at).toBe('1970-01-01T00:00:00.000Z')
    expect(s.seen.at(-1)).toEqual(['list', { tag: 'calm', tags: ['only'], limit: 2 }])
    expect(await send(api.quotes.rename({ id: 1, text: 'New' }))).toEqual([200, expect.objectContaining({ text: 'New' })])
    expect(s.seen.at(-1)).toEqual(['rename', { id: 1, text: 'New' }])
    expect(await send(api.files.read({ path: 'a b/c.txt' }))).toEqual([200, 'a b/c.txt'])
    expect(await send(api.ping())).toEqual([200, 'pong'])
    t.dispose()
  })

  function Quotes({ state }) {
    return h('div', {}, [h('p', { props: { className: 'error' } }, state.error), ...(state.live || []).map(q => h('i', {}, q.text))])
  }
  const mk = (api) => {
    const C = Quotes
    C.initialState = { tag: 'calm', draft: '', error: '', quotes: { status: 'idle' }, live: [] }
    C.resources = { quotes: (s) => api.quotes.list({ tag: s.tag }) }
    C.connections = (s) => ({ feed: api.quotes.feed({ tag: s.tag }, { message: 'ARRIVED' }) })
    C.model = {
      TYPE: (s, draft) => ({ ...s, draft }),
      ADD: { HTTP: (s) => api.quotes.add({ text: s.draft, tag: s.tag }, { ok: 'ADDED', error: 'FAILED', invalidates: [api.quotes.list] }) },
      ADDED: (s, q) => ({ ...s, error: `Added #${q.id}` }),
      FAILED: (s, { status, body }) => ({ ...s, error: body?.code === 'DUPLICATE' ? `Duplicate of #${body.data.id}` : status === 400 ? body.data.issues[0].path.join('.') : isContractSkew({ status, body }) ? 'reload' : 'failed' }),
      ARRIVED: (s, q) => ({ ...s, live: [...s.live, q] }),
    }
    return C
  }

  it('a component: resource, mutation with invalidation, typed errors, the event stream', async () => {
    const s = server()
    const api = orpcClient(contract, { prefix: '/api', headers: { 'x-api-contract': s.hash } })
    const t = renderComponent(mk(api), { drivers: { HTTP: makeFetchDriver({ fetch: s.fetch }), WS: makeSocketDriver({ fetch: s.fetch }) } })
    await until(() => t.state.quotes.status === 'success')
    expect(t.state.quotes.data).toEqual([{ id: 1, text: 'Start where you are.', tag: 'calm', at: '1970-01-01T00:00:00.000Z' }])
    await new Promise(r => setTimeout(r, 20))   // the feed is open

    await t.simulateAction('TYPE', 'Less, but better.')
    await t.simulateAction('ADD')
    await until(() => t.state.error === 'Added #2')
    await until(() => t.state.quotes.data?.length === 2)        // invalidates: [api.quotes.list]
    await until(() => t.state.live.length === 1)                // the event iterator, as SSE
    expect(t.state.live[0]).toMatchObject({ id: 2, text: 'Less, but better.' })

    await t.simulateAction('ADD')                               // the same text again
    await until(() => t.state.error === 'Duplicate of #2')      // the declared error, typed body
    await t.simulateAction('TYPE', 'no')
    await t.simulateAction('ADD')
    await until(() => t.state.error === 'text')                 // input validation: data.issues
    t.dispose()
  })

  it('skew: an old client gets CONTRACT_SKEW; contractFetch reports SYG690 once and calls onSkew', async () => {
    const s = server()
    const api = orpcClient(contract, { prefix: '/api', headers: { 'x-api-contract': 'stale' } })
    const onSkew = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = contractFetch({ fetch: s.fetch, onSkew })
    const t = renderComponent(mk(api), { drivers: { HTTP: makeFetchDriver({ fetch }), WS: makeSocketDriver({ fetch, reconnect: false }) } })
    await until(() => t.state.quotes.status === 'error')
    expect(t.state.quotes.error.status).toBe(409)
    expect(isContractSkew({ status: 409, body: t.state.quotes.error.body })).toBe(true)
    await t.simulateAction('TYPE', 'Fresh text')
    await t.simulateAction('ADD')
    await until(() => t.state.error === 'reload')
    expect(onSkew).toHaveBeenCalledWith({ server: s.hash, url: expect.stringContaining('/api/quotes') })
    expect(onSkew.mock.calls.length).toBeGreaterThanOrEqual(2)
    // once per contractFetch, printed or collected (renderComponent collects)
    const printed = warn.mock.calls.filter(c => String(c[0]).includes('SYG690')).length
    const collected = getDiagnostics().filter(d => d.code === 'SYG690').length
    expect(printed + collected).toBe(1)
    t.dispose()
  })
})

describe('contractHash and contractSkew', () => {
  it('is stable, and changes with a schema, a route or an error code', () => {
    const h1 = contractHash(contract)
    expect(contractHash(contract)).toBe(h1)
    expect(h1).toMatch(/^[0-9a-z]+$/)
    const changed = (patch) => contractHash({ ...contract, quotes: { ...contract.quotes, ...patch } })
    expect(changed({ get: oc.route({ method: 'GET', path: '/quotes/{id}' }).input(z.object({ id: z.coerce.number() })).output(Quote.extend({ by: z.string() })) })).not.toBe(h1)
    expect(changed({ get: oc.route({ method: 'GET', path: '/q/{id}' }).input(z.object({ id: z.coerce.number() })).output(Quote) })).not.toBe(h1)
    expect(changed({ add: contract.quotes.add.errors({ GONE: { status: 410 } }) })).not.toBe(h1)
    // a plain value (an OpenAPI document): its stable JSON
    expect(contractHash({ b: 1, a: [2] })).toBe(contractHash({ a: [2], b: 1 }))
  })

  it('answers another hash with 409 CONTRACT_SKEW; no header passes unless required', async () => {
    const req = (h) => new Request('http://x/api', { headers: h ? { 'x-v': h } : {} })
    expect(contractSkew(req('a'), { hash: 'a', header: 'x-v' })).toBeUndefined()
    expect(contractSkew(req(), { hash: 'a', header: 'x-v' })).toBeUndefined()
    const r = contractSkew(req('b'), { hash: 'a', header: 'x-v' })
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ defined: true, code: 'CONTRACT_SKEW', status: 409, data: { client: 'b', server: 'a' } })
    expect(contractSkew(req(), { hash: 'a', header: 'x-v', require: true }).status).toBe(409)
  })
})

describe('fixtures with renderComponent fakes', () => {
  const api = orpcClient(contract, { prefix: '/api' })
  function View() { return h('div') }

  it('fixture() checks data against the output schema and returns it as JSON delivers it', () => {
    expect(fixture(api.quotes.get, { id: 1, text: 't', tag: 'x', at: new Date(0) })).toEqual({ id: 1, text: 't', tag: 'x', at: '1970-01-01T00:00:00.000Z' })
    expect(() => fixture(api.quotes.get, { id: '1', text: 't', tag: 'x' })).toThrow(/fixture\(quotes\.get\) does not match the contract: id:/)
    expect(fixture(api.quotes.feed, { id: 2, text: 'e', tag: 'x' })).toEqual({ id: 2, text: 'e', tag: 'x' })  // one event
  })

  it('errorFixture() builds the declared error; an unknown code throws', () => {
    expect(errorFixture(api.quotes.add, 'DUPLICATE', { id: 4 })).toEqual({ status: 409, body: { defined: true, code: 'DUPLICATE', status: 409, message: 'DUPLICATE', data: { id: 4 } } })
    expect(() => errorFixture(api.quotes.add, 'NOPE')).toThrow(/no error 'NOPE'.*DUPLICATE/)
    expect(() => errorFixture(api.quotes.add, 'DUPLICATE', { id: 'x' })).toThrow(/does not match/)
  })

  it('t.respond / t.fail / t.push take an endpoint as the target', async () => {
    const C = (p) => View(p)
    C.initialState = { log: [], quotes: { status: 'idle' } }
    C.resources = { quotes: () => api.quotes.list() }
    C.connections = () => ({ feed: api.quotes.feed(undefined, { message: 'ARRIVED' }), other: { sse: '/other', message: 'OTHER' } })
    C.model = {
      GO: { HTTP: () => api.quotes.add({ text: 'abc', tag: 't' }, { ok: 'ADDED', error: 'FAILED' }) },
      ADDED: (s, q) => ({ ...s, log: [...s.log, 'added ' + q.id] }),
      FAILED: (s, { status, body }) => ({ ...s, log: [...s.log, `${status} ${body.code}`] }),
      ARRIVED: (s, q) => ({ ...s, log: [...s.log, 'event ' + q.id] }),
      OTHER: (s) => ({ ...s, log: [...s.log, 'other'] }),
    }
    const t = renderComponent(C)
    await t.ready()
    await t.respond('HTTP', fixture(api.quotes.list, []), api.quotes.list)
    expect(t.state.quotes).toMatchObject({ status: 'success', data: [] })
    await t.simulateAction('GO')
    await t.respond('HTTP', fixture(api.quotes.add, { id: 9, text: 'abc', tag: 't' }), api.quotes.add)
    await t.simulateAction('GO')
    const e = errorFixture(api.quotes.add, 'DUPLICATE', { id: 9 })
    await t.fail('HTTP', e.status, { request: api.quotes.add, body: e.body })
    await t.push('WS', fixture(api.quotes.feed, { id: 3, text: 'e', tag: 't' }), api.quotes.feed)
    expect(t.state.log).toEqual(['added 9', '409 DUPLICATE', 'event 3'])
    expect(() => t.respond('HTTP', {}, api.quotes.get)).toThrow(/endpoint quotes\.get/)
    t.dispose()
  })
})
