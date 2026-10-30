/*
 * Inside the Worker (a browser Worker or Node's worker_threads): one sandbox, the QuickJS side of
 * `isolation: 'worker'` (worker.ts). Built as dist/sandbox-worker.{esm,cjs}.js; its only imports
 * are the optional peers. No DOM here: renders go to the page as JSON, fetches go to the page
 * (its policy, its fetch), and the page's watchdog terminates the worker when it stops answering.
 */
import {PROTOCOL, limitsOf} from './protocol'
import {loadQuickJS, nodeImport} from './quickjs'
import {createEngine, type Engine} from './engine'

const g: any = globalThis
let port: any = null
const post = (m: any) => port.postMessage(m)
const fetches = new Map<number, {ok: (v: any) => void; fail: (e: any) => void}>()
let sb: Engine | null = null, fetchSeq = 0

function onMessage(m: any) {
  if (!m || typeof m != 'object') return
  if (m.t === 'init') return void init(m).catch((e) => post({t: 'error', reason: 'error', message: String(e?.message || e)}))
  if (m.t === 'ping') return post({t: 'pong'})
  if (m.t === 'fetched') {
    const f = fetches.get(m.id)
    fetches.delete(m.id)
    return f && (m.ok ? f.ok(m.res) : f.fail(new Error(m.error)))
  }
  if (!sb) return
  if (m.t === 'event') sb.dispatch(m.id, String(m.type), m.init || {})
  else if (m.t === 'props') sb.setProps(m.p)
}

async function init(m: any) {
  if (m.v !== PROTOCOL) return post({t: 'error', reason: 'protocol', message: `the page speaks protocol ${m.v}, the worker ${PROTOCOL}`})
  const limits = limitsOf(m.limits)
  const t0 = performance.now()
  const QJS = await loadQuickJS({maxWasmBytes: limits.maxWasmBytes, wasm: m.wasm})
  const wasmMs = performance.now() - t0
  sb = createEngine(QJS, {
    kernel: m.kernel, source: m.source, exportName: m.exportName, props: m.props, limits,
    // checked here (the allowlist) and again on the page, which makes the request
    fetch: m.fetch && {...m.fetch, impl: (url: string, init: any) => new Promise((ok, fail) => {
      const id = ++fetchSeq
      fetches.set(id, {ok, fail})
      post({t: 'fetch', id, url, init: {method: init.method, headers: init.headers, body: init.body}})
    }).then((r: any) => ({status: r.status, headers: {get: (k: string) => r.headers[k.toLowerCase()] ?? null}, text: async () => r.body}) as any)},
    onEmit: (e) => post({t: 'emit', e}),
    log: (l, x) => post({t: 'log', l, x}),
    onRender: (json) => post({t: 'render', json}),
    onError: (e) => post({t: 'error', reason: e.reason, message: e.message}),
  })
  post({t: 'ready', v: PROTOCOL, wasmMs, bootMs: sb.stats.bootMs})
}

if (typeof g.process == 'object' && g.process.versions?.node && typeof g.WorkerGlobalScope == 'undefined') {
  // worker_threads: parentPort (it holds messages until the listener is attached)
  nodeImport('node:worker_threads').then((m: any) => { port = m.parentPort; port.on('message', onMessage) })
} else {
  port = g
  g.addEventListener('message', (e: any) => onMessage(e.data))
}
