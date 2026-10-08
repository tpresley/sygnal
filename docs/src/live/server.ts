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
}

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
    const url = new URL(typeof input === 'string' ? input : input?.url ?? String(input), location.href)
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
