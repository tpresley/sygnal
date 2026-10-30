/*
 * The in-thread engine: one guest in its own QuickJS runtime and context. Used directly for
 * `isolation: 'thread'`, and inside the Worker for `isolation: 'worker'` (no container there:
 * renders go out as JSON).
 *
 * Isolation comes from QuickJS: the guest's globals are QuickJS's own (no window, document,
 * fetch, storage; the Function constructor reaches only the guest global). Its only way out is
 * the `__host` functions below, each of which checks its arguments. Every entry (boot, an event,
 * a timer, a fetch reply) runs under a deadline (the interrupt handler) with the runtime's
 * memory and stack limits, and a CPU share over a rolling second. A guest that trips a limit is
 * killed: there is no safe way to resume a context interrupted half way through a flush.
 *
 * The deadline stops accidents, not hostile code: QuickJS polls the interrupt handler once per
 * 10,000 ticks and never inside a builtin (README finding 2). The Worker's watchdog is the hard stop.
 */
import {PROTOCOL, SandboxError, capFetch, type SandboxLimits, type FetchCapability, type SandboxReason} from './protocol'
import {poisoned, checkModule} from './quickjs'
import {createMirror, bindEvents, type MirrorPolicy} from './mirror'

export interface EngineOptions {
  kernel: string
  source: string
  exportName?: string
  props?: any
  limits: SandboxLimits
  container?: Element | null
  policy?: Partial<MirrorPolicy>
  fetch?: FetchCapability
  focus?: boolean
  navigate?: (href: string) => void
  log?: (level: string, text: string) => void
  onEmit?: (ev: {type: string; data: any}) => void
  onRender?: (json: string) => void
  onError?: (e: SandboxError) => void
}

const ENTRIES = ['dispatch', 'fire', 'resolve', 'props', 'start', 'flush']

export function createEngine(QJS: any, opts: EngineOptions) {
  checkModule(QJS)
  const limits = opts.limits
  const now = () => performance.now()
  const stats = {bootMs: 0, calls: 0, guestMs: 0, renders: 0, lastCallMs: 0}

  let deadline = Infinity
  const rt = QJS.newRuntime()
  rt.setMemoryLimit(limits.memoryBytes)
  rt.setMaxStackSize(limits.stackBytes)
  rt.setInterruptHandler(() => now() > deadline)
  const ctx = rt.newContext()

  let dead = false, crashed = false, logs = 0, immediates = 0
  // renders are deltas against the previous one (unchanged subtrees are bare ids): all are applied, in order
  const renders: string[] = [], emits: any[] = []
  const timers = new Map<number, any>(), fetches = new Map<number, AbortController>()
  const mirror = opts.container ? createMirror(opts.container, {policy: opts.policy, focus: !!opts.focus}) : null
  // a DOM event goes into the guest synchronously, so its preventDefault() reaches the page's event
  const events = mirror && bindEvents(mirror, (id, type, init) => !!enter('dispatch', [id, type, JSON.stringify(init)]), (href) => opts.navigate?.(href))

  // --- the bridge: the only functions the guest can reach --------------------------------------
  const str = (h: any, max = limits.maxMessageBytes) => {
    if (ctx.typeof(h) !== 'string') throw new SandboxError('protocol', 'expected a string')
    const s: string = ctx.getString(h)
    if (s.length > max) throw new SandboxError('protocol', `message over ${max} bytes`)
    return s
  }
  const num = (h: any) => {
    const n = ctx.typeof(h) === 'number' ? ctx.getNumber(h) : NaN
    if (!Number.isFinite(n)) throw new SandboxError('protocol', 'expected a number')
    return n
  }
  const host = ctx.newObject()
  const fn = (name: string, f: (...a: any[]) => any) => {
    const h = ctx.newFunction(name, (...a: any[]) => {
      try { return f(...a) } catch (e: any) {
        // a protocol violation kills; anything else is thrown into the guest
        if (e instanceof SandboxError) queueMicrotask(() => kill(e.reason, e.message))
        return {error: ctx.newError(String(e?.message || e))}
      }
    })
    ctx.setProp(host, name, h)
    h.dispose()
  }
  fn('render', (h) => {
    if (renders.length >= 4) throw new SandboxError('protocol', 'too many renders in one call')
    renders.push(str(h))
    stats.renders++
  })
  fn('emit', (h) => {
    // delivered when the guest call returns, after its render (never into a running guest call)
    if (emits.length >= 64) throw new SandboxError('protocol', 'too many EVENTS in one call')
    const ev = JSON.parse(str(h, 64 << 10))
    if (!ev || typeof ev != 'object' || typeof ev.type != 'string') throw new SandboxError('protocol', 'an event needs a string type')
    emits.push(ev)
  })
  fn('log', (lv, h) => {
    if (++logs > limits.maxLogs) return
    const level = str(lv, 16), text = str(h, 4096)
    if (opts.log) opts.log(level, text)
    else console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log']('[sandbox]', text)
  })
  fn('timer', (idH, msH) => {
    const id = num(idH), raw = num(msH)
    // < 0: setImmediate (the core's macrotask hop), counted apart from the component's timers
    if (raw < 0) {
      if (immediates >= 16) throw new Error('sandbox: too many setImmediate')
      immediates++
      timers.set(id, setTimeout(() => { immediates--; timers.delete(id); enter('fire', [id]) }, 0))
      return
    }
    const ms = Math.max(limits.minTimerMs, Math.min(raw, 2 ** 31 - 1))
    if (timers.size - immediates >= limits.maxTimers) throw new Error(`sandbox: more than ${limits.maxTimers} timers`)
    timers.set(id, setTimeout(() => { timers.delete(id); enter('fire', [id]) }, ms))
  })
  fn('clearTimer', (idH) => {
    const id = num(idH)
    clearTimeout(timers.get(id))
    timers.delete(id)
  })
  fn('fetch', (idH, urlH, initH) => {
    const id = num(idH), url = str(urlH, 4096), init = JSON.parse(str(initH, 256 << 10))
    const done = (ok: boolean, payload: string) => { fetches.delete(id); if (!dead) enter('resolve', [id, ok ? 1 : 0, payload]) }
    if (fetches.size >= limits.maxFetches) return void queueMicrotask(() => done(false, 'sandbox fetch denied: too many requests in flight'))
    const ac = new AbortController()
    fetches.set(id, ac)
    capFetch(opts.fetch, url, init, limits.maxMessageBytes, ac.signal)
      .then((res) => done(true, JSON.stringify(res)), (e) => done(false, `sandbox fetch denied: ${String(e?.message || e)}`))
  })
  ctx.setProp(ctx.global, '__host', host)
  host.dispose()

  // --- entering the guest -----------------------------------------------------------------------
  let windowStart = now(), windowMs = 0
  const entries: Record<string, any> = {}
  function enter(name: string, args: (string | number)[], budget = limits.callMs): number | undefined {
    if (dead) return
    const t0 = now()
    deadline = t0 + budget
    let out: number | undefined
    try {
      const hs = args.map((a) => (typeof a == 'number' ? ctx.newNumber(a) : ctx.newString(String(a))))
      const r = ctx.callFunction(entries[name], ctx.undefined, ...hs)
      hs.forEach((h) => h.dispose())
      out = settle(r)
      // the promise jobs (the core's flush is a microtask) run under the same deadline
      settle(rt.executePendingJobs(10000))
      if (rt.hasPendingJob()) throw new SandboxError('timeout', 'endless promise jobs')
      // then the tree, once
      settle(ctx.callFunction(entries.flush, ctx.undefined))
    } catch (e: any) {
      deadline = Infinity
      kill(e.reason || classify(e), e.message || String(e))
      return
    }
    deadline = Infinity
    const ms = now() - t0
    stats.calls++; stats.guestMs += ms; stats.lastCallMs = ms
    if (t0 - windowStart > 1000) { windowStart = t0; windowMs = 0 }
    if ((windowMs += ms) > limits.cpuShare * 1000) { kill('cpu', `over ${limits.cpuShare * 100}% CPU`); return }
    deliver()
    return out
  }
  function settle(r: any): number | undefined {
    if (r.error) {
      const e = ctx.dump(r.error)
      r.error.dispose()
      const err: any = new Error(typeof e == 'object' && e ? `${e.name}: ${e.message}` : String(e))
      err.guest = true
      throw err
    }
    const v = ctx.typeof(r.value) === 'number' ? ctx.getNumber(r.value) : undefined
    r.value.dispose?.()
    return v
  }
  function classify(e: any): SandboxReason {
    // not the guest's own exception: the host's stack or the WASM gave out mid-call (finding 3)
    if (!e.guest) { poisoned.add(QJS); crashed = true; return 'crash' }
    if (/out of memory|stack overflow/i.test(e.message)) return 'memory'
    if (/interrupted/i.test(e.message)) {
      // near the memory limit every allocation collects the whole heap: that thrash ends as a timeout
      try { const h = rt.computeMemoryUsage(), m = ctx.dump(h); h.dispose(); if (m.memory_used_size > 0.9 * limits.memoryBytes) return 'memory' } catch {}
      return 'timeout'
    }
    return 'error'
  }

  function deliver() {
    while (renders.length && !dead) {
      const json = renders.shift()!
      if (!mirror) { opts.onRender?.(json); continue }
      try { applyRender(mirror, events!, json) } catch (e: any) { kill('protocol', e.message) }
    }
    while (emits.length && !dead) opts.onEmit?.(emits.shift())
  }

  // --- lifecycle --------------------------------------------------------------------------------
  function kill(reason: SandboxReason, message: string) {
    if (dead) return
    dead = true
    cleanup()
    opts.onError?.(new SandboxError(reason, message))
  }
  function cleanup() {
    for (const t of timers.values()) clearTimeout(t)
    for (const ac of fetches.values()) ac.abort()
    timers.clear(); fetches.clear()
    if (mirror) { events!.detach(); mirror.clear() }
    // a crashed runtime is leaked: freeing it asserts (an abort that would end the whole module)
    if (crashed) return
    for (const k in entries) entries[k]?.alive && entries[k].dispose()
    try { ctx.dispose(); rt.dispose() } catch { poisoned.add(QJS) }
  }

  const t0 = now()
  deadline = t0 + limits.bootMs
  try {
    settle(ctx.evalCode(opts.kernel, 'sygnal-sandbox-kernel.js'))
    const sbx = ctx.getProp(ctx.global, '__sandbox')
    const v = ctx.typeof(sbx) === 'object' ? ctx.getProp(sbx, 'v') : null
    const version = v && ctx.typeof(v) === 'number' ? ctx.getNumber(v) : 0
    v?.dispose()
    if (version !== PROTOCOL) {
      sbx.dispose()
      throw new SandboxError('protocol', version
        ? `the kernel speaks protocol ${version}, this sygnal/sandbox ${PROTOCOL}: rebuild it from the installed sygnal`
        : 'not a sandbox kernel: import it from sygnal/sandbox/kernel?raw through sygnal/vite, or build it with buildSandboxKernel()')
    }
    // the kernel's own functions, taken before the component runs (it could replace __sandbox)
    for (const k of ENTRIES) entries[k] = ctx.getProp(sbx, k)
    sbx.dispose()
    settle(ctx.evalCode(opts.source, 'component.js'))
    deadline = Infinity
    if (opts.props !== undefined) enter('props', [JSON.stringify(opts.props)], limits.bootMs)
    enter('start', [opts.exportName || ''], Math.max(1, limits.bootMs - (now() - t0)))
  } catch (e: any) {
    deadline = Infinity
    kill(e.reason || classify(e), e.message)
  }
  stats.bootMs = now() - t0

  return {
    stats,
    get dead() { return dead },
    get violations() { return mirror ? mirror.violations : [] },
    root: mirror ? mirror.root : null,
    setProps(p: any) { enter('props', [JSON.stringify(p ?? null)]) },
    /** an event as if it came from the element with that guest id (tests, benchmarks, the worker) */
    dispatch(id: number, type: string, init: any = {}) { return enter('dispatch', [id, type, JSON.stringify(init)]) },
    memory() {
      if (dead) return null
      const h = rt.computeMemoryUsage(), m = ctx.dump(h)
      h.dispose()
      return m
    },
    dispose() { if (!dead) { dead = true; cleanup() } },
  }
}
export type Engine = ReturnType<typeof createEngine>

/** one render message onto a mirror (both tiers); throws on a malformed one */
export function applyRender(mirror: ReturnType<typeof createMirror>, events: ReturnType<typeof bindEvents>, json: string) {
  const msg = JSON.parse(json)
  if (!msg || typeof msg != 'object' || msg.v !== PROTOCOL) throw new Error('sandbox render: wrong protocol')
  mirror.apply(msg.tree)
  events.listen(Array.isArray(msg.types) ? msg.types.map(String) : [])
  if (typeof msg.f == 'number') mirror.focus(msg.f)
}
