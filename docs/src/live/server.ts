// The demo HTTP server of the live examples: a `fetch` for Sygnal's real fetch driver
// (makeFetchDriver({ fetch })), answered by the route table of a visible ```js live-server block.
// Only the network is stubbed: categories, latest/abort, resources and the query cache are the
// driver's own. Each request is reported as a note in the panel.

export type Handler = (req: DemoRequest) => DemoResponse | Promise<DemoResponse>

export interface DemoRequest {
  method: string
  url: string
  path: string
  params: Record<string, string>
  query: Record<string, string | string[]>
  json: any
  body: any
  headers: Record<string, string>
}

export interface DemoResponse {
  status?: number
  json?: any
  text?: string
  headers?: Record<string, string>
  delayMs?: number
  /**
   * A streamed body (PLAN-6 DX-1). `sse` items are Server-Sent Events: an object is
   * `event: <item.type>` + `data: <JSON>`, a string a raw `data: <string>` line; `stream` items
   * are raw text chunks. One item every `chunkMs` (default 40) after the headers (`delayMs`), as
   * a real ReadableStream. The request stays pending (data-live-pending) until the body ends,
   * errors or is aborted; an abort after the headers errors the body (an AbortError), as fetch does
   */
  sse?: Iterable<any> | AsyncIterable<any>
  stream?: Iterable<string> | AsyncIterable<string>
  chunkMs?: number
}

export const DEFAULT_CHUNK_MS = 40

const sseFrame = (item: any) =>
  typeof item === 'string' ? `data: ${item}\n\n`
    : `${item && typeof item.type === 'string' ? `event: ${item.type}\n` : ''}data: ${JSON.stringify(item)}\n\n`

export const DEFAULT_DELAY = 600
const NULL_BODY = new Set([101, 204, 205, 304])

interface Route { method?: string; re: RegExp; names: string[]; handler: Handler }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function compileRoutes(table: any): Route[] {
  if (table == null) return []
  if (typeof table !== 'object') throw new Error('Demo server: the live-server block must `export default` a route table ({ \'GET /api/x\': handler })')
  return Object.entries(table).map(([key, handler]) => {
    const m = key.trim().match(/^(?:([A-Za-z]+)\s+)?(\/\S*)$/)
    if (!m) throw new Error(`Demo server: route '${key}' is not 'METHOD /path' (e.g. 'GET /api/quotes/:id')`)
    if (typeof handler !== 'function') throw new Error(`Demo server: the route '${key}' needs a handler function`)
    const names: string[] = []
    const re = new RegExp('^' + m[2].split('/').map((seg) => {
      if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)' }
      if (seg === '*') { names.push('*'); return '(.*)' }
      return escape(seg)
    }).join('/') + '/?$')
    return { method: m[1]?.toUpperCase(), re, names, handler: handler as Handler }
  })
}

const abortError = (signal?: AbortSignal | null) =>
  signal?.reason instanceof Error || signal?.reason instanceof DOMException ? signal.reason : new DOMException('The operation was aborted.', 'AbortError')

/** what a request note is: answered by a route, no route (404), a handler that threw (500), aborted */
export type NoteKind = 'response' | 'no-route' | 'threw' | 'aborted'

export interface DemoFetchHooks {
  /** a request ended: `Demo server: POST /api/signup → 201 (600 ms)`, `→ 404 (no demo route, …)` */
  note: (text: string, kind: NoteKind) => void
  /** +1 when a request starts, -1 when it ends (answered, failed or aborted) */
  pending?: (delta: 1 | -1) => void
}

/** A fetch over the route table, reporting each request */
export function makeDemoFetch(table: any, { note, pending }: DemoFetchHooks) {
  const routes = compileRoutes(table)
  return (input: any, init: any = {}): Promise<Response> => new Promise<Response>((resolve0, reject0) => {
    let open = true
    pending?.(1)
    const end = () => { if (open) { open = false; pending?.(-1) } }
    const resolve = (r: Response) => { end(); resolve0(r) }
    const reject = (e: any) => { end(); reject0(e) }
    const t0 = performance.now()
    const elapsed = () => Math.round(performance.now() - t0)
    const url = new URL(typeof input === 'string' ? input : input?.url ?? String(input), typeof location !== 'undefined' ? location.href : 'http://localhost/')
    const method = String(init.method || 'GET').toUpperCase()
    const label = `Demo server: ${method} ${url.pathname}${url.search}`
    const signal: AbortSignal | undefined = init.signal
    let timer: any
    let done = false
    const onAbort = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      note(`${label} → aborted (${elapsed()} ms)`, 'aborted')
      reject(abortError(signal))
    }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })

    const respond = (res: DemoResponse | undefined, why?: string, kind: NoteKind = 'response') => {
      if (done) return
      const r = res && typeof res === 'object' ? res : {}
      const status = r.status ?? 200
      const delay = Math.max(0, (r.delayMs ?? DEFAULT_DELAY) - elapsed())
      const headers = new Headers(r.headers)
      if (r.sse !== undefined || r.stream !== undefined) return respondStream(r, status, delay, headers, why, kind)
      let body: string | null = null
      if (r.json !== undefined) {
        body = JSON.stringify(r.json)
        if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      } else if (r.text !== undefined) {
        body = String(r.text)
        if (!headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8')
      }
      timer = setTimeout(() => {
        if (done) return
        done = true
        signal?.removeEventListener('abort', onAbort)
        note(`${label} → ${status} (${why ? why + ', ' : ''}${elapsed()} ms)`, kind)
        try {
          resolve(new Response(NULL_BODY.has(status) ? null : body, { status, headers }))
        } catch (e) {
          reject(e)
        }
      }, delay)
    }

    /** a body streamed item by item, paced by timers; an abort errors it, as fetch does */
    const respondStream = (r: DemoResponse, status: number, delay: number, headers: Headers, why?: string, kind: NoteKind = 'response') => {
      const items: any = r.sse ?? r.stream
      const frame = r.sse !== undefined ? sseFrame : (x: any) => String(x)
      if (r.sse !== undefined && !headers.has('content-type')) headers.set('content-type', 'text/event-stream')
      if (r.stream !== undefined && !headers.has('content-type')) headers.set('content-type', 'text/plain; charset=utf-8')
      const it: Iterator<any> | AsyncIterator<any> | undefined = items?.[Symbol.asyncIterator]?.() ?? items?.[Symbol.iterator]?.()
      if (!it) return respond({ status: 500, text: `Demo server: ${r.sse !== undefined ? 'sse' : 'stream'} must be an iterable or an async iterable` }, 'the handler returned a body that is not iterable', 'threw')
      const enc = new TextEncoder()
      const chunkMs = Math.max(0, r.chunkMs ?? DEFAULT_CHUNK_MS)
      let sent = 0
      let ctl: ReadableStreamDefaultController<Uint8Array>
      const finish = (text: string, k: NoteKind) => {
        if (done) return
        done = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onBodyAbort)
        // stopped early: let a generator handler run its finally blocks
        if (k === 'aborted') Promise.resolve().then(() => it.return?.()).catch(() => {})
        note(text, k)
        end()
      }
      const pump = async () => {
        if (done) return
        let step: IteratorResult<any>
        try { step = await it.next() } catch (e: any) {
          ctl.error(e)
          return finish(`${label} → ${status}, the stream threw after ${sent} item(s): ${e?.message ?? e} (${elapsed()} ms)`, 'threw')
        }
        if (done) return
        if (step.done) {
          ctl.close()
          return finish(`${label} → ${status}, streamed ${sent} item(s) (${why ? why + ', ' : ''}${elapsed()} ms)`, kind)
        }
        sent++
        ctl.enqueue(enc.encode(frame(step.value)))
        timer = setTimeout(pump, chunkMs)
      }
      // an abort after the headers errors the body (the reader gets an AbortError)
      const onBodyAbort = () => {
        if (done) return
        try { ctl.error(abortError(signal)) } catch { /* closed */ }
        finish(`${label} → aborted after ${sent} item(s) (${elapsed()} ms)`, 'aborted')
      }
      timer = setTimeout(() => {
        if (done) return
        const body = new ReadableStream<Uint8Array>({
          start: (c) => { ctl = c },
          cancel: () => finish(`${label} → ${status}, the reader cancelled after ${sent} item(s) (${elapsed()} ms)`, 'aborted'),
        })
        signal?.removeEventListener('abort', onAbort)
        signal?.addEventListener('abort', onBodyAbort, { once: true })
        if (signal?.aborted) return onBodyAbort()
        resolve0(new Response(body, { status, headers }))
        pump()
      }, delay)
    }

    const route = routes.find((r) => (!r.method || r.method === method) && r.re.test(url.pathname))
    if (!route) return respond({ status: 404, text: `No demo route for ${method} ${url.pathname}` }, 'no demo route', 'no-route')

    const params: Record<string, string> = {}
    const m = url.pathname.match(route.re)!
    route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1] ?? '') })
    const query: Record<string, string | string[]> = {}
    for (const k of new Set(url.searchParams.keys())) {
      const all = url.searchParams.getAll(k)
      query[k] = all.length > 1 ? all : all[0]
    }
    const headers = new Headers(init.headers)
    let json: any
    if (typeof init.body === 'string' && /[/+]json\b/i.test(headers.get('content-type') || '')) {
      try { json = JSON.parse(init.body) } catch { /* not JSON: the handler reads `body` */ }
    }
    const req: DemoRequest = { method, url: url.href, path: url.pathname, params, query, json, body: init.body, headers: Object.fromEntries(headers) }
    Promise.resolve()
      .then(() => route.handler(req))
      .then((res) => respond(res), (e) => respond({ status: 500, text: String(e?.message ?? e) }, `the handler threw: ${e?.message ?? e}`, 'threw'))
  })
}

/** PLAN-11 U-4: the demo upload speed (bytes per second) of makeDemoXHR, and its limits */
export const DEMO_UPLOAD_BPS = 1024 * 1024
const UPLOAD_MS = [400, 4000]

const sizeOf = (body: any): number => {
  if (body == null) return 0
  if (typeof body === 'string') return new TextEncoder().encode(body).length
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    let n = 0
    body.forEach((v: any, k) => { n += k.length + (typeof v === 'string' ? new TextEncoder().encode(v).length : v.size) + 100 })
    return n
  }
  return String(body).length
}

/**
 * PLAN-11 U-4: an XMLHttpRequest for the live examples' `progress` requests (makeFetchDriver's
 * XMLHttpRequest option). It "uploads" the body at DEMO_UPLOAD_BPS (one progress event every
 * 100 ms, 0.4–4 s in all), then answers through the same demo fetch as every other request
 * (route table, delayMs, the panel's notes), and reports the download. Only what the driver
 * uses is implemented.
 */
export function makeDemoXHR(demoFetch: (input: any, init?: any) => Promise<Response>) {
  return class DemoXHR {
    upload: any = {}
    status = 0
    statusText = ''
    response: any = null
    responseType = ''
    withCredentials = false
    onload: any; onerror: any; onabort: any; ontimeout: any; onprogress: any
    private method = 'GET'
    private url = ''
    private headers: Record<string, string> = {}
    private resHeaders = ''
    private timer: any
    private ctl = new AbortController()
    private done = false
    open(method: string, url: string) { this.method = method; this.url = url }
    setRequestHeader(k: string, v: string) { this.headers[k] = v }
    getAllResponseHeaders() { return this.resHeaders }
    abort() {
      if (this.done) return
      this.done = true
      clearInterval(this.timer)
      this.ctl.abort()
      this.onabort?.()
    }
    send(body: any) {
      const total = sizeOf(body)
      const fetchNow = () => {
        if (this.done) return
        demoFetch(this.url, { method: this.method, headers: this.headers, body, signal: this.ctl.signal })
          .then(async (res) => {
            const blob = await res.blob()
            if (this.done) return
            this.done = true
            this.status = res.status
            this.statusText = res.statusText
            this.resHeaders = [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\r\n')
            this.response = blob
            this.onprogress?.({ loaded: blob.size, total: blob.size, lengthComputable: true })
            this.onload?.()
          }, () => { if (!this.done) { this.done = true; this.onerror?.() } })
      }
      if (!total) return fetchNow()
      const ms = Math.min(UPLOAD_MS[1], Math.max(UPLOAD_MS[0], (total / DEMO_UPLOAD_BPS) * 1000))
      const t0 = performance.now()
      this.timer = setInterval(() => {
        const loaded = Math.min(total, Math.round((total * (performance.now() - t0)) / ms))
        this.upload.onprogress?.({ loaded, total, lengthComputable: true })
        if (loaded >= total) {
          clearInterval(this.timer)
          this.upload.onload?.({ loaded: total, total, lengthComputable: true })
          fetchNow()
        }
      }, 100)
    }
  }
}
