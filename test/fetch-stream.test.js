// @vitest-environment jsdom
// Sift friction (7.2): a fetch request that streams its body (`stream: 'sse' | 'ndjson' |
// 'text'`), e.g. a copilot endpoint that POSTs and answers `data: {...}` lines ending with
// `data: [DONE]`. Each piece is the `chunk` action, the end the `ok` action; `done` names the
// end-of-stream piece. latest / abort / timeoutMs (time to first byte) / sender scoping apply;
// retry and the cache don't. renderComponent: t.push('HTTP', piece) per piece, t.respond to end.
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { createElement as h } from '../src/pragma/index.js'
import { makeFetchDriver } from '../src/extra/fetchDriver.js'
import { queryCache } from '../src/extra/queryCache.js'
import { renderComponent } from '../src/extra/testing.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { sleep } from '../evals/agent-ergonomics/hidden/_support/queries.js'
import { until } from './support/wait.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  _resetDiagnostics()
})

/** a streamed Response the test writes to: `write(text)`, `end()`, `error(e)`; `cancelled` once the reader stops */
function streamed(type = 'text/event-stream', status = 200) {
  const enc = new TextEncoder()
  let ctl
  const s = {
    cancelled: false,
    body: new ReadableStream({ start: (c) => { ctl = c }, cancel: () => { s.cancelled = true } }),
    write: (text) => ctl.enqueue(enc.encode(text)),
    end: () => ctl.close(),
    error: (e) => ctl.error(e),
  }
  s.response = new Response(s.body, { status, headers: { 'content-type': type } })
  return s
}

/** the driver alone over a stubbed fetch, with a fake sender (reply actions) */
function harness(options = {}) {
  const calls = []
  const fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
    const c = { url, init, resolve, reject }
    calls.push(c)
    init.signal?.addEventListener('abort', () => { c.aborted = true; reject(new DOMException('aborted', 'AbortError')) })
  }))
  const req$ = xs.create()
  const src = makeFetchDriver({ fetch, ...options })(req$)
  const got = []
  const sender = {}
  src.replies(sender).addListener({ next: (a) => got.push([a.type, a.data]) })
  const send = (r) => {
    Object.defineProperty(r, '__emitterId', { value: sender })
    req$.shamefullySendNext(r)
  }
  return { calls, src, got, send, req$, fetch }
}

describe('stream: sse', () => {
  it('delivers each data line (JSON-parsed when it parses) as the chunk action, then ok at the end', async () => {
    const H = harness()
    H.send({ url: '/api/copilot', json: { q: 'hi' }, stream: 'sse', chunk: 'DELTA', ok: 'DONE', error: 'FAILED' })
    expect(H.calls[0].init.method).toBe('POST')
    const s = streamed()
    H.calls[0].resolve(s.response)
    s.write('data: {"t":"Hel')
    await sleep(5)
    expect(H.got).toEqual([])
    s.write('lo"}\n\ndata: plain text\n\n: a comment\n\n')
    await until(() => expect(H.got).toHaveLength(2))
    expect(H.got).toEqual([['DELTA', { t: 'Hello' }], ['DELTA', 'plain text']])
    s.write('event: other\ndata: [1,2]\n\n')
    s.end()
    await until(() => expect(H.got).toHaveLength(4))
    expect(H.got.slice(2)).toEqual([['DELTA', [1, 2]], ['DONE', undefined]])
  })

  it("done: '[DONE]' ends the stream at that piece: not delivered, the reader cancelled, ok follows", async () => {
    const H = harness()
    H.send({ url: '/api/copilot', json: {}, stream: 'sse', chunk: 'DELTA', ok: 'DONE', done: '[DONE]' })
    const s = streamed()
    H.calls[0].resolve(s.response)
    s.write('data: {"t":"a"}\n\ndata: [DONE]\n\ndata: {"t":"late"}\n\n')
    await until(() => expect(H.got).toEqual([['DELTA', { t: 'a' }], ['DONE', undefined]]))
    expect(s.cancelled).toBe(true)
  })

  it('done as a predicate of the parsed piece', async () => {
    const H = harness()
    H.send({ url: '/a', json: {}, stream: 'sse', chunk: 'DELTA', ok: 'DONE', done: (p) => p.type === 'finish' })
    const s = streamed()
    H.calls[0].resolve(s.response)
    s.write('data: {"type":"text","v":1}\n\ndata: {"type":"finish"}\n\n')
    await until(() => expect(H.got).toEqual([['DELTA', { type: 'text', v: 1 }], ['DONE', undefined]]))
  })

  it('a non-2xx status is the error action, with status, body and headers', async () => {
    const H = harness()
    H.send({ url: '/a', json: {}, stream: 'sse', chunk: 'DELTA', ok: 'DONE', error: 'FAILED' })
    H.calls[0].resolve(new Response('{"message":"busy"}', { status: 429, headers: { 'content-type': 'application/json', 'Retry-After': '3' } }))
    await until(() => expect(H.got).toHaveLength(1))
    const [type, data] = H.got[0]
    expect(type).toBe('FAILED')
    expect(data).toMatchObject({ status: 429, body: { message: 'busy' } })
    expect(data.headers.get('retry-after')).toBe('3')
  })

  it('an error mid-stream is the error action (after the pieces so far)', async () => {
    const H = harness()
    H.send({ url: '/a', json: {}, stream: 'sse', chunk: 'DELTA', error: 'FAILED' })
    const s = streamed()
    H.calls[0].resolve(s.response)
    s.write('data: 1\n\n')
    await until(() => expect(H.got).toHaveLength(1))
    s.error(new TypeError('network'))
    await until(() => expect(H.got).toHaveLength(2))
    expect(H.got[1][0]).toBe('FAILED')
    expect(H.got[1][1].error.message).toBe('network')
  })
})

describe('stream: ndjson and text', () => {
  it('ndjson: each non-blank line, parsed, across chunk boundaries', async () => {
    const H = harness()
    H.send({ url: '/a', json: {}, stream: 'ndjson', chunk: 'ROW', ok: 'END' })
    const s = streamed('application/x-ndjson')
    H.calls[0].resolve(s.response)
    s.write('{"a":1}\n{"a"')
    s.write(':2}\r\n\n{"a":3}')
    s.end()
    await until(() => expect(H.got).toEqual([['ROW', { a: 1 }], ['ROW', { a: 2 }], ['ROW', { a: 3 }], ['END', undefined]]))
  })

  it('ndjson: a line that is not JSON fails the request', async () => {
    const H = harness()
    H.send({ url: '/a', json: {}, stream: 'ndjson', chunk: 'ROW', error: 'FAILED' })
    const s = streamed('application/x-ndjson')
    H.calls[0].resolve(s.response)
    s.write('{"a":1}\nnope\n')
    await until(() => expect(H.got.map(g => g[0])).toEqual(['ROW', 'FAILED']))
    expect(H.got[1][1].error).toBeInstanceOf(SyntaxError)
  })

  it('text: the text as it arrives', async () => {
    const H = harness()
    H.send({ url: '/a', stream: 'text', chunk: 'TEXT', ok: 'END' })
    const s = streamed('text/plain')
    H.calls[0].resolve(s.response)
    s.write('Hel')
    await until(() => expect(H.got).toEqual([['TEXT', 'Hel']]))
    s.write('lo')
    s.end()
    await until(() => expect(H.got).toEqual([['TEXT', 'Hel'], ['TEXT', 'lo'], ['END', undefined]]))
  })

  it('an unknown mode fails the request', async () => {
    const H = harness()
    H.send({ url: '/a', stream: 'xml', chunk: 'X', error: 'FAILED' })
    await until(() => expect(H.got).toHaveLength(1))
    expect(H.got[0][1].error.message).toMatch(/stream must be 'sse', 'ndjson' or 'text'/)
    expect(H.fetch).not.toHaveBeenCalled()
  })
})

describe('stream: abort, latest, timeout, no retry, no cache', () => {
  it('latest: a new request aborts the stream in flight; its later pieces are never delivered', async () => {
    const H = harness()
    H.send({ url: '/a', json: { n: 1 }, stream: 'sse', chunk: 'DELTA', ok: 'DONE', latest: true })
    const s1 = streamed()
    H.calls[0].resolve(s1.response)
    s1.write('data: 1\n\n')
    await until(() => expect(H.got).toEqual([['DELTA', 1]]))
    H.send({ url: '/a', json: { n: 2 }, stream: 'sse', chunk: 'DELTA', ok: 'DONE', latest: true })
    expect(H.calls[0].aborted).toBe(true)
    s1.write('data: 99\n\n')
    const s2 = streamed()
    H.calls[1].resolve(s2.response)
    s2.write('data: 2\n\n')
    s2.end()
    await until(() => expect(H.got).toEqual([['DELTA', 1], ['DELTA', 2], ['DONE', undefined]]))
  })

  it("{ abort: 'DELTA' } cancels it by its chunk lane (key: chunk when there is no ok / error)", async () => {
    const H = harness()
    H.send({ url: '/a', json: {}, stream: 'sse', chunk: 'DELTA' })
    H.send({ abort: 'DELTA' })
    expect(H.calls[0].aborted).toBe(true)
  })

  it('timeoutMs is the time to the first byte; a slow stream after it does not time out', async () => {
    const H = harness()
    H.send({ url: '/a', json: {}, stream: 'sse', chunk: 'DELTA', ok: 'DONE', error: 'FAILED', timeoutMs: 40 })
    const s = streamed()
    H.calls[0].resolve(s.response)
    await sleep(10)
    s.write('data: 1\n\n')
    await sleep(80)
    s.write('data: 2\n\n')
    s.end()
    await until(() => expect(H.got).toEqual([['DELTA', 1], ['DELTA', 2], ['DONE', undefined]]))
  })

  it('no byte within timeoutMs: a TimeoutError', async () => {
    const H = harness()
    H.send({ url: '/a', json: {}, stream: 'sse', chunk: 'DELTA', error: 'FAILED', timeoutMs: 20 })
    H.calls[0].resolve(streamed().response)
    await until(() => expect(H.got).toHaveLength(1))
    expect(H.got[0][1].error.name).toBe('TimeoutError')
    expect(H.calls[0].aborted).toBe(true)
  })

  it('is never retried and never cached or shared', async () => {
    const H = harness({ retry: 3, cache: queryCache() })
    const r = { url: '/a', stream: 'text', chunk: 'T', error: 'FAILED', retry: 2, cache: true, staleTime: 1e5 }
    H.send({ ...r })
    H.send({ ...r, key: 'second' })
    expect(H.fetch).toHaveBeenCalledTimes(2)
    H.calls[0].resolve(new Response('x', { status: 503 }))
    await until(() => expect(H.got).toHaveLength(1))
    await sleep(30)
    expect(H.fetch).toHaveBeenCalledTimes(2)
    expect(H.src.__inspect().cache).toEqual([])
  })

  it('without reply actions each piece is a reply on select(category); the end adds nothing', async () => {
    const H = harness()
    const seen = []
    H.src.select('chat').addListener({ next: (v) => seen.push(v.value) })
    H.req$.shamefullySendNext({ url: '/a', json: {}, stream: 'sse', category: 'chat' })
    const s = streamed()
    H.calls[0].resolve(s.response)
    s.write('data: {"a":1}\n\ndata: b\n\n')
    s.end()
    await sleep(20)
    expect(seen).toEqual([{ a: 1 }, 'b'])
  })
})

// a copilot panel: POST, pieces appended, DONE at the end
function Copilot({ state }) {
  return h('div', null, h('p', { className: 'answer' }, state.answer), h('p', { className: 'status' }, state.status))
}
Copilot.initialState = { answer: '', status: 'idle' }
Copilot.model = {
  ASK: {
    STATE: (s) => ({ ...s, answer: '', status: 'streaming' }),
    HTTP: (s, q) => ({ url: '/api/copilot', json: { q }, stream: 'sse', chunk: 'DELTA', ok: 'DONE', error: 'FAILED', done: '[DONE]', latest: true }),
  },
  DELTA: (s, piece) => ({ ...s, answer: s.answer + piece.text }),
  DONE: (s) => ({ ...s, status: 'done' }),
  FAILED: (s, { error }) => ({ ...s, status: 'failed: ' + error.message }),
}

describe('renderComponent: t.push per piece, t.respond to end', () => {
  it('pieces are written in the request mode and parsed by the real driver', async () => {
    t = renderComponent(Copilot)
    await t.simulateAction('ASK', 'hi')
    expect(t.requests('HTTP')).toMatchObject([{ url: '/api/copilot', json: { q: 'hi' }, stream: 'sse' }])
    await t.push('HTTP', { text: 'Hel' })
    expect(t.state).toMatchObject({ answer: 'Hel', status: 'streaming' })
    await t.push('HTTP', { text: 'lo' }, 'DELTA')
    expect(t.state.answer).toBe('Hello')
    await t.respond('HTTP', null)
    expect(t.state.status).toBe('done')
    expect(() => t.push('HTTP', { text: 'x' })).toThrow(/no pending HTTP request with stream/)
  })

  it("the done sentinel pushed as a piece ends it too", async () => {
    t = renderComponent(Copilot)
    await t.simulateAction('ASK', 'hi')
    await t.push('HTTP', { text: 'a' })
    await t.push('HTTP', '[DONE]')
    expect(t.state).toMatchObject({ answer: 'a', status: 'done' })
  })

  it('t.respond with a value writes it as the last piece; t.push before the request is sent waits for it', async () => {
    t = renderComponent(Copilot)
    t.simulateAction('ASK', 'hi')
    t.push('HTTP', { text: 'x' })
    await t.respond('HTTP', { text: 'y' })
    expect(t.state).toMatchObject({ answer: 'xy', status: 'done' })
  })

  it('t.fail before any piece: the error action; after a piece: an error mid-stream', async () => {
    t = renderComponent(Copilot)
    await t.simulateAction('ASK', 'hi')
    await t.fail('HTTP', 500)
    expect(t.state.status).toMatch(/^failed: HTTP 500/)
    await t.simulateAction('ASK', 'again')
    await t.push('HTTP', { text: 'a' })
    await t.fail('HTTP', 'connection reset')
    expect(t.state).toMatchObject({ answer: 'a', status: 'failed: connection reset' })
  })

  it('latest: a second ASK aborts the first stream; t.push goes to the new one', async () => {
    t = renderComponent(Copilot)
    await t.simulateAction('ASK', 'one')
    await t.push('HTTP', { text: '1' })
    await t.simulateAction('ASK', 'two')
    expect(t.state.answer).toBe('')
    await t.push('HTTP', { text: '2' })
    await t.respond('HTTP', null)
    expect(t.state).toMatchObject({ answer: '2', status: 'done' })
    expect(t.requests('HTTP')).toHaveLength(2)
  })
})
