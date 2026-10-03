// PLAN-2 4-R: makeFetchDriver review fixes — isolation (R4-2, D54), failures that throw
// (R4-3), early buffers (R4-4), headers and init (R4-5), query (R4-6), no legacy HYDRATE
// subscription (R4-7).
import { describe, it, expect, vi, afterEach } from 'vitest'
import xs from 'xstream'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** fetch stub whose calls stay pending until the test settles them; records aborts */
function controllable() {
  const calls = []
  const fn = vi.fn((url, init) => new Promise((resolve, reject) => {
    const call = { url, init, resolve, reject, aborted: false }
    init?.signal?.addEventListener('abort', () => { call.aborted = true })
    calls.push(call)
  }))
  return { fn, calls }
}

function driver(options) {
  let push
  const sink$ = xs.create({ start: l => { push = v => l.next(v) }, stop() {} })
  const source = makeFetchDriver(options)(sink$)
  return { source, send: v => push(v), sink$ }
}
const collect = (stream) => { const out = []; stream.addListener({ next: v => out.push(v), error() {}, complete() {} }); return out }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('R4-2: isolation (isolateSource / isolateSink, like @cycle/http)', () => {
  // what Sygnal's isolate() does for a child component with scope `s`
  const child = (d, scope) => {
    const src = d.source.isolateSource(d.source, scope)
    const out$ = xs.create()
    d.source.isolateSink(out$, scope).addListener({ next: d.send, error() {}, complete() {} })
    return { src, send: v => out$.shamefullySendNext(v) }
  }

  it('two instances with the same category and latest: true do not cancel each other; each sees only its reply', async () => {
    const f = controllable()
    const d = driver({ fetch: f.fn })
    const a = child(d, 'a'), b = child(d, 'b')
    const gotA = collect(a.src.select('detail')), gotB = collect(b.src.select('detail'))
    const root = collect(d.source.select('detail'))
    await tick()
    a.send({ url: '/items/1', category: 'detail', latest: true })
    b.send({ url: '/items/2', category: 'detail', latest: true })
    expect(f.calls.map(c => c.aborted)).toEqual([false, false])
    f.calls[1].resolve(json({ id: 2 }))
    f.calls[0].resolve(json({ id: 1 }))
    await vi.waitFor(() => expect(root).toHaveLength(2), { timeout: 2000, interval: 5 })
    expect(gotA.map(r => r.value)).toEqual([{ id: 1 }])
    expect(gotB.map(r => r.value)).toEqual([{ id: 2 }])
    // the reply's request is the request as the component sent it
    expect(gotA[0].request).toEqual({ url: '/items/1', category: 'detail', latest: true })
  })

  it('latest: true still supersedes within one instance', async () => {
    const f = controllable()
    const d = driver({ fetch: f.fn })
    const a = child(d, 'a'), b = child(d, 'b')
    const gotA = collect(a.src.select('s'))
    collect(b.src.select('s'))
    await tick()
    b.send({ url: '/b', category: 's', latest: true })
    a.send({ url: '/a1', category: 's', latest: true })
    a.send({ url: '/a2', category: 's', latest: true })
    expect(f.calls.map(c => c.aborted)).toEqual([false, true, false])
    f.calls[1].resolve(json(1)); f.calls[2].resolve(json(2))
    await vi.waitFor(() => expect(gotA.map(r => r.value)).toEqual([2]), { timeout: 2000, interval: 5 })
  })

  it('abort cancels only the sending instance (with and without a category)', async () => {
    const f = controllable()
    const d = driver({ fetch: f.fn })
    const a = child(d, 'a'), b = child(d, 'b')
    a.send({ url: '/a', category: 's' }); b.send({ url: '/b', category: 's' }); b.send({ url: '/b2', category: 't' })
    a.send({ category: 's', abort: true })
    expect(f.calls.map(c => c.aborted)).toEqual([true, false, false])
    a.send({ url: '/a3', category: 't' })
    a.send({ abort: true })
    expect(f.calls.map(c => c.aborted)).toEqual([true, false, false, true])
  })

  it('errors() is scoped too; the driver option latest acts per instance', async () => {
    const f = controllable()
    const d = driver({ fetch: f.fn, latest: true })
    const a = child(d, 'a'), b = child(d, 'b')
    const errA = collect(a.src.errors()), errB = collect(b.src.errors())
    await tick()
    a.send({ url: '/a', category: 'x' }); b.send({ url: '/b', category: 'x' })
    expect(f.calls.map(c => c.aborted)).toEqual([false, false])
    f.calls[0].resolve(json({}, 500))
    await vi.waitFor(() => expect(errA).toHaveLength(1), { timeout: 2000, interval: 5 })
    expect(errB).toEqual([])
  })

  it('nested scopes: a parent sees its descendants’ replies, a sibling subtree does not; strings are scoped as { url }', async () => {
    const f = controllable()
    const d = driver({ fetch: f.fn })
    const parent = d.source.isolateSource(d.source, 'p')
    const leaf = parent.isolateSource(parent, 'leaf')
    const other = d.source.isolateSource(d.source, 'q')
    const leaf$ = xs.create()
    // the leaf's sink goes through its own isolate, then the parent's
    d.source.isolateSink(parent.isolateSink(leaf$, 'leaf'), 'p').addListener({ next: d.send, error() {}, complete() {} })
    const gotParent = collect(parent.select()), gotLeaf = collect(leaf.select()), gotOther = collect(other.select())
    await tick()
    leaf$.shamefullySendNext('/x')
    f.calls[0].resolve(json('ok'))
    await vi.waitFor(() => expect(gotLeaf).toHaveLength(1), { timeout: 2000, interval: 5 })
    expect(gotParent).toHaveLength(1)
    expect(gotOther).toEqual([])
    expect(gotLeaf[0].request).toEqual({ url: '/x' })
  })

  it('the isolated sources are reply-capable sources (PLAN-3 1-A; R4-7 __sygnalFetch removed with the legacy HYDRATE path)', () => {
    const d = driver({ fetch: controllable().fn })
    expect(d.source.__sygnalReplies).toBe(true)
    expect(d.source.isolateSource(d.source, 'a').__sygnalReplies).toBe(true)
    expect(typeof d.source.isolateSource(d.source, 'a').replies).toBe('function')
  })
})

describe('R4-3: anything that throws while handling a reply fails the request', () => {
  const unhandled = () => {
    const seen = []
    const on = e => seen.push(String(e))
    process.on('unhandledRejection', on)
    return { seen, off: () => process.off('unhandledRejection', on) }
  }

  it('a fetch that resolves to a non-Response goes to errors(), with no unhandled rejection or leak', async () => {
    const u = unhandled()
    const d = driver({ fetch: () => Promise.resolve(undefined) })
    const errs = collect(d.source.errors()), got = collect(d.source.select())
    await tick()
    d.send({ url: '/x', category: 'c', latest: true })
    await vi.waitFor(() => expect(errs).toHaveLength(1), { timeout: 2000, interval: 5 })
    await tick(10)
    u.off()
    expect(errs[0].category).toBe('c')
    expect(errs[0].error).toBeInstanceOf(TypeError)
    expect(got).toEqual([])
    expect(u.seen).toEqual([])
  })

  it('a listener that throws does not stop the other listeners, and is logged', async () => {
    const u = unhandled()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = driver({ fetch: () => Promise.resolve(json({ a: 1 })) })
    d.source.select().addListener({ next: () => { throw new Error('boom in reducer') }, error() {}, complete() {} })
    const got = collect(d.source.select())
    await tick()
    d.send('/x')
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 2000, interval: 5 })
    await tick(10)
    u.off()
    expect(u.seen).toEqual([])
    expect(log.mock.calls.some(c => String(c[0]).includes('a listener threw'))).toBe(true)
  })
})

describe('R4-4: separate early buffers for select() and errors()', () => {
  it('a reply that arrives while only errors() listens is held for select()', async () => {
    const d = driver({ fetch: () => Promise.resolve(json({ ok: 1 })) })
    collect(d.source.errors())
    d.send('/x')
    await tick(5)
    const got = collect(d.source.select())
    await tick(5)
    expect(got.map(r => r.value)).toEqual([{ ok: 1 }])
  })

  it('a failure that arrives while only select() listens is held for an errors() listener subscribing in the same macrotask', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = driver({ fetch: () => { throw new TypeError('offline') } })
    collect(d.source.select())
    d.send({ url: '/x', category: 'c' })
    for (let i = 0; i < 5; i++) await null // the failure is delivered on a microtask
    const errs = collect(d.source.errors())
    await tick(10)
    expect(errs.map(e => e.error.message)).toEqual(['offline'])
    expect(log).not.toHaveBeenCalled()
  })

  it('an early failure nothing ever listens to is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = driver({ fetch: () => Promise.resolve(json({}, 500)) })
    d.send({ url: '/x', category: 'c' })
    await vi.waitFor(() => expect(log).toHaveBeenCalled(), { timeout: 2000, interval: 5 })
    expect(String(log.mock.calls[0][0])).toContain("request 'c' failed")
  })
})

describe('R4-5: headers and fetch init', () => {
  it('headers merge case-insensitively (the request wins); Headers instances work', () => {
    const f = controllable()
    const d = driver({ fetch: f.fn, headers: { 'content-type': 'text/plain', 'X-App': '1' } })
    d.send({ url: '/x', json: { a: 1 }, headers: { 'Content-Type': 'application/merge-patch+json' } })
    d.send({ url: '/y', headers: new Headers({ 'X-Req': '2' }) })
    d.send({ url: '/z', json: 1 })
    expect(f.calls[0].init.headers).toEqual({ 'content-type': 'application/merge-patch+json', 'x-app': '1' })
    expect(f.calls[1].init.headers).toEqual({ 'content-type': 'text/plain', 'x-app': '1', 'x-req': '2' })
    // the driver's content-type wins over the json default
    expect(f.calls[2].init.headers['content-type']).toBe('text/plain')
  })

  it('fetch options go under init (request and driver); other top-level keys are app data and are not sent', () => {
    const f = controllable()
    const d = driver({ fetch: f.fn, init: { credentials: 'include', cache: 'no-store' } })
    const req = { url: '/x', id: 7, credentials: 'omit', init: { cache: 'reload', mode: 'cors', signal: 'nope', bogus: 1, headers: { 'X-I': '1' } } }
    d.send(req)
    const init = f.calls[0].init
    expect(init).toMatchObject({ method: 'GET', credentials: 'include', cache: 'reload', mode: 'cors', headers: { 'x-i': '1' } })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect('id' in init || 'bogus' in init || 'url' in init || 'init' in init).toBe(false)
  })
})

describe('R4-6: query strings', () => {
  it('arrays repeat the key, the query goes before a #fragment, an existing query is extended', () => {
    const f = controllable()
    const d = driver({ fetch: f.fn })
    d.send({ url: '/s', query: { tag: ['a', 'b'], skip: [null], q: 'x y' } })
    d.send({ url: '/s?x=1#top', query: { q: 1 } })
    d.send({ url: '/s?', query: { q: 1 } })
    d.send({ url: '/s#h', query: { q: null } })
    expect(f.calls.map(c => c.url)).toEqual(['/s?tag=a&tag=b&q=x+y', '/s?x=1&q=1#top', '/s?q=1', '/s#h'])
  })
})
