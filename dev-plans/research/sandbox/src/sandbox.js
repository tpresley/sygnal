// createSandbox(): one untrusted Sygnal component in its own QuickJS-in-WASM runtime, rendered
// into the real DOM by the host page.
//
//   const QJS = await loadQuickJS()                  // the WASM module (once per page; ~0.5 MB .wasm)
//   const sb = createSandbox(QJS, {
//     kernel,                                        // dist/guest.js (Sygnal core + sygnal/host + guest-kernel.js)
//     source,                                        // the component, compiled to CommonJS (compile.js)
//     container,                                     // a real element; the sandbox renders below it
//     capabilities: {
//       fetch: {allow: ['https://api.example.com/v1/'], impl: fetch},   // HTTP, host-checked
//       onEmit: (ev) => …,                           // the component's EVENTS, to the page
//       navigate: (href) => …,                       // a link click (never navigates by itself)
//     },
//     limits: {memoryBytes, stackBytes, bootMs, callMs, cpuShare, maxTimers, maxFetches, maxMessageBytes},
//     onError: (err) => …,                           // killed: err.reason ('timeout' | 'memory' | 'cpu' | 'protocol' | 'error')
//   })
//   sb.setProps({...}); sb.dispose()
//
// Isolation comes from QuickJS: the guest's globals are QuickJS's own (no window, document, fetch,
// storage, Function constructor leading out); its only way out is the `__host` functions below,
// each of which checks its arguments. Every guest entry (boot, an event, a timer, a fetch reply)
// runs under a deadline (the interrupt handler), with the runtime's memory and stack limits,
// and a CPU share over a rolling second. A guest that trips a limit is killed: there is no safe
// way to resume a context interrupted half way through a flush.
import {newQuickJSWASMModuleFromVariant, newVariant} from 'quickjs-emscripten-core'
import {createMirror, bindEvents} from './mirror.js'

let shared, compiled
/**
 * The QuickJS WASM module (release-sync variant), shared by the sandboxes of a page. `fresh: true`
 * gives a new instance with its own linear memory, from the same compiled WebAssembly.Module
 * (compiled once): what one tenant's crash can't take down for the others (see `poisoned`).
 * `wasm`: the .wasm bytes or a WebAssembly.Module (a browser fetches them; Node reads the file).
 * `maxWasmBytes`: a fresh instance whose whole linear memory (heap, ArrayBuffers, C stack) is capped.
 */
export async function loadQuickJS({fresh = false, variant, wasm, maxWasmBytes} = {}) {
  if (!fresh && shared && !maxWasmBytes) return shared
  const base = variant || (await import('@jitl/quickjs-wasmfile-release-sync')).default
  const node = typeof process == 'object' && !!process.versions?.node
  // a browser without `wasm` lets the variant fetch its .wasm itself (each instance compiles it)
  if (!compiled && (wasm || node)) compiled = wasm instanceof WebAssembly.Module ? wasm : wasm ? WebAssembly.compile(wasm) : defaultWasm().then(b => WebAssembly.compile(b))
  // the build imports its memory (default: 16 MB initial, 2 GB maximum). setMemoryLimit() caps
  // QuickJS's own heap but not ArrayBuffer storage: a guest grew the linear memory to 2 GB with
  // a 16 MB limit (probes/oom-debug.mjs). An instance's own Memory with a maximum is the hard cap.
  const custom = {}
  if (compiled) custom.wasmModule = await compiled
  if (maxWasmBytes) custom.wasmMemory = new WebAssembly.Memory({initial: 256, maximum: Math.max(256, Math.ceil(maxWasmBytes / 65536))})
  const m = await newQuickJSWASMModuleFromVariant(Object.keys(custom).length ? newVariant(base, custom) : base)
  if (!fresh && !maxWasmBytes) shared = m
  return m
}
async function defaultWasm() {
  const [{readFile}, {createRequire}] = await Promise.all([import('node:fs/promises'), import('node:module')])
  return readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))
}
/**
 * Modules a guest crashed: the host's own stack overflowed or the WASM trapped in the middle of a
 * QuickJS call, so its C state was unwound without cleanup. Every runtime on that module is
 * suspect; createSandbox refuses it (load a fresh one).
 */
export const poisoned = new WeakSet()

const DEFAULT_LIMITS = {
  memoryBytes: 32 << 20,   // the runtime's heap (the kernel alone takes ~4 MB)
  // QuickJS's own stack check must fire before the host engine's: at 512 KB a recursion overflows
  // V8's native stack first (a host RangeError mid-call, see poisoned); 384 KB and below are caught
  stackBytes: 256 << 10,
  bootMs: 1000,            // kernel + component + first render
  callMs: 100,             // one event, timer or fetch reply, with the flush it causes
  cpuShare: 0.5,           // guest time per rolling second
  maxTimers: 64,
  minTimerMs: 4,
  maxFetches: 4,           // in flight
  maxMessageBytes: 1 << 20,
  maxLogs: 100,
}

export class SandboxError extends Error {
  constructor(reason, message) { super(message); this.reason = reason }
}

export function createSandbox(QJS, opts) {
  if (poisoned.has(QJS)) throw new SandboxError('crash', 'this QuickJS module crashed earlier; load a fresh one')
  const limits = {...DEFAULT_LIMITS, ...opts.limits}
  const caps = opts.capabilities || {}
  const now = () => performance.now()
  const stats = {bootMs: 0, calls: 0, guestMs: 0, renders: 0, lastCallMs: 0}

  let deadline = Infinity
  const rt = QJS.newRuntime()
  rt.setMemoryLimit(limits.memoryBytes)
  rt.setMaxStackSize(limits.stackBytes)
  rt.setInterruptHandler(() => now() > deadline)
  const ctx = rt.newContext()

  let dead = false, logs = 0
  // renders are deltas against the previous one (unchanged subtrees are bare ids): all are applied, in order
  const renders = [], emits = []
  const timers = new Map(), fetches = new Map()
  const mirror = opts.container ? createMirror(opts.container, {policy: opts.policy}) : null
  // a DOM event: into the guest synchronously, so its preventDefault() reaches the page's event
  const events = mirror && bindEvents(mirror, (id, type, init) => enter('dispatch', [id, type, JSON.stringify(init)]), (href) => caps.navigate?.(href))

  // --- the bridge: the only functions the guest can reach -------------------------------------
  const str = (h, max = limits.maxMessageBytes) => {
    if (ctx.typeof(h) !== 'string') throw new SandboxError('protocol', 'expected a string')
    const s = ctx.getString(h)
    if (s.length > max) throw new SandboxError('protocol', `message over ${max} bytes`)
    return s
  }
  const num = (h) => { const n = ctx.getNumber(h); if (!Number.isFinite(n)) throw new SandboxError('protocol', 'expected a number'); return n }
  const host = ctx.newObject()
  const fn = (name, f) => {
    const h = ctx.newFunction(name, (...a) => {
      try { return f(...a) } catch (e) {
        // a protocol violation kills; anything else is thrown into the guest
        if (e instanceof SandboxError) queueMicrotask(() => kill(e.reason, e.message))
        return {error: ctx.newError(String(e.message || e))}
      }
    })
    ctx.setProp(host, name, h); h.dispose()
  }
  fn('render', (h) => {
    if (renders.length >= 16) throw new SandboxError('protocol', 'too many renders in one call')
    renders.push(str(h)); stats.renders++
  })
  fn('emit', (h) => {
    // delivered when the guest call returns, after its render (never into a running guest call)
    if (emits.length >= 64) throw new SandboxError('protocol', 'too many EVENTS in one call')
    emits.push(JSON.parse(str(h, 64 << 10)))
  })
  fn('log', (lv, h) => {
    if (++logs > limits.maxLogs) return
    const level = ctx.getString(lv), text = str(h, 4096)
    ;(caps.log || ((l, t) => console[l === 'error' ? 'error' : l === 'warn' ? 'warn' : 'log']('[sandbox]', t)))(level, text)
  })
  let immediates = 0
  fn('timer', (idH, msH) => {
    const id = num(idH), raw = num(msH)
    // -1: setImmediate (the core's macrotask hop), counted apart from the component's timers
    if (raw < 0) {
      if (immediates >= 16) throw new Error('sandbox: too many setImmediate')
      immediates++
      return void timers.set(id, setTimeout(() => { immediates--; timers.delete(id); enter('fire', [id]) }, 0))
    }
    const ms = Math.max(limits.minTimerMs, Math.min(raw, 2 ** 31 - 1))
    if (timers.size - immediates >= limits.maxTimers) throw new Error(`sandbox: more than ${limits.maxTimers} timers`)
    timers.set(id, setTimeout(() => { timers.delete(id); enter('fire', [id]) }, ms))
  })
  fn('clearTimer', (idH) => { const id = num(idH); clearTimeout(timers.get(id)); timers.delete(id) })
  fn('fetch', (idH, urlH, initH) => {
    const id = num(idH), url = str(urlH, 4096), init = JSON.parse(str(initH, 256 << 10))
    const f = caps.fetch
    const deny = (why) => queueMicrotask(() => enter('resolve', [id, 0, `sandbox fetch denied: ${why}`]))
    if (!f) return deny('no fetch capability')
    if (fetches.size >= limits.maxFetches) return deny('too many requests in flight')
    let u
    try { u = f.base ? new URL(url, f.base) : new URL(url) } catch { return deny(`bad URL ${url.slice(0, 80)}`) }
    if (!allowed(u, f.allow || [])) return deny(`${u.origin}${u.pathname} is not allowed`)
    const method = String(init.method || 'GET').toUpperCase()
    if (!(f.methods || ['GET']).includes(method)) return deny(`method ${method}`)
    const ac = new AbortController()
    fetches.set(id, ac)
    const headers = {}
    for (const [k, v] of Object.entries(init.headers || {})) if (/^(accept|content-type)$/i.test(k)) headers[k] = String(v)
    // credentials: 'omit' (the guest never rides the user's cookies), redirect: 'error' (a redirect could leave the allowlist)
    Promise.resolve((f.impl || fetch)(u.href, {method, headers, body: init.body, credentials: 'omit', redirect: 'error', signal: ac.signal}))
      .then(async (r) => {
        const body = await r.text()
        if (body.length > (f.maxBodyBytes || limits.maxMessageBytes)) throw new Error('response too large')
        return {status: r.status, headers: {'content-type': r.headers.get('content-type') || ''}, body}
      })
      .then((res) => { fetches.delete(id); enter('resolve', [id, 1, JSON.stringify(res)]) },
        (e) => { fetches.delete(id); if (!dead) enter('resolve', [id, 0, String(e && e.message || e)]) })
  })
  ctx.setProp(ctx.global, '__host', host); host.dispose()

  // --- entering the guest -----------------------------------------------------------------------
  let windowStart = now(), windowMs = 0
  const entries = {}
  function enter(name, args, budget = limits.callMs) {
    if (dead) return
    const f = entries[name]
    const t0 = now()
    deadline = t0 + budget
    let out
    try {
      const hs = args.map(a => typeof a == 'number' ? ctx.newNumber(a) : ctx.newString(String(a)))
      const r = ctx.callFunction(f, ctx.undefined, ...hs)
      hs.forEach(h => h.dispose())
      out = settle(r)
      // the promise jobs (the core's flush is a microtask) run under the same deadline
      const j = rt.executePendingJobs(10000)
      settle(j)
      if (rt.hasPendingJob()) throw new SandboxError('timeout', 'endless promise jobs')
    } catch (e) {
      deadline = Infinity
      return kill(e.reason || classify(e), e.message || String(e))
    }
    deadline = Infinity
    const ms = now() - t0
    stats.calls++; stats.guestMs += ms; stats.lastCallMs = ms
    if (t0 - windowStart > 1000) { windowStart = t0; windowMs = 0 }
    if ((windowMs += ms) > limits.cpuShare * 1000) return kill('cpu', `over ${limits.cpuShare * 100}% CPU`)
    flushRender()
    return out
  }
  function settle(r) {
    if (r.error) {
      const e = ctx.dump(r.error); r.error.dispose()
      const err = new Error(typeof e == 'object' && e ? `${e.name}: ${e.message}` : String(e))
      err.guest = e
      throw err
    }
    const v = ctx.typeof(r.value) === 'number' ? ctx.getNumber(r.value) : undefined
    r.value.dispose?.()
    return v
  }
  function classify(e) {
    // not the guest's own exception: the host's stack or the WASM gave out mid-call
    if (!e.guest) { poisoned.add(QJS); crashed = true; return 'crash' }
    if (/out of memory|stack overflow/i.test(e.message)) return 'memory'
    if (/interrupted/i.test(e.message)) {
      // near the memory limit every allocation collects the whole heap: that thrash ends as a timeout
      try { const h = rt.computeMemoryUsage(), m = ctx.dump(h); h.dispose(); if (m.memory_used_size > 0.9 * limits.memoryBytes) return 'memory' } catch {}
      return 'timeout'
    }
    return 'error'
  }
  let crashed = false

  function flushRender() {
    while (renders.length && !dead) {
      const json = renders.shift()
      // no container (a worker): the tree goes to whoever mirrors it
      if (!mirror) { opts.onRender?.(json); continue }
      try {
        const {tree, types} = JSON.parse(json)
        mirror.apply(tree)
        events.listen(Array.isArray(types) ? types : [])
      } catch (e) { kill('protocol', e.message) }
    }
    while (emits.length && !dead) caps.onEmit?.(emits.shift())
  }

  // --- lifecycle --------------------------------------------------------------------------------
  function kill(reason, message) {
    if (dead) return
    dead = true
    cleanup()
    opts.onError?.(new SandboxError(reason, message))
  }
  function cleanup() {
    for (const t of timers.values()) clearTimeout(t)
    for (const ac of fetches.values()) ac.abort()
    timers.clear(); fetches.clear()
    if (mirror) { events.detach(); mirror.clear() }
    // a crashed runtime is leaked: freeing it asserts (an abort that would end the whole module)
    if (crashed) return
    for (const k in entries) entries[k].alive && entries[k].dispose()
    try { ctx.dispose(); rt.dispose() } catch { poisoned.add(QJS) }
  }

  const t0 = now()
  deadline = t0 + limits.bootMs
  try {
    settle(ctx.evalCode(opts.kernel, 'guest-kernel.js'))
    const sbx = ctx.getProp(ctx.global, '__sandbox')
    // the kernel's own functions, taken before the component runs (it could replace __sandbox)
    for (const k of ['dispatch', 'fire', 'resolve', 'props', 'start']) entries[k] = ctx.getProp(sbx, k)
    sbx.dispose()
    settle(ctx.evalCode(opts.source, 'component.js'))
    deadline = Infinity
    if (opts.props !== undefined) enter('props', [JSON.stringify(opts.props)], limits.bootMs)
    enter('start', [opts.exportName || ''], Math.max(1, limits.bootMs - (now() - t0)))
  } catch (e) {
    deadline = Infinity
    kill(e.reason || classify(e), e.message)
  }
  stats.bootMs = now() - t0

  return {
    stats,
    get dead() { return dead },
    get violations() { return mirror ? mirror.violations : [] },
    root: mirror?.root,
    setProps(p) { enter('props', [JSON.stringify(p)]) },
    /** for tests and benchmarks: an event as if it came from the element with that guest id */
    dispatch(id, type, init = {}) { return enter('dispatch', [id, type, JSON.stringify(init)]) },
    memory() { if (dead) return null; const h = rt.computeMemoryUsage(); const m = ctx.dump(h); h.dispose(); return m },
    dispose() { if (!dead) { dead = true; cleanup() } },
  }
}

/** an allowlist entry is a URL prefix: same origin, path under its path ('https://api.x.com/v1/') */
export function allowed(u, allow) {
  if (u.username || u.password) return false
  return allow.some((a) => {
    if (a instanceof RegExp) return a.test(u.href)
    const p = new URL(a)
    return u.origin === p.origin && u.pathname.startsWith(p.pathname)
  })
}
