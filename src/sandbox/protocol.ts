/*
 * sygnal/sandbox: what the page and the guest kernel agree on (research: dev-plans/research/sandbox).
 *
 * The protocol is internal and versioned: a kernel built from another Sygnal version is refused
 * at boot ('protocol'), never half understood. It is the part a native or edge host would
 * reimplement:
 *
 *   page → guest  (QuickJS entries on the kernel's `__sandbox`):
 *     dispatch(id, type, initJson) → 1 when prevented   fire(timerId)   resolve(fetchId, ok, json)
 *     props(json)   start(exportName)   flush()          v (the protocol number)
 *   guest → page  (host functions on `__host`, each checked):
 *     render(json)  {v, tree, types, f?}: tree = [node], node = {i, t, a, s?, v?, k?, c} | {i, x} | id
 *                   (an id alone: an unchanged subtree), types = DOM event types to forward,
 *                   f = the id the guest moved focus to
 *     emit(json)    {type, data}          log(level, text)
 *     timer(id, ms) (ms < 0: setImmediate) clearTimer(id)   fetch(id, url, initJson)
 *   page ↔ worker (postMessage; `isolation: 'worker'`):
 *     → init {v, kernel, source, props, limits, fetch}  event {id, type, init}  props {p}  ping  fetched {id, ok, res|error}
 *     ← ready {v, wasmMs, bootMs}  render {json}  emit {e}  log {l, x}  fetch {id, url, init}  pong  error {reason, message}
 */
export const PROTOCOL = 1

/** Why a sandbox was killed (`SandboxError.reason`) */
export type SandboxReason = 'timeout' | 'memory' | 'cpu' | 'protocol' | 'error' | 'crash'

export class SandboxError extends Error {
  reason: SandboxReason
  constructor(reason: SandboxReason, message: string) {
    super(message)
    this.name = 'SandboxError'
    this.reason = reason
  }
}

export interface SandboxLimits {
  memoryBytes: number
  stackBytes: number
  maxWasmBytes: number
  bootMs: number
  callMs: number
  cpuShare: number
  hardMs: number
  maxTimers: number
  minTimerMs: number
  maxFetches: number
  maxMessageBytes: number
  maxLogs: number
}

// README §8: an instance per sandbox capped at 64 MB, heap 32 MB, stack 256 KB, boot 1 s, 100 ms per entry, CPU 50 %
export const DEFAULT_LIMITS: SandboxLimits = {
  memoryBytes: 32 << 20,     // QuickJS's heap (the kernel alone takes ~4 MB)
  // QuickJS's own stack check must fire before the host engine's: at 512 KB a guest recursion
  // overflows V8's native stack first, a host RangeError unwinds the WASM mid-call, and freeing
  // that runtime aborts the whole module (README §5, finding 3). 384 KB and below are caught.
  stackBytes: 256 << 10,
  // the instance's whole linear memory (heap, ArrayBuffers, C stack): setMemoryLimit() doesn't
  // count ArrayBuffer storage (README finding 1), a capped WebAssembly.Memory does
  maxWasmBytes: 64 << 20,
  bootMs: 1000,              // kernel + component + first render
  callMs: 100,               // one event, timer or fetch reply, with the flush it causes
  cpuShare: 0.5,             // guest time per rolling second
  hardMs: 1000,              // worker: the watchdog terminates a worker silent this long
  maxTimers: 64,
  minTimerMs: 4,
  maxFetches: 4,             // in flight
  maxMessageBytes: 1 << 20,
  maxLogs: 100,
}
/** above this, a guest recursion can overflow the host's stack before QuickJS's check (a crash) */
export const MAX_STACK_BYTES = 384 << 10

export function limitsOf(l?: Partial<SandboxLimits>): SandboxLimits {
  const out = {...DEFAULT_LIMITS}
  for (const k of Object.keys(l || {}) as (keyof SandboxLimits)[]) {
    if (!(k in DEFAULT_LIMITS)) continue
    const v = Number((l as any)[k])
    if (!(v > 0)) throw new TypeError(`sygnal/sandbox: limits.${k} must be a positive number`)
    out[k] = v
  }
  if (out.stackBytes > MAX_STACK_BYTES) throw new RangeError(`sygnal/sandbox: limits.stackBytes over ${MAX_STACK_BYTES} can crash the WASM module instead of throwing in the guest`)
  return out
}

export interface FetchCapability {
  /** URL prefixes ('https://api.example.com/v1/': same origin, a path under it) or RegExps on the href */
  allow: (string | RegExp)[]
  /** default ['GET'] */
  methods?: string[]
  /** resolves relative URLs */
  base?: string
  /** default: globalThis.fetch */
  impl?: (url: string, init: RequestInit) => Promise<Response>
  /** default: limits.maxMessageBytes */
  maxBodyBytes?: number
}

/** an allowlist entry is a URL prefix: same origin, path under its path */
export function allowed(u: URL, allow: (string | RegExp)[]): boolean {
  if (u.username || u.password) return false
  return allow.some((a) => {
    if (a instanceof RegExp) return a.test(u.href)
    const p = new URL(a)
    return u.origin === p.origin && u.pathname.startsWith(p.pathname)
  })
}

/**
 * The request the page makes for a guest (both tiers): the allowlist, the methods, accept /
 * content-type headers only, `credentials: 'omit'` (never the user's cookies), `redirect: 'error'`
 * (a redirect could leave the allowlist), the response size capped. Resolves with a plain
 * {status, headers, body} or rejects with the reason.
 */
export async function capFetch(f: FetchCapability | undefined, url: string, init: any, maxBytes: number, signal?: AbortSignal) {
  if (!f) throw new Error('no fetch capability')
  let u: URL
  try { u = f.base ? new URL(url, f.base) : new URL(url) } catch { throw new Error(`bad URL ${String(url).slice(0, 80)}`) }
  if (!allowed(u, f.allow || [])) throw new Error(`${u.origin}${u.pathname} is not allowed`)
  const method = String(init?.method || 'GET').toUpperCase()
  if (!(f.methods || ['GET']).map((m) => m.toUpperCase()).includes(method)) throw new Error(`method ${method} is not allowed`)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(init?.headers || {})) if (/^(accept|content-type)$/i.test(k)) headers[k] = String(v)
  const body = typeof init?.body == 'string' && method !== 'GET' && method !== 'HEAD' ? init.body : undefined
  const r = await (f.impl || globalThis.fetch)(u.href, {method, headers, body, credentials: 'omit', redirect: 'error', signal})
  const text = await r.text()
  if (text.length > (f.maxBodyBytes || maxBytes)) throw new Error('response too large')
  return {status: r.status, headers: {'content-type': r.headers.get('content-type') || ''}, body: text}
}
