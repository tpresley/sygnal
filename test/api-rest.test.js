// @vitest-environment jsdom
// sygnal/api (dev preview): openApiClient (openapi-typescript `paths`, openapi-fetch's input shape)
// and honoClient (Hono route types, hc's input shape) against a real Hono app (pinned), in-process.
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { makeSocketDriver } from '../src/extra/socketDriver.js'
import { openApiClient, honoClient, fixture } from '../src/extra/api/index.js'

function app() {
  const quotes = [{ id: 1, text: 'Start where you are.', tag: 'calm' }]
  const listeners = new Set()
  const seen = []
  const a = new Hono()
    .get('/api/quotes', (c) => {
      seen.push({ tag: c.req.query('tag'), tags: c.req.queries('tags'), 'f[min]': c.req.query('f[min]') })
      const tag = c.req.query('tag')
      return c.json(quotes.filter(q => !tag || q.tag === tag))
    })
    .get('/api/quotes/:id', (c) => {
      const q = quotes.find(q => q.id === Number(c.req.param('id')))
      return q ? c.json(q, 200) : c.json({ message: 'No such quote' }, 404)
    })
    .post('/api/quotes', async (c) => {
      const body = await c.req.json()
      if (quotes.some(q => q.text === body.text)) return c.json({ message: 'Already there' }, 409)
      const q = { id: quotes.length + 1, text: body.text, tag: body.tag }
      quotes.push(q)
      listeners.forEach(l => l(q))
      return c.json(q, 201)
    })
    .delete('/api/quotes/:id', (c) => c.body(null, 204))
    .get('/api/feed', (c) => streamSSE(c, async (stream) => {
      const l = (q) => stream.writeSSE({ data: JSON.stringify(q) })
      listeners.add(l)
      await new Promise(r => stream.onAbort(r))
      listeners.delete(l)
    }))
  const fetch = async (url, init) => a.fetch(new Request(new URL(String(url), 'http://localhost'), init))
  return { fetch, seen }
}

const until = async (cond, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)) }
}

describe('openApiClient', () => {
  const api = openApiClient({ prefix: '/api' })
  const list = api.get('/quotes')
  const one = api.get('/quotes/{id}')
  const add = api.post('/quotes')
  const feed = api.sse('/feed')

  it('builds requests from openapi-fetch-shaped input', () => {
    expect(list({ params: { query: { tag: 'calm', tags: ['a', 'b'], f: { min: 2 } } } }, { ok: 'L' })).toEqual({
      url: '/api/quotes', endpoint: 'GET /quotes', query: { tag: 'calm', tags: ['a', 'b'], 'f[min]': 2 }, tags: ['api:GET /quotes'], ok: 'L',
    })
    expect(one({ params: { path: { id: 3 } } })).toMatchObject({ url: '/api/quotes/3', endpoint: 'GET /quotes/{id}' })
    expect(add({ body: { text: 'abc', tag: 't' } }, { ok: 'ADDED', invalidates: [list] })).toEqual({
      url: '/api/quotes', endpoint: 'POST /quotes', method: 'POST', json: { text: 'abc', tag: 't' }, ok: 'ADDED', invalidates: ['api:GET /quotes'],
    })
    expect(api.delete('/quotes/{id}')({ params: { path: { id: 2 } } })).toMatchObject({ url: '/api/quotes/2', method: 'DELETE', json: null })
    expect(feed({ params: { query: { tag: 'x' } } }, { message: 'EV' })).toEqual({ sse: '/api/feed?tag=x', endpoint: 'SSE /feed', message: 'EV' })
    expect(list.id).toBe('GET /quotes')
  })

  it('round-trips against a REST server: resource, mutation, 404 body, SSE', async () => {
    const s = app()
    function V() { return h('div') }
    V.initialState = { quotes: { status: 'idle' }, log: [] }
    V.resources = { quotes: () => list({ params: { query: { tags: ['solo'], f: { min: 1 } } } }) }
    V.connections = () => ({ feed: feed(undefined, { message: 'EV', headers: { 'x-client': '1' } }) })
    V.model = {
      ADD: { HTTP: () => add({ body: { text: 'New one', tag: 'calm' } }, { ok: 'ADDED', invalidates: [list] }) },
      GET: { HTTP: () => one({ params: { path: { id: 99 } } }, { ok: 'GOT', error: 'MISSING' }) },
      ADDED: (st, q) => ({ ...st, log: [...st.log, 'added ' + q.id] }),
      MISSING: (st, { status, body }) => ({ ...st, log: [...st.log, `${status} ${body.message}`] }),
      EV: (st, q) => ({ ...st, log: [...st.log, 'event ' + q.text] }),
    }
    const t = renderComponent(V, { drivers: { HTTP: makeFetchDriver({ fetch: s.fetch }), WS: makeSocketDriver({ fetch: s.fetch }) } })
    await until(() => t.state.quotes.status === 'success')
    expect(s.seen[0]).toEqual({ tag: undefined, tags: ['solo'], 'f[min]': '1' })   // a one-element array stays an array
    await new Promise(r => setTimeout(r, 20))
    await t.simulateAction('ADD')
    await until(() => t.state.log.includes('added 2') && t.state.log.includes('event New one'))
    await until(() => t.state.quotes.data?.length === 2)
    await t.simulateAction('GET')
    await until(() => t.state.log.includes('404 No such quote'))
    t.dispose()
  })
})

describe('honoClient', () => {
  const api = honoClient()
  it('builds requests from hc-shaped input (:param, query, json)', () => {
    expect(api.get('/api/quotes/:id')({ param: { id: '4' } })).toMatchObject({ url: '/api/quotes/4', endpoint: 'GET /api/quotes/:id' })
    expect(api.get('/api/quotes')({ query: { tag: 'calm' } })).toMatchObject({ url: '/api/quotes', query: { tag: 'calm' }, tags: ['api:GET /api/quotes'] })
    expect(api.post('/api/quotes')({ json: { text: 'abc', tag: 't' } }, { ok: 'A' })).toMatchObject({ method: 'POST', json: { text: 'abc', tag: 't' }, ok: 'A' })
    expect(api.sse('/api/feed')(undefined, { message: 'EV' })).toEqual({ sse: '/api/feed', endpoint: 'SSE /api/feed', message: 'EV' })
    expect(() => api.get('/api/quotes/:id')({})).toThrow(/needs the path parameter 'id'/)
  })

  it('round-trips against the Hono app; fixtures are typed only (no runtime schema)', async () => {
    const s = app()
    const add = api.post('/api/quotes')
    function V() { return h('div') }
    V.initialState = { log: [] }
    V.model = {
      ADD: { HTTP: () => add({ json: { text: 'Hono', tag: 't' } }, { ok: 'ADDED', error: 'FAILED' }) },
      ADDED: (st, q) => ({ ...st, log: [...st.log, 'added ' + q.text] }),
      FAILED: (st, { status }) => ({ ...st, log: [...st.log, 'failed ' + status] }),
    }
    const t = renderComponent(V, { drivers: { HTTP: makeFetchDriver({ fetch: s.fetch }) } })
    await t.ready()
    await t.simulateAction('ADD')
    await until(() => t.state.log.length === 1)
    await t.simulateAction('ADD')
    await until(() => t.state.log.length === 2)
    expect(t.state.log).toEqual(['added Hono', 'failed 409'])
    expect(fixture(add, { id: 1, text: 'x', tag: 'y' })).toEqual({ id: 1, text: 'x', tag: 'y' })
    t.dispose()
  })
})
