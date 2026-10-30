/*
 * `isolation: 'worker'` (the default, README §9 Q7): QuickJS in a Worker (a browser Worker or
 * Node's worker_threads), for code that may be hostile. The page keeps the DOM mirror, the fetch
 * policy and the emits check; the worker runs the engine without a container (worker-entry.ts).
 * Against the in-thread tier:
 *   + a hard stop: a watchdog pings the worker and terminate()s it when it doesn't answer in
 *     `limits.hardMs` (an in-thread deadline can't stop a loop over slow builtins, finding 2);
 *   + a guest never stalls the page's main thread;
 *   - events are asynchronous: the guest's preventDefault() can't reach the DOM event (submit and
 *     link clicks are always prevented; keys the guest handles are declared up front: `preventKeys`);
 *   - one more hop per event, and a worker per sandbox.
 */
import {PROTOCOL, SandboxError, capFetch, type SandboxReason} from './protocol'
import {createMirror, bindEvents} from './mirror'
import {applyRender, type EngineOptions} from './engine'
import {nodeImport} from './quickjs'

/** What a worker looks like to the sandbox (a browser Worker or worker_threads adapted) */
export interface WorkerLike {
  postMessage(m: any): void
  terminate(): void
  addEventListener?(type: 'message', l: (e: {data: any}) => void): void
  on?(type: 'message', l: (data: any) => void): void
}

export interface WorkerEngineOptions extends EngineOptions {
  worker?: () => WorkerLike | Promise<WorkerLike>
  preventKeys?: string[]
  wasm?: ArrayBuffer | Uint8Array | WebAssembly.Module
}

const isNode = () => typeof (globalThis as any).process == 'object' && !!(globalThis as any).process.versions?.node && typeof (globalThis as any).Worker == 'undefined'

/** the worker script that ships with sygnal/sandbox: worker_threads in Node, a module Worker in a browser */
export async function defaultWorker(): Promise<WorkerLike> {
  if (isNode()) {
    const [{Worker}, {fileURLToPath}] = await Promise.all([nodeImport('node:worker_threads'), nodeImport('node:url')])
    // the CommonJS build, next to this file (a string the bundlers don't take for an asset)
    const file = fileURLToPath(import.meta.url.replace(/[^/]*$/, 'sandbox-worker.cjs.js'))
    const w = new Worker(file)
    w.unref()
    return w
  }
  // the pattern Vite and webpack bundle as a worker (with its imports: quickjs and the variant's .wasm)
  return new Worker(new URL('./sandbox-worker.esm.js', import.meta.url), {type: 'module'})
}

export function createWorkerEngine(opts: WorkerEngineOptions) {
  const limits = opts.limits
  const mirror = createMirror(opts.container!, {policy: opts.policy, focus: !!opts.focus})
  const preventKeys = new Set(opts.preventKeys || [])
  const stats = {readyMs: 0, wasmMs: 0, bootMs: 0, renders: 0}
  const queue: any[] = []
  let w: WorkerLike | null = null, dead = false
  let lastPong = performance.now() + limits.bootMs + 2000
  const t0 = performance.now()
  const post = (m: any) => { if (dead) return; w ? w.postMessage(m) : queue.push(m) }

  const events = bindEvents(mirror, (id, type, init) => {
    post({t: 'event', id, type, init})
    return /^key/.test(type) && preventKeys.has(init.key)
  }, (href) => opts.navigate?.(href))

  let resolveReady: () => void, rejectReady: (e: any) => void
  const ready = new Promise<void>((ok, fail) => { resolveReady = ok; rejectReady = fail })
  ready.catch(() => {})

  const watchdog = setInterval(() => {
    if (performance.now() - lastPong > limits.hardMs) return kill('timeout', `the worker didn't answer in ${limits.hardMs} ms; terminated`)
    if (w) w.postMessage({t: 'ping'})
  }, Math.max(25, limits.hardMs / 4))
  ;(watchdog as any).unref?.()

  async function onMessage(m: any) {
    if (dead || !m || typeof m != 'object') return
    if (m.t === 'pong') lastPong = performance.now()
    else if (m.t === 'render') {
      lastPong = performance.now()
      try { applyRender(mirror, events, String(m.json)); stats.renders++ } catch (e: any) { kill('protocol', e.message) }
    } else if (m.t === 'emit') opts.onEmit?.(m.e)
    else if (m.t === 'log') opts.log ? opts.log(String(m.l), String(m.x).slice(0, 4096)) : console.log('[sandbox]', String(m.x).slice(0, 4096))
    else if (m.t === 'ready') {
      if (m.v !== PROTOCOL) return kill('protocol', `the worker speaks protocol ${m.v}, the page ${PROTOCOL}`)
      lastPong = performance.now()
      stats.readyMs = performance.now() - t0
      stats.wasmMs = +m.wasmMs || 0
      stats.bootMs = +m.bootMs || 0
      resolveReady()
    } else if (m.t === 'error') kill(m.reason, String(m.message))
    else if (m.t === 'fetch') {
      // the page checks again: the worker's own check ran in a thread the guest shares
      let res: any
      try { res = {ok: true, res: await capFetch(opts.fetch, String(m.url), m.init || {}, limits.maxMessageBytes)} } catch (e: any) { res = {ok: false, error: String(e?.message || e)} }
      post({t: 'fetched', id: m.id, ...res})
    }
  }

  Promise.resolve()
    .then(() => (opts.worker || defaultWorker)())
    .then((worker) => {
      if (dead) return worker.terminate()
      w = worker
      if (w.on) w.on('message', onMessage)
      else w.addEventListener!('message', (e) => onMessage(e.data))
      const f = opts.fetch
      w.postMessage({
        t: 'init', v: PROTOCOL, kernel: opts.kernel, source: opts.source, exportName: opts.exportName, props: opts.props, limits, wasm: opts.wasm,
        fetch: f && {allow: f.allow, methods: f.methods, base: f.base, maxBodyBytes: f.maxBodyBytes},
      })
      for (const m of queue.splice(0)) w.postMessage(m)
    })
    .catch((e) => kill('error', `the worker didn't start: ${e?.message || e}`))

  function kill(reason: SandboxReason, message: string) {
    if (dead) return
    cleanup()
    const err = new SandboxError(reason, message)
    rejectReady(err)
    opts.onError?.(err)
  }
  function cleanup() {
    dead = true
    clearInterval(watchdog)
    w?.terminate()
    events.detach()
    mirror.clear()
  }
  return {
    stats, ready, root: mirror.root,
    get dead() { return dead },
    get violations() { return mirror.violations },
    setProps(p: any) { post({t: 'props', p: p ?? null}) },
    dispatch(id: number, type: string, init: any = {}) { post({t: 'event', id, type, init}); return undefined },
    memory() { return null },
    dispose() { if (!dead) { cleanup(); rejectReady(new SandboxError('error', 'disposed')) } },
  }
}
