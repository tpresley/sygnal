// REFERENCE / TEST HELPER ONLY (round 2 decision): Sygnal does not ship or maintain a server.
// The supported pairing is oRPC's OpenAPIHandler with `sygnal/api`'s orpcClient (see
// ../../README.md §10 and docs guide/typed-apis); this handler stays as the spike's reference.
// Spike: the server half. `createHandler(contract, impl)` is a Fetch-API handler
// (Request → Response), so it mounts in Hono, Vite dev middleware, a Worker, or Node's http
// through any adapter. Security rules from RESEARCH-network-calls Option E:
// - every input is validated with the contract's Standard Schema before the function runs;
// - plain JSON on the wire (no reference-preserving serialisation);
// - mutations are POST only; every call needs the RPC header (a cross-origin page can't send it
//   without a preflight) and, when the browser sends Origin, the same origin (or an allowed one);
// - unknown procedures are 404 and thrown errors are a generic 500 unless they are ApiError.
import type { Contract, OutputOf, Procedure } from './contract.ts'
import { RPC_HEADER, SYNC } from './contract.ts'

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message) }
}

type Impl<P, CTX> = P extends Procedure<'stream', infer I, infer O>
  ? (input: OutputOf<I>, ctx: CTX & { signal: AbortSignal }) => AsyncIterable<OutputOf<O>>
  : P extends Procedure<any, infer I, infer O>
    ? (input: OutputOf<I>, ctx: CTX & { signal: AbortSignal }) => OutputOf<O> | Promise<OutputOf<O>>
    : never

export type Implementation<C extends Contract, CTX = {}> = { [K in keyof C]: Impl<C[K], CTX> }

export type HandlerOptions<CTX> = {
  prefix?: string
  /** per-request context (session, db handle, ...); auth is each procedure's job */
  context?: (req: Request) => CTX | Promise<CTX>
  /** origins allowed besides the request's own */
  origins?: string[]
  /** validate what each procedure returns against its output schema (dev: catches drift at the source) */
  validateOutput?: boolean
  /** SSE heartbeat comment interval, ms (default 15000) */
  heartbeatMs?: number
  /**
   * serve `<prefix>/$sync`: after a mutation that declares `invalidates`, every connected client
   * gets the tags (one channel for everyone in this spike: a real one scopes it per tenant / user)
   */
  sync?: boolean
}

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status: body === undefined ? 204 : status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  })

async function check(schema: any, value: unknown) {
  const r = await schema['~standard'].validate(value)
  return r.issues ? { issues: r.issues.map((i: any) => ({ message: i.message, path: i.path?.map((p: any) => p?.key ?? p) })) } : { value: r.value }
}

export function createHandler<C extends Contract, CTX = {}>(
  contract: C,
  impl: Partial<Implementation<C, CTX>>,
  options: HandlerOptions<CTX> = {},
): (req: Request) => Promise<Response> {
  const prefix = options.prefix ?? '/rpc'
  const hub = new Set<(tags: string[]) => void>()
  const syncProc: Procedure = { kind: 'stream', input: { '~standard': { validate: (value: unknown) => ({ value }) } } as any, output: {} as any }
  const syncFn = async function* (_: unknown, { signal }: { signal: AbortSignal }) {
    const queue: string[][] = []
    let wake = () => {}
    const l = (tags: string[]) => { queue.push(tags); wake() }
    hub.add(l)
    try {
      while (!signal.aborted) {
        if (!queue.length) await new Promise<void>((r) => { wake = r; signal.addEventListener('abort', () => r(), { once: true }) })
        while (queue.length) yield queue.shift()!
      }
    } finally { hub.delete(l) }
  }
  return async (req) => {
    const url = new URL(req.url)
    if (!url.pathname.startsWith(prefix + '/')) return json(404, { message: 'Not found' })
    const name = url.pathname.slice(prefix.length + 1)
    if (name === SYNC && options.sync) {
      if (req.headers.get(RPC_HEADER) !== '1') return json(403, { message: `Missing ${RPC_HEADER} header` })
      return sse(syncFn(undefined, { signal: req.signal }), syncProc, req, {})
    }
    const proc: Procedure | undefined = Object.hasOwn(contract, name) ? contract[name] : undefined
    const fn: any = proc && (impl as any)[name]
    if (!proc) return json(404, { message: `No procedure ${name}` })
    if (!fn) return json(501, { message: `${name} is not implemented` })

    // CSRF: the custom header, and the Origin (when sent) must be ours or allowed
    if (req.headers.get(RPC_HEADER) !== '1') return json(403, { message: `Missing ${RPC_HEADER} header` })
    const origin = req.headers.get('origin')
    if (origin && origin !== url.origin && !options.origins?.includes(origin)) return json(403, { message: 'Origin not allowed' })

    const method = proc.kind === 'mutation' ? 'POST' : 'GET'
    if (req.method !== method) return new Response(null, { status: 405, headers: { allow: method } })

    let raw: unknown
    try {
      if (method === 'POST') raw = await req.json()
      else { const s = url.searchParams.get('input'); raw = s === null ? undefined : JSON.parse(s) }
    } catch { return json(400, { message: 'Input is not JSON' }) }
    const input = await check(proc.input, raw)
    if (input.issues) return json(400, { message: 'Invalid input', issues: input.issues })

    const ctx = { ...((await options.context?.(req)) as CTX), signal: req.signal }
    try {
      if (proc.kind === 'stream') return sse(fn(input.value, ctx), proc, req, options)
      const out = await fn(input.value, ctx)
      if (options.validateOutput) {
        const v = await check(proc.output, out)
        if (v.issues) { console.error(`[rpc] ${name} returned data its contract rejects`, v.issues); return json(500, { message: 'Internal error' }) }
      }
      if (proc.invalidates?.length) { const tags = proc.invalidates.map((q) => `rpc:${q}`); hub.forEach((l) => l(tags)) }
      return json(200, out)
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, { message: e.message, data: e.data })
      console.error(`[rpc] ${name} failed`, e)
      return json(500, { message: 'Internal error' })
    }
  }
}

// an async iterable as text/event-stream: one `message` event per value, numbered ids
// (Last-Event-ID comes back on a reconnect: a procedure can read it from ctx in a later version)
function sse(it: AsyncIterable<unknown>, proc: Procedure, req: Request, options: HandlerOptions<any>) {
  const enc = new TextEncoder()
  const iter = it[Symbol.asyncIterator]()
  let n = 0
  let beat: any
  let closed = false
  // the client going away (abort / cancel) and the generator ending can race: close once
  const end = (ctl?: ReadableStreamDefaultController) => {
    if (closed) return
    closed = true
    clearInterval(beat)
    iter.return?.()
    try { ctl?.close() } catch {}
  }
  const body = new ReadableStream({
    start(ctl) {
      ctl.enqueue(enc.encode(': open\n\n'))
      beat = setInterval(() => ctl.enqueue(enc.encode(': ping\n\n')), options.heartbeatMs ?? 15000)
      req.signal.addEventListener('abort', () => end(ctl))
    },
    async pull(ctl) {
      try {
        const { value, done } = await iter.next()
        if (closed) return
        if (done) return end(ctl)
        if (options.validateOutput) {
          const v = await check(proc.output, value)
          if (v.issues) throw new Error('stream event rejected by its contract')
        }
        ctl.enqueue(enc.encode(`id: ${++n}\ndata: ${JSON.stringify(value)}\n\n`))
      } catch (e) {
        if (!closed) console.error('[rpc] stream failed', e)
        end(ctl)
      }
    },
    cancel() { end() },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

/** a fetch() that calls the handler in-process (tests, SSR): no port, no network */
export const inProcessFetch = (handler: (req: Request) => Promise<Response>, origin = 'http://localhost') =>
  (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input instanceof Request ? input : new Request(new URL(String(input), origin), init))
