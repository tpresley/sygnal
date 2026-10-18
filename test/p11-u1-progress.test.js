// PLAN-11 U-1 / U-2 (D555): upload and download progress on makeFetchDriver requests.
// `progress: 'ACTION'` replies to the sender, `progress: true` goes to HTTP.progress(); the
// transport is XMLHttpRequest (here a scripted fake class), turned back into a Response.
// renderComponent's HTTP fake: t.progress(). SYG636: progress that can't be reported.
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { makeFetchDriver, xhrFetch } from '../src/extra/fetchDriver.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

/** a scripted XMLHttpRequest: each instance is kept so the test drives its events */
function fakeXhr() {
  const made = []
  class X {
    constructor() {
      this.upload = {}
      this.headers = {}
      this.status = 0
      made.push(this)
    }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(k, v) { this.headers[k] = v }
    send(body) { this.body = body }
    abort() { this.aborted = true; this.onabort?.() }
    getAllResponseHeaders() { return this.rawHeaders || '' }
    // test helpers
    up(loaded, total) { this.upload.onprogress?.({ loaded, total, lengthComputable: total > 0 }) }
    upDone(total) { this.upload.onload?.({ loaded: total, total, lengthComputable: true }) }
    down(loaded, total) { this.onprogress?.({ loaded, total, lengthComputable: total > 0 }) }
    finish(status, body, type = 'application/json') {
      this.status = status
      this.statusText = status == 200 ? 'OK' : 'Not Found'
      this.rawHeaders = `content-type: ${type}\r\nx-a: 1\r\n`
      this.response = new Blob([typeof body == 'string' ? body : JSON.stringify(body)])
      this.onload?.()
    }
  }
  return { X, made }
}

const tick = () => new Promise(r => setTimeout(r, 0))

describe('xhrFetch: XMLHttpRequest as a fetch-shaped call', () => {
  it('sends method, headers, credentials and body; resolves a real Response', async () => {
    const { X, made } = fakeXhr()
    const steps = []
    const p = xhrFetch(X, '/up', { method: 'POST', headers: { 'x-token': 't' }, body: 'abc', credentials: 'include' }, (...a) => steps.push(a))
    const x = made[0]
    expect([x.method, x.url, x.headers, x.body, x.withCredentials, x.responseType]).toEqual(['POST', '/up', { 'x-token': 't' }, 'abc', true, 'blob'])
    x.up(1, 3)
    x.upDone(3)
    x.finish(200, { ok: 1 })
    const res = await p
    expect(res.status).toBe(200)
    expect(res.headers.get('x-a')).toBe('1')
    expect(await res.json()).toEqual({ ok: 1 })
    expect(steps).toEqual([['upload', 1, 3], ['upload', 3, 3], ['download', 8, 8]])
  })

  it('throttles steps to one per 50 ms per phase, keeping the first and the final one', async () => {
    vi.useFakeTimers()
    try {
      const { X, made } = fakeXhr()
      const steps = []
      xhrFetch(X, '/up', { method: 'POST', body: 'x' }, (...a) => steps.push(a))
      const x = made[0]
      x.up(10, 100)
      x.up(20, 100) // < 50 ms: dropped
      vi.advanceTimersByTime(60)
      x.up(30, 100)
      x.up(100, 100) // the last: kept
      x.upDone(100) // same loaded: not repeated
      expect(steps.map(s => s[1])).toEqual([10, 30, 100])
    } finally { vi.useRealTimers() }
  })

  it('a null body for 204; an unknown length gives total 0; errors and aborts reject like fetch', async () => {
    const { X, made } = fakeXhr()
    const steps = []
    const p = xhrFetch(X, '/a', {}, (...a) => steps.push(a))
    made[0].down(5, 0)
    made[0].status = 204
    made[0].onload()
    expect((await p).status).toBe(204)
    expect(steps[0]).toEqual(['download', 5, 0])

    const e = xhrFetch(X, '/b', {}, () => {})
    made[1].onerror()
    await expect(e).rejects.toBeInstanceOf(TypeError)

    const ctl = new AbortController()
    const a = xhrFetch(X, '/c', { signal: ctl.signal }, () => {})
    ctl.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(made[2].aborted).toBe(true)
  })
})

describe('makeFetchDriver: progress requests', () => {
  it('progress: true sends steps to progress(category); the reply still reaches select()', async () => {
    const { X, made } = fakeXhr()
    const fetch = vi.fn()
    const req$ = xs.create()
    const src = makeFetchDriver({ XMLHttpRequest: X, fetch })(req$)
    const steps = [], replies = []
    src.progress('up').addListener({ next: v => steps.push(v) })
    src.progress('other').addListener({ next: () => { throw new Error('wrong category') } })
    src.select('up').addListener({ next: v => replies.push(v) })
    req$.shamefullySendNext({ url: '/upload', body: 'data', category: 'up', progress: true })
    expect(fetch).not.toHaveBeenCalled()
    const x = made[0]
    x.up(2, 4)
    x.upDone(4)
    x.finish(200, { id: 9 })
    await tick(); await tick()
    expect(steps.map(({ phase, loaded, total, fraction }) => [phase, loaded, total, fraction]))
      .toEqual([['upload', 2, 4, 0.5], ['upload', 4, 4, 1], ['download', 8, 8, 1]])
    expect(steps[0].request.url).toBe('/upload')
    expect(replies.map(r => r.value)).toEqual([{ id: 9 }])
  })

  it('a download with no Content-Length: total and fraction are null', async () => {
    const { X, made } = fakeXhr()
    const req$ = xs.create()
    const src = makeFetchDriver({ XMLHttpRequest: X })(req$)
    const steps = []
    src.progress().addListener({ next: v => steps.push(v) })
    src.select().addListener({ next: () => {} })
    req$.shamefullySendNext({ url: '/big', progress: true })
    made[0].down(10, 0)
    expect(steps[0]).toMatchObject({ phase: 'download', loaded: 10, total: null, fraction: null })
  })

  it('a cancelled progress request aborts its XHR and sends no more steps', async () => {
    const { X, made } = fakeXhr()
    const req$ = xs.create()
    const src = makeFetchDriver({ XMLHttpRequest: X })(req$)
    const steps = []
    src.progress().addListener({ next: v => steps.push(v) })
    src.errors().addListener({ next: () => {} })
    req$.shamefullySendNext({ url: '/u', body: 'x', category: 'up', progress: true })
    made[0].up(1, 10)
    req$.shamefullySendNext({ category: 'up', abort: true })
    expect(made[0].aborted).toBe(true)
    made[0].up(5, 10)
    expect(steps).toHaveLength(1)
  })

  it('without XMLHttpRequest a progress request is a plain fetch', async () => {
    const fetch = vi.fn(async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }))
    const req$ = xs.create()
    const src = makeFetchDriver({ fetch, XMLHttpRequest: null })(req$)
    const got = []
    src.select().addListener({ next: v => got.push(v.value) })
    const g = globalThis.XMLHttpRequest
    delete globalThis.XMLHttpRequest
    try {
      req$.shamefullySendNext({ url: '/x', progress: true })
      await tick(); await tick()
    } finally { if (g) globalThis.XMLHttpRequest = g }
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(got).toEqual([{ a: 1 }])
  })
})

// ---- components: the reply action, under renderComponent and run() --------------------------

function Uploader({ state }) {
  return h('div', null,
    h('button', { className: 'send' }, 'Send'),
    h('p', { className: 'status' }, state.status))
}
Uploader.initialState = { status: 'idle', fraction: 0, phase: null }
Uploader.intent = ({ DOM }) => ({ SEND: DOM.click('.send') })
Uploader.model = {
  SEND: { HTTP: () => ({ url: '/upload', body: 'file', progress: 'UPLOADING', ok: 'UPLOADED', error: 'FAILED' }) },
  UPLOADING: (s, { phase, fraction }) => ({ ...s, status: 'uploading', phase, fraction }),
  UPLOADED: (s) => ({ ...s, status: 'done' }),
  FAILED: (s) => ({ ...s, status: 'failed' }),
}

let t
afterEach(() => { t?.dispose(); t = null; _resetDiagnostics() })

describe('renderComponent: t.progress()', () => {
  it('delivers steps as the progress action; the request stays pending until t.respond', async () => {
    t = renderComponent(Uploader)
    t.simulateEvent('.send', 'click')
    await t.progress('HTTP', { loaded: 25, total: 100 }, 'UPLOADING')
    expect(t.state).toMatchObject({ status: 'uploading', phase: 'upload', fraction: 0.25 })
    await t.progress('HTTP', { loaded: 10, total: 10, phase: 'download' })
    expect(t.state).toMatchObject({ phase: 'download', fraction: 1 })
    await t.respond('HTTP', { id: 1 }, 'UPLOADED')
    expect(t.state.status).toBe('done')
  })

  it('progress: true reaches HTTP.progress() in the intent', async () => {
    function Plain({ state }) { return h('p', null, String(state.f)) }
    Plain.initialState = { f: 0 }
    Plain.intent = ({ HTTP }) => ({ STEP: HTTP.progress('up'), DONE: HTTP.select('up') })
    Plain.model = {
      BOOTSTRAP: { HTTP: () => ({ url: '/u', json: { a: 1 }, category: 'up', progress: true }) },
      STEP: (s, p) => ({ ...s, f: p.fraction }),
      DONE: (s) => ({ ...s, f: 'done' }),
    }
    t = renderComponent(Plain)
    await t.ready()
    await t.progress('HTTP', { loaded: 3, total: 4 }, 'up')
    expect(t.state.f).toBe(0.75)
    await t.respond('HTTP', {}, 'up')
    expect(t.state.f).toBe('done')
  })

  it('t.progress on a request without progress throws a hint', async () => {
    const C = (p) => Uploader(p)
    C.initialState = Uploader.initialState
    C.intent = Uploader.intent
    C.model = { ...Uploader.model, SEND: { HTTP: () => ({ url: '/upload', body: 'file', ok: 'UPLOADED', error: 'FAILED' }) } }
    t = renderComponent(C)
    t.simulateEvent('.send', 'click')
    await t.next(() => true, 300).catch(() => {})
    expect(() => t.progress('HTTP', { loaded: 1, total: 2 })).toThrow(/has no progress: send it with progress/)
  })
})

describe('SYG636: progress that can\'t be reported as asked', () => {
  it('fetch-only init options on a progress request warn once', async () => {
    setupChecks()
    const C = (p) => Uploader(p)
    C.initialState = Uploader.initialState
    C.intent = Uploader.intent
    C.model = { ...Uploader.model, SEND: { HTTP: () => ({ url: '/upload', body: 'f', progress: 'UPLOADING', ok: 'UPLOADED', init: { keepalive: true, mode: 'cors' } }) } }
    t = renderComponent(C)
    t.simulateEvent('.send', 'click')
    t.simulateEvent('.send', 'click')
    await t.settle()
    const d = diagnostics('SYG636')
    expect(d).toHaveLength(1)
    expect(d[0].message).toMatch(/ignores init\.keepalive, init\.mode/)
    expect(d[0].severity).toBe('warn')
  })
})
