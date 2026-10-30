// Inside a Worker (a browser Worker or Node's worker_threads): one sandbox, the QuickJS side of
// createWorkerSandbox(). The worker adds what the in-thread sandbox can't have: a hard stop. The
// interrupt deadline is polled once per 10,000 ticks and never inside a builtin, so a guest
// looping on a slow builtin (JSON of a big object) overruns it by seconds to minutes
// (probes/deadline.mjs); the page's watchdog terminates the worker instead.
// No DOM here: renders go to the page as JSON; fetches go to the page too (its policy, its fetch).
import {loadQuickJS, createSandbox} from './sandbox.js'

const node = typeof process == 'object' && !!process.versions?.node
const port = node ? (await import('node:worker_threads')).parentPort : self
const post = (m) => port.postMessage(m)
const fetches = new Map()
let sb, fetchSeq = 0

const onMessage = (m) => {
  if (m.t === 'init') return init(m)
  if (m.t === 'ping') return post({t: 'pong'})
  if (m.t === 'fetched') { const f = fetches.get(m.id); fetches.delete(m.id); return f && (m.ok ? f.ok(m.res) : f.fail(new Error(m.error))) }
  if (!sb) return
  if (m.t === 'event') sb.dispatch(m.id, m.type, m.init)
  else if (m.t === 'props') sb.setProps(m.p)
  else if (m.t === 'dispose') sb.dispose()
}
node ? port.on('message', onMessage) : port.addEventListener('message', (e) => onMessage(e.data))

async function init(m) {
  const t0 = performance.now()
  const QJS = await loadQuickJS({maxWasmBytes: m.limits?.maxWasmBytes ?? 64 << 20, wasm: m.wasm})
  const wasmMs = performance.now() - t0
  sb = createSandbox(QJS, {
    kernel: m.kernel, source: m.source, props: m.props, limits: m.limits,
    capabilities: {
      // checked here (the allowlist) and again on the page, which does the request
      fetch: m.fetch && {allow: m.fetch.allow, methods: m.fetch.methods, impl: (url, init) => new Promise((ok, fail) => {
        const id = ++fetchSeq
        fetches.set(id, {ok, fail})
        post({t: 'fetch', id, url, init: {method: init.method, headers: init.headers, body: init.body}})
      }).then((r) => ({status: r.status, headers: {get: (k) => r.headers[k.toLowerCase()] ?? null}, text: async () => r.body}))},
      onEmit: (e) => post({t: 'emit', e}),
      log: (l, x) => post({t: 'log', l, x}),
    },
    onRender: (json) => post({t: 'render', json}),
    onError: (e) => post({t: 'error', reason: e.reason, message: e.message}),
  })
  post({t: 'ready', wasmMs, bootMs: sb.stats.bootMs})
}
