// PLAN-11 E-1: server-sent events with request headers. An `sse` connection with `headers` is
// read with FetchEventSource (fetch + the sygnal/ai SSE parser, extended with id / retry), since
// the native EventSource can't send an Authorization header.
import { describe, it, expect, vi } from 'vitest'
import xs from 'xstream'
import { FetchEventSource } from '../src/extra/fetchEventSource.js'
import { makeSocketDriver } from '../src/extra/socketDriver.js'

const enc = new TextEncoder()
/** a fetch whose responses are SSE streams the test writes to */
function sseServer() {
  const calls = []
  const fetch = vi.fn((url, init) => {
    let ctl
    const body = new ReadableStream({ start: c => { ctl = c } })
    const call = {
      url, init,
      send: (text) => ctl.enqueue(enc.encode(text)),
      end: () => ctl.close(),
    }
    init.signal?.addEventListener('abort', () => { call.aborted = true; try { ctl.error(new DOMException('aborted', 'AbortError')) } catch (_) {} })
    calls.push(call)
    return Promise.resolve(new Response(body, { status: call.status ?? 200, headers: { 'content-type': 'text/event-stream' } }))
  })
  return { fetch, calls }
}
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }

describe('FetchEventSource', () => {
  it('sends the headers, opens, delivers message and named events with lastEventId', async () => {
    const srv = sseServer()
    const es = new FetchEventSource('/sse', { headers: { authorization: 'Bearer t' }, fetch: srv.fetch, withCredentials: true })
    const got = []
    es.onopen = () => got.push('open')
    es.onmessage = (e) => got.push(['message', e.data, e.lastEventId])
    es.addEventListener('tick', (e) => got.push(['tick', e.data]))
    await flush()
    expect(srv.calls[0].init.headers).toEqual({ accept: 'text/event-stream', authorization: 'Bearer t' })
    expect(srv.calls[0].init.credentials).toBe('include')
    expect(es.readyState).toBe(1)
    srv.calls[0].send('id: 7\ndata: {"a":1}\n\nevent: tick\ndata: x\n\n')
    await flush()
    expect(got).toEqual(['open', ['message', '{"a":1}', '7'], ['tick', 'x']])
    es.close()
    expect(srv.calls[0].aborted).toBe(true)
  })

  it('reconnects after the stream ends, after retry ms, with Last-Event-ID', async () => {
    const srv = sseServer()
    const es = new FetchEventSource('/sse', { headers: { authorization: 'Bearer t' }, fetch: srv.fetch })
    const errors = []
    es.onerror = () => errors.push(es.readyState)
    await flush()
    srv.calls[0].send('retry: 5\nid: 3\ndata: one\n\n')
    srv.calls[0].end()
    await flush()
    expect(errors).toEqual([0])
    await new Promise(r => setTimeout(r, 20))
    expect(srv.calls).toHaveLength(2)
    expect(srv.calls[1].init.headers['last-event-id']).toBe('3')
    es.close()
  })

  it('a non-2xx status is an error with readyState CLOSED, and no retry', async () => {
    const fetch = vi.fn(async () => new Response('no', { status: 401, headers: { 'content-type': 'text/plain' } }))
    const es = new FetchEventSource('/sse', { headers: { a: 'b' }, fetch })
    const errors = []
    es.onerror = (e) => errors.push([es.readyState, e.error.status])
    await flush()
    expect(errors).toEqual([[2, 401]])
    await new Promise(r => setTimeout(r, 20))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('makeSocketDriver: sse connections with headers', () => {
  const sender = (v, id = 1) => Object.defineProperty(v, '__emitterId', { value: id })

  it('reads the stream with fetch, sending the headers; replies reach the sender; a new token reconnects', async () => {
    const srv = sseServer()
    const sink = xs.create()
    const src = makeSocketDriver({ fetch: srv.fetch, EventSource: undefined })(sink)
    const replies = []
    src.replies(1).addListener({ next: (a) => replies.push([a.type, a.data]) })
    const spec = (token) => ({ connections: { feed: { sse: '/feed', headers: { authorization: `Bearer ${token}` }, message: 'GOT', open: 'OPEN' } } })
    sink.shamefullySendNext(sender(spec('a')))
    await flush()
    expect(srv.fetch).toHaveBeenCalledTimes(1)
    expect(srv.calls[0].init.headers.authorization).toBe('Bearer a')
    srv.calls[0].send('data: {"n":1}\n\n')
    await flush()
    expect(replies).toEqual([['OPEN', { reconnected: false }], ['GOT', { n: 1 }]])
    // a changed header is a new connection: the old request is aborted, a new one sent
    sink.shamefullySendNext(sender(spec('b')))
    await flush()
    expect(srv.calls[0].aborted).toBe(true)
    expect(srv.calls[1].init.headers.authorization).toBe('Bearer b')
    // the same spec again only rebinds
    sink.shamefullySendNext(sender(spec('b')))
    await flush()
    expect(srv.calls).toHaveLength(2)
    src.dispose()
    expect(srv.calls[1].aborted).toBe(true)
  })

  it('an EventSource option still wins, and gets the headers in its init', async () => {
    const made = []
    class ES { constructor(url, init) { made.push([url, init]) } close() {} }
    const sink = xs.create()
    const src = makeSocketDriver({ EventSource: ES })(sink)
    sink.shamefullySendNext(sender({ connections: { feed: { sse: '/feed', headers: { authorization: 'Bearer x' } } } }))
    expect(made).toEqual([['/feed', { withCredentials: false, headers: { authorization: 'Bearer x' }, fetch: undefined }]])
    src.dispose()
  })

  it('without headers: the native EventSource, as before', () => {
    const made = []
    const g = globalThis.EventSource
    globalThis.EventSource = class { constructor(url, init) { made.push([url, init]) } close() {} }
    try {
      const sink = xs.create()
      const src = makeSocketDriver()(sink)
      sink.shamefullySendNext(sender({ connections: { feed: { sse: '/feed' } } }))
      expect(made).toEqual([['/feed', { withCredentials: false }]])
      src.dispose()
    } finally { globalThis.EventSource = g }
  })
})
