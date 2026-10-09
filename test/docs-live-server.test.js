// PLAN-6 DX-1 (G-616): the docs' live demo server (docs/src/live/server.ts), the `fetch` the live
// runtime gives the HTTP and LLM drivers. Plain responses, streamed bodies (`sse` / `stream`):
// pacing, pending accounting, abort before and after the headers, a reader's cancel(), a stream
// that throws, and the real openResponses() transport reading a demo route built with
// encodeOpenResponses. No network: the route table answers in-process.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { makeDemoFetch, DEFAULT_CHUNK_MS } from '../docs/src/live/server.ts'
import { openResponses } from '../src/extra/ai/transports/openResponses.ts'
import { encodeOpenResponses } from '../src/extra/ai/transports/encodeOpenResponses.ts'

afterEach(() => { vi.useRealTimers() })

/** a demo fetch over `table`, recording notes and the pending count */
function server(table) {
  const notes = []
  const log = { notes, pending: 0, peak: 0 }
  log.fetch = makeDemoFetch(table, {
    note: (text, kind) => notes.push({ text, kind }),
    pending: (d) => { log.pending += d; log.peak = Math.max(log.peak, log.pending) },
  })
  return log
}

const post = (json, signal) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json), signal })

async function readAll(res) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  const chunks = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return chunks
    chunks.push(dec.decode(value))
  }
}

describe('demo server: plain responses', () => {
  it('json after delayMs, with a note and the pending count back to 0', async () => {
    const s = server({ 'GET /api/x/:id': ({ params, query }) => ({ json: { id: params.id, q: query.q }, delayMs: 0 }) })
    const res = await s.fetch('/api/x/7?q=a')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toEqual({ id: '7', q: 'a' })
    expect(s.pending).toBe(0)
    expect(s.peak).toBe(1)
    expect(s.notes).toEqual([{ text: expect.stringMatching(/^Demo server: GET \/api\/x\/7\?q=a → 200 \(\d+ ms\)$/), kind: 'response' }])
  })

  it('no route: 404 with a no-route note; a handler that throws: 500', async () => {
    const s = server({ 'GET /boom': () => { throw new Error('nope') } })
    const a = await s.fetch('/missing', { method: 'POST' }).catch((e) => e)
    expect(a.status).toBe(404)
    vi.useFakeTimers()
    const p = s.fetch('/boom')
    await vi.advanceTimersByTimeAsync(700)
    expect((await p).status).toBe(500)
    expect(s.notes.map((n) => n.kind)).toEqual(['no-route', 'threw'])
  }, 10_000)
})

describe('demo server: streamed bodies', () => {
  it('sse: text/event-stream frames (event + JSON data; a string is a raw data line)', async () => {
    const s = server({ 'POST /v1/events': ({ json }) => ({ sse: [{ type: 'a', n: json.n }, 'raw', { type: 'b' }], delayMs: 0, chunkMs: 0 }) })
    const res = await s.fetch('/v1/events', post({ n: 1 }))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(s.pending).toBe(1) // the body hasn't ended yet
    expect((await readAll(res)).join('')).toBe('event: a\ndata: {"type":"a","n":1}\n\ndata: raw\n\nevent: b\ndata: {"type":"b"}\n\n')
    await null
    expect(s.pending).toBe(0)
    expect(s.notes.at(-1)).toEqual({ text: expect.stringMatching(/→ 200, streamed 3 item\(s\) \(\d+ ms\)$/), kind: 'response' })
  })

  it('stream: raw text chunks; an async iterable works too', async () => {
    async function* words() { yield 'Hello '; yield 'there' }
    const s = server({ '/t': () => ({ stream: words(), delayMs: 0, chunkMs: 0, headers: { 'x-demo': '1' } }) })
    const res = await s.fetch('/t')
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('x-demo')).toBe('1')
    expect(await readAll(res)).toEqual(['Hello ', 'there'])
  })

  it('paces one item per chunkMs after the headers (delayMs), default 40 ms', async () => {
    expect(DEFAULT_CHUNK_MS).toBe(40)
    vi.useFakeTimers()
    const s = server({ '/t': () => ({ stream: ['a', 'b', 'c'], delayMs: 300 }) })
    let res
    s.fetch('/t').then((r) => { res = r })
    await vi.advanceTimersByTimeAsync(299)
    expect(res).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(res.status).toBe(200)
    const reader = res.body.getReader()
    const got = []
    const reading = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) return; got.push(new TextDecoder().decode(value)) } })()
    await vi.advanceTimersByTimeAsync(0)
    expect(got).toEqual(['a'])
    await vi.advanceTimersByTimeAsync(39)
    expect(got).toEqual(['a'])
    await vi.advanceTimersByTimeAsync(1)
    expect(got).toEqual(['a', 'b'])
    await vi.advanceTimersByTimeAsync(80)
    await reading
    expect(got).toEqual(['a', 'b', 'c'])
    expect(s.pending).toBe(0)
  })

  it('an abort before the headers rejects with an AbortError, as fetch does', async () => {
    vi.useFakeTimers()
    const s = server({ '/t': () => ({ sse: ['x'], delayMs: 500 }) })
    const ac = new AbortController()
    const p = s.fetch('/t', { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(100)
    ac.abort()
    const e = await p.catch((x) => x)
    expect(e.name).toBe('AbortError')
    expect(s.pending).toBe(0)
    expect(s.notes).toEqual([{ text: expect.stringMatching(/→ aborted \(\d+ ms\)$/), kind: 'aborted' }])
  })

  it('an abort after the headers errors the body (AbortError), stops the items and returns the generator', async () => {
    vi.useFakeTimers()
    let closed = false
    function* forever() { try { for (let i = 0; ; i++) yield `${i} ` } finally { closed = true } }
    const s = server({ '/t': () => ({ stream: forever(), delayMs: 0, chunkMs: 10 }) })
    const ac = new AbortController()
    const p = s.fetch('/t', { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(0)
    const res = await p
    const reader = res.body.getReader()
    expect((await reader.read()).value).toBeDefined()
    await vi.advanceTimersByTimeAsync(25)
    ac.abort()
    let err
    for (;;) {
      try { const { done } = await reader.read(); if (done) break } catch (e) { err = e; break }
    }
    expect(err?.name).toBe('AbortError')
    await vi.advanceTimersByTimeAsync(100)
    expect(closed).toBe(true)
    expect(s.pending).toBe(0)
    expect(s.notes).toEqual([{ text: expect.stringMatching(/→ aborted after 3 item\(s\) \(\d+ ms\)$/), kind: 'aborted' }])
  })

  it("a reader's cancel() ends the request", async () => {
    const s = server({ '/t': () => ({ stream: ['a', 'b', 'c', 'd'], delayMs: 0, chunkMs: 20 }) })
    const res = await s.fetch('/t')
    const reader = res.body.getReader()
    await reader.read()
    await reader.cancel()
    expect(s.pending).toBe(0)
    expect(s.notes).toEqual([{ text: expect.stringMatching(/the reader cancelled after 1 item\(s\)/), kind: 'aborted' }])
  })

  it('a stream that throws errors the body, with a threw note; a body that is not iterable is a 500', async () => {
    function* bad() { yield 'a'; throw new Error('broken') }
    const s = server({ '/t': () => ({ stream: bad(), delayMs: 0, chunkMs: 0 }), '/n': () => ({ sse: 42, delayMs: 0 }) })
    const res = await s.fetch('/t')
    const e = await readAll(res).catch((x) => x)
    expect(e.message).toBe('broken')
    expect(s.notes.at(-1)).toEqual({ text: expect.stringMatching(/the stream threw after 1 item\(s\): broken/), kind: 'threw' })
    const n = await s.fetch('/n')
    expect(n.status).toBe(500)
    expect(s.notes.at(-1).kind).toBe('threw')
    expect(s.pending).toBe(0)
  })
})

describe('demo server + openResponses() (the live LLM driver\'s transport)', () => {
  const collect = async (it) => { const out = []; for await (const e of it) out.push(e); return out }

  it('a route answering with encodeOpenResponses streams text and a tool call through the real transport', async () => {
    let seen
    const s = server({
      'POST /v1/responses': ({ json }) => {
        seen = json
        return { sse: encodeOpenResponses(['Hello ', 'there', { toolCall: { id: 'c1', name: 'lamp_set_color', input: { color: 'blue' } } }]), delayMs: 0, chunkMs: 0 }
      },
    })
    const t = openResponses({ model: 'demo', fetch: s.fetch })
    const events = await collect(t.stream({ messages: [{ role: 'user', content: 'Hi' }], instructions: 'Be brief', tools: { lamp_set_color: { description: 'Set it', inputSchema: { type: 'object', properties: { color: { type: 'string' } } } } } }, new AbortController().signal))
    expect(seen).toMatchObject({ model: 'demo', stream: true, instructions: 'Be brief', input: [{ role: 'user', content: 'Hi' }], tools: [{ type: 'function', name: 'lamp_set_color' }] })
    expect(events.filter((e) => e.type === 'text').map((e) => e.delta).join('')).toBe('Hello there')
    expect(events.find((e) => e.type === 'tool-call')).toEqual({ type: 'tool-call', id: 'c1', name: 'lamp_set_color', input: { color: 'blue' } })
    expect(events.at(-1)).toMatchObject({ type: 'finish', reason: 'tool-calls' })
    expect(s.pending).toBe(0)
  })

  it('aborting the transport mid-stream errors the body and ends the request', async () => {
    const s = server({ 'POST /v1/responses': () => ({ sse: encodeOpenResponses('one two three four five six'.split(/(?<= )/)), delayMs: 0, chunkMs: 5 }) })
    const ac = new AbortController()
    const out = []
    const err = await (async () => {
      for await (const e of openResponses({ fetch: s.fetch }).stream({ messages: [{ role: 'user', content: 'go' }] }, ac.signal)) {
        out.push(e)
        if (out.filter((x) => x.type === 'text').length === 2) ac.abort()
      }
    })().catch((e) => e)
    expect(err?.name).toBe('AbortError')
    expect(out.filter((x) => x.type === 'text').length).toBe(2)
    await new Promise((r) => setTimeout(r, 20))
    expect(s.pending).toBe(0)
    expect(s.notes.at(-1).kind).toBe('aborted')
  })
})
