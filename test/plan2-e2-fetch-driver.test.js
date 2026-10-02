// PLAN-2 E2 (b): makeFetchDriver() — request/response/error shapes, latest-only, abort,
// timeout, dispose, early replies.
import { describe, it, expect, vi, afterEach } from 'vitest'
import xs from 'xstream'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

function json(body, status = 200, headers = { 'Content-Type': 'application/json' }) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers })
}

/** fetch stub whose calls stay pending until the test settles them (ignores the signal) */
function controllable() {
  const calls = []
  const fn = vi.fn((url, init) => new Promise((resolve, reject) => calls.push({ url, init, resolve, reject })))
  return { fn, calls }
}

function start(options = {}) {
  let push
  const sink$ = xs.create({ start: l => { push = v => l.next(v) }, stop() {} })
  const source = makeFetchDriver(options)(sink$)
  const responses = [], failures = []
  source.select().addListener({ next: v => responses.push(v) })
  source.errors().addListener({ next: v => failures.push(v) })
  return { send: v => push(v), source, responses, failures }
}

afterEach(() => vi.unstubAllGlobals())

describe('makeFetchDriver: requests', () => {
  it('GETs the url (fetch read at request time), and delivers { category, value, status, request }', async () => {
    const f = controllable()
    const d = start()
    vi.stubGlobal('fetch', f.fn)
    const req = { category: 'quote', url: '/api/quote', id: 7 }
    d.send(req)
    expect(f.fn).toHaveBeenCalledTimes(1) // synchronously
    expect(f.calls[0].url).toBe('/api/quote')
    expect(f.calls[0].init.method).toBe('GET')
    f.calls[0].resolve(json({ text: 'hi' }))
    await tick()
    expect(d.responses).toEqual([{ category: 'quote', value: { text: 'hi' }, status: 200, request: req }])
    expect(d.failures).toEqual([])
  })

  it('a string is a GET of that url; query is appended, null values skipped; baseUrl and headers merge', async () => {
    const f = controllable()
    const d = start({ baseUrl: '/api', headers: { 'X-App': '1' }, fetch: f.fn })
    d.send('/ping')
    d.send({ url: '/search?x=1', query: { q: 'a b&c', page: 2, skip: null }, headers: { 'X-Req': '2' } })
    expect(f.calls[0].url).toBe('/api/ping')
    expect(f.calls[1].url).toBe('/api/search?x=1&q=a+b%26c&page=2')
    expect(f.calls[1].init.headers).toEqual({ 'X-App': '1', 'X-Req': '2' })
  })

  it('json is stringified and POSTed with a JSON content-type; other keys go to fetch init', () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    d.send({ url: '/save', json: { a: 1 }, credentials: 'include' })
    d.send({ url: '/put', method: 'PUT', json: [1], headers: { 'content-type': 'application/merge+json' } })
    expect(f.calls[0].init).toMatchObject({ method: 'POST', body: '{"a":1}', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    expect(f.calls[1].init.method).toBe('PUT')
    expect(f.calls[1].init.headers).toEqual({ 'content-type': 'application/merge+json' })
  })

  it('ignores null / undefined / non-object values (e.g. a sink returning nothing)', () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    d.send(null); d.send(undefined); d.send(42)
    expect(f.fn).not.toHaveBeenCalled()
  })
})

describe('makeFetchDriver: parsing', () => {
  it("'auto': JSON for a json content-type, text otherwise, null for 204; stubs without headers use json()", async () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    for (let i = 0; i < 4; i++) d.send({ url: '/' + i, category: String(i) })
    f.calls[0].resolve(json({ a: 1 }, 200, { 'Content-Type': 'application/vnd.api+json; charset=utf-8' }))
    f.calls[1].resolve(new Response('plain', { headers: { 'Content-Type': 'text/plain' } }))
    f.calls[2].resolve(new Response(null, { status: 204 }))
    f.calls[3].resolve({ ok: true, status: 200, json: async () => ({ stub: true }) })
    await tick(5)
    const byCat = Object.fromEntries(d.responses.map(r => [r.category, r.value]))
    expect(byCat).toEqual({ 0: { a: 1 }, 1: 'plain', 2: null, 3: { stub: true } })
  })

  it("parse 'text' / 'response' / a function", async () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    d.send({ url: '/a', category: 'a', parse: 'text' })
    d.send({ url: '/b', category: 'b', parse: 'response' })
    d.send({ url: '/c', category: 'c', parse: res => res.headers.get('x-total') })
    const res = json({ x: 1 }, 200, { 'Content-Type': 'application/json', 'X-Total': '42' })
    f.calls[0].resolve(json({ x: 1 }))
    f.calls[1].resolve(res)
    f.calls[2].resolve(json({}, 200, { 'X-Total': '42' }))
    await tick(5)
    const byCat = Object.fromEntries(d.responses.map(r => [r.category, r.value]))
    expect(byCat.a).toBe('{"x":1}')
    expect(byCat.b).toBe(res)
    expect(byCat.c).toBe('42')
  })
})

describe('makeFetchDriver: driver-level parse', () => {
  it('a parse function given to the driver applies to every request', async () => {
    const f = controllable()
    const d = start({ fetch: f.fn, parse: res => res.status * 2 })
    d.send({ url: '/a' })
    f.calls[0].resolve(json({}))
    await tick(5)
    expect(d.responses[0].value).toBe(400)
  })
})

describe('makeFetchDriver: failures go to errors(), never select()', () => {
  it('a non-2xx status: { error (status, body), category, request, status, body }', async () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    const req = { category: 'zip', url: '/api/zip/00000' }
    d.send(req)
    f.calls[0].resolve(json({ error: 'unknown' }, 404))
    await tick(5)
    expect(d.responses).toEqual([])
    expect(d.failures).toHaveLength(1)
    const fail = d.failures[0]
    expect(fail).toMatchObject({ category: 'zip', request: req, status: 404, body: { error: 'unknown' } })
    expect(fail.error.message).toMatch(/^HTTP 404/)
    expect(fail.error.status).toBe(404)
  })

  it('a network error, a body that does not parse, and no fetch at all', async () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    d.send({ url: '/a', category: 'a' })
    d.send({ url: '/b', category: 'b', parse: 'json' })
    f.calls[0].reject(new TypeError('Failed to fetch'))
    f.calls[1].resolve(new Response('not json', { status: 200 }))
    await tick(5)
    expect(d.failures.map(x => [x.category, x.error.name, x.status])).toEqual([['a', 'TypeError', undefined], ['b', 'SyntaxError', 200]])

    vi.stubGlobal('fetch', undefined)
    const d2 = start()
    d2.send({ url: '/x', category: 'x' })
    await tick()
    expect(d2.failures[0].error.message).toMatch(/fetch is not available/)
  })

  it('errors(category) and errors(fn) filter; an unheard failure is console.error\'d', async () => {
    const f = controllable()
    let push
    const src = makeFetchDriver({ fetch: f.fn })(xs.create({ start: l => { push = v => l.next(v) }, stop() {} }))
    const got = [], gotFn = []
    src.errors('a').addListener({ next: v => got.push(v.category) })
    src.errors(e => e.status === 500).addListener({ next: v => gotFn.push(v.category) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    push({ url: '/a', category: 'a' }); push({ url: '/b', category: 'b' }); push({ url: '/c', category: 'c' })
    f.calls[0].resolve(json({}, 500)); f.calls[1].resolve(json({}, 500)); f.calls[2].resolve(json({}, 400))
    await tick(5)
    expect(got).toEqual(['a'])
    expect(gotFn).toEqual(['a', 'b'])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(String(spy.mock.calls[0][0])).toContain("'c' failed")
    spy.mockRestore()
  })
})

describe('makeFetchDriver: latest-only, abort, timeout, dispose', () => {
  it('latest: true aborts the request in flight in the same category; its late reply/failure is dropped', async () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    d.send({ url: '/s?q=du', category: 'search', latest: true })
    d.send({ url: '/other', category: 'other' })
    d.send({ url: '/s?q=dune', category: 'search', latest: true })
    expect(f.calls[0].init.signal.aborted).toBe(true)
    expect(f.calls[1].init.signal.aborted).toBe(false)
    f.calls[2].resolve(json({ q: 'dune' }))
    f.calls[0].resolve(json({ q: 'du' })) // the stub ignores the signal: still dropped
    f.calls[1].resolve(json({ other: true }))
    await tick(5)
    expect(d.responses.map(r => r.value)).toEqual([{ q: 'dune' }, { other: true }])

    d.send({ url: '/s?q=x', category: 'search', latest: true })
    d.send({ url: '/s?q=xy', category: 'search', latest: true })
    f.calls[3].reject(new TypeError('Failed to fetch'))
    await tick(5)
    expect(d.failures).toEqual([])
  })

  it('the driver option latest applies to every request; a request can opt out', async () => {
    const f = controllable()
    const d = start({ fetch: f.fn, latest: true })
    d.send({ url: '/1', category: 'c' })
    d.send({ url: '/2', category: 'c' })
    d.send({ url: '/3', category: 'c', latest: false })
    expect(f.calls.map(c => c.init.signal.aborted)).toEqual([true, false, false])
  })

  it('{ category, abort: true } cancels that category; { abort: true } cancels everything', async () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    d.send({ url: '/1', category: 'a' })
    d.send({ url: '/2', category: 'b' })
    d.send({ category: 'a', abort: true })
    expect(f.fn).toHaveBeenCalledTimes(2)
    expect(f.calls.map(c => c.init.signal.aborted)).toEqual([true, false])
    d.send({ url: '/3', category: 'c' })
    d.send({ abort: true })
    expect(f.calls.map(c => c.init.signal.aborted)).toEqual([true, true, true])
    f.calls.forEach(c => c.resolve(json({})))
    await tick(5)
    expect(d.responses).toEqual([])
  })

  it('timeoutMs fails with a TimeoutError and aborts', async () => {
    const f = controllable()
    const d = start({ fetch: f.fn, timeoutMs: 20 })
    d.send({ url: '/slow', category: 'slow' })
    d.send({ url: '/slower', category: 'slower', timeoutMs: 0 })
    await tick(40)
    expect(d.failures).toHaveLength(1)
    expect(d.failures[0].error.name).toBe('TimeoutError')
    expect(f.calls[0].init.signal.aborted).toBe(true)
    f.calls[0].resolve(json({}))
    await tick(5)
    expect(d.responses).toEqual([])
  })

  it('dispose() aborts everything in flight and delivers nothing after', async () => {
    const f = controllable()
    const d = start({ fetch: f.fn })
    d.send({ url: '/1', category: 'a' })
    d.source.dispose()
    expect(f.calls[0].init.signal.aborted).toBe(true)
    f.calls[0].resolve(json({}))
    await tick(5)
    expect(d.responses).toEqual([])
  })

  it('replies before anything listens are held until the first listener subscribes', async () => {
    let push
    const src = makeFetchDriver({ fetch: async () => json({ boot: true }) })(xs.create({ start: l => { push = v => l.next(v) }, stop() {} }))
    push({ url: '/boot', category: 'boot' })
    await tick(5)
    const got = []
    src.select('boot').addListener({ next: v => got.push(v.value) })
    await tick()
    expect(got).toEqual([{ boot: true }])
  })
})
