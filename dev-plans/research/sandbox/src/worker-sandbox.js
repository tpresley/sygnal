// createWorkerSandbox(): the same sandbox with QuickJS in a Worker, for code that may be hostile
// (a marketplace widget, another tenant's component). The page keeps the DOM mirror and the
// policy; the worker runs QuickJS (worker-entry.js). What changes against the in-thread sandbox:
//   + a hard stop: a watchdog pings the worker and terminate()s it when it doesn't answer in
//     `hardMs` (a QuickJS deadline can't stop a loop over slow builtins);
//   + a guest can't stall the page's main thread at all;
//   - events are asynchronous: the guest's preventDefault() can't reach the DOM event (submit and
//     link clicks are always prevented; a key the guest wants to stop must be declared up front:
//     `preventKeys`);
//   - one more hop per event (postMessage both ways), and a worker per sandbox (its own heap).
//
//   const sb = createWorkerSandbox({
//     spawn: () => nodeWorker(new URL('./worker-entry.js', import.meta.url)),   // or webWorker(url)
//     kernel, source, container, capabilities, limits: {hardMs: 1000, maxWasmBytes: 64 << 20, ...}, onError,
//   })
import {createMirror, bindEvents} from './mirror.js'
import {allowed, SandboxError} from './sandbox.js'

export function createWorkerSandbox(opts) {
  const {kernel, source, container, capabilities: caps = {}, limits = {}, policy, props = null} = opts
  const hardMs = limits.hardMs ?? 1000
  const w = opts.spawn()
  const mirror = createMirror(container, {policy})
  const preventKeys = new Set(opts.preventKeys || [])
  const events = bindEvents(mirror, (id, type, init) => {
    w.post({t: 'event', id, type, init})
    return /^key/.test(type) && preventKeys.has(init.key)
  }, (href) => caps.navigate?.(href))
  const stats = {readyMs: 0, wasmMs: 0, bootMs: 0, renders: 0}
  let dead = false, lastPong = performance.now() + (limits.bootMs ?? 1000) + 2000
  const t0 = performance.now()

  const watchdog = setInterval(() => {
    if (performance.now() - lastPong > hardMs) return kill('timeout', `the worker didn't answer in ${hardMs} ms; terminated`)
    w.post({t: 'ping'})
  }, Math.max(25, hardMs / 4))
  watchdog.unref?.()

  w.onMessage(async (m) => {
    if (dead) return
    if (m.t === 'pong') lastPong = performance.now()
    else if (m.t === 'render') {
      try {
        const {tree, types} = JSON.parse(m.json)
        mirror.apply(tree)
        events.listen(Array.isArray(types) ? types : [])
        stats.renders++
        opts.onRender?.()
      } catch (e) { kill('protocol', e.message) }
    }
    else if (m.t === 'emit') caps.onEmit?.(m.e)
    else if (m.t === 'log') caps.log?.(m.l, m.x)
    else if (m.t === 'ready') { lastPong = performance.now(); Object.assign(stats, {readyMs: performance.now() - t0, wasmMs: m.wasmMs, bootMs: m.bootMs}); opts.onReady?.(stats) }
    else if (m.t === 'error') kill(m.reason, m.message)
    else if (m.t === 'fetch') {
      // the page checks again: the worker's own check ran in code the guest shares a thread with
      const f = caps.fetch
      let res
      try {
        const u = new URL(m.url)
        if (!f || !allowed(u, f.allow || [])) throw new Error('not allowed')
        const r = await (f.impl || fetch)(u.href, {...m.init, credentials: 'omit', redirect: 'error'})
        res = {ok: true, res: {status: r.status, headers: {'content-type': r.headers.get('content-type') || ''}, body: await r.text()}}
      } catch (e) { res = {ok: false, error: String(e.message || e)} }
      if (!dead) w.post({t: 'fetched', id: m.id, ...res})
    }
  })
  w.post({t: 'init', kernel, source, props, limits, wasm: opts.wasm, fetch: caps.fetch && {allow: (caps.fetch.allow || []).map(String), methods: caps.fetch.methods}})

  function kill(reason, message) {
    if (dead) return
    cleanup()
    opts.onError?.(new SandboxError(reason, message))
  }
  function cleanup() {
    dead = true
    clearInterval(watchdog)
    w.terminate()
    events.detach()
    mirror.clear()
  }
  return {
    stats, root: mirror.root,
    get dead() { return dead },
    get violations() { return mirror.violations },
    setProps(p) { if (!dead) w.post({t: 'props', p}) },
    dispose() { if (!dead) cleanup() },
  }
}

/** a spawn() for Node's worker_threads */
export async function nodeWorkerSpawner(url) {
  const {Worker} = await import('node:worker_threads')
  return () => {
    const w = new Worker(url)
    w.unref()
    return {post: (m) => w.postMessage(m), onMessage: (f) => w.on('message', f), terminate: () => w.terminate()}
  }
}
/** a spawn() for a browser Worker (the entry bundled: build-guest.mjs writes dist/worker.js) */
export function webWorkerSpawner(url) {
  return () => {
    const w = new Worker(url, {type: 'module'})
    return {post: (m) => w.postMessage(m), onMessage: (f) => w.addEventListener('message', (e) => f(e.data)), terminate: () => w.terminate()}
  }
}
