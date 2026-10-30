/*
 * createSandbox(): one untrusted Sygnal component, rendered into the page's real DOM, behind one
 * API for both tiers (README §8, §9 Q7):
 *
 *   isolation: 'worker' (default)  QuickJS in a Worker with a watchdog: for code that may be
 *                                  hostile (plugins, a marketplace, other tenants)
 *   isolation: 'thread'            QuickJS on the page's thread with a capped instance: for
 *                                  model-written code (accidents, prompt injection), not hostile
 *                                  code: synchronous events (preventDefault works), but a loop over
 *                                  slow builtins can overrun the deadline by seconds
 *
 * The guest's EVENTS reach `onEmit` only when their type is declared in `emits` and the data
 * passes that type's Standard Schema (README §9 Q3); anything else is dropped (SYG692 in dev).
 */
import {SandboxError, limitsOf, type SandboxLimits, type FetchCapability} from './protocol'
import {loadQuickJS} from './quickjs'
import {createEngine, type Engine} from './engine'
import {createWorkerEngine, type WorkerLike} from './worker'
import type {MirrorPolicy} from './mirror'

export interface SandboxCapabilities {
  /** HTTP for the guest's `HTTP` driver: an allowlist the page enforces */
  fetch?: FetchCapability
  /** an unprevented link click in the box (it never navigates by itself) */
  navigate?: (href: string) => void
  /** the guest may move focus, only while focus is already inside the box (default false) */
  focus?: boolean
  /** the guest's console (default: the page's console, prefixed) */
  log?: (level: string, text: string) => void
}

export interface SandboxOptions {
  /** the guest kernel: `import kernel from 'sygnal/sandbox/kernel?raw'` (sygnal/vite) or buildSandboxKernel() */
  kernel: string
  /** the component as a CommonJS module (`require('sygnal')`, JSX compiled to `__h` / `__frag`) */
  source: string
  /** the export to run (default: `default`, else the first function) */
  exportName?: string
  /** the element the sandbox renders below (its own root div is appended) */
  container: Element
  isolation?: 'worker' | 'thread'
  /** the EVENTS types the page accepts, each with a Standard Schema for its data */
  emits?: Record<string, StandardSchemaLike>
  onEmit?: (ev: {type: string; data: any}) => void
  /** an event the page dropped (not declared, invalid data, a schema that threw): what a repair loop hears */
  onReject?: (r: SandboxReject) => void
  onError?: (e: SandboxError) => void
  /** the guest's `PROPS` source (JSON) */
  props?: any
  capabilities?: SandboxCapabilities
  limits?: Partial<SandboxLimits>
  policy?: Partial<MirrorPolicy>
  /** thread: a module from loadQuickJS() (default: a fresh instance capped at limits.maxWasmBytes) */
  quickjs?: any
  /** worker: makes the Worker (default: the worker script shipped with sygnal/sandbox) */
  worker?: () => WorkerLike | Promise<WorkerLike>
  /** worker: keys whose keydown the page prevents for the guest (events reach a worker too late to prevent) */
  preventKeys?: string[]
  /** worker: the .wasm bytes or module, posted to the worker */
  wasm?: ArrayBuffer | Uint8Array | WebAssembly.Module
}

/** an event the page dropped: `undeclared` (no such type in emits), `invalid` (its schema's issues), `threw`, or `none` (no emits) */
export interface SandboxReject {
  type: string
  reason: 'undeclared' | 'invalid' | 'threw' | 'none'
  issues: Array<{path: Array<string | number>; message: string}>
  declared: string[]
}

export interface StandardSchemaLike {
  '~standard': {validate: (value: unknown) => {value?: unknown; issues?: ReadonlyArray<{message: string}>} | Promise<any>}
}

export interface Sandbox {
  /** resolves when the guest booted (rejects with the SandboxError that killed it) */
  readonly ready: Promise<void>
  readonly dead: boolean
  /** what the sanitizer dropped (tags, attributes, URLs, styles; the first 100) */
  readonly violations: string[]
  readonly stats: Record<string, number>
  setProps(props: any): void
  dispose(): void
  /** thread: the guest's QuickJS heap use (null in a worker, or once dead) */
  memory(): any
  /** an event as if from the element with that guest id (tests, benchmarks) */
  dispatch(id: number, type: string, init?: any): number | undefined
}

const diag = (code: string, message: string, fix: string, data?: any) => {
  try { (globalThis as any).__SYGNAL_DIAGNOSTICS__?.report?.(code, {message, fix, severity: 'warn', data}) } catch (e) { setTimeout(() => { throw e }) }
}

/** the page's gate for the guest's EVENTS: declared types only, data through the type's schema, in order */
export function emitGate(emits: Record<string, StandardSchemaLike> | undefined, deliver: (ev: {type: string; data: any}) => void, reject?: (r: SandboxReject) => void) {
  let chain: Promise<void> | null = null, warnedNone = false
  const declared = emits ? Object.keys(emits) : []
  const drop = (type: string, reason: SandboxReject['reason'], why: string, issues?: any) => {
    diag('SYG692', `sygnal/sandbox: dropped the guest's '${type}' event: ${why}`,
      "Declare each event type the page accepts in emits, with a Standard Schema for its data: emits={{ ANSWER: schema }}", issues)
    reject?.({type, reason, declared, issues: Array.isArray(issues)
      ? issues.map((i: any) => ({path: (i?.path || []).map((p: any) => (p && typeof p == 'object' ? p.key : p)), message: String(i?.message ?? i)}))
      : []})
  }
  const check = (ev: {type: string; data: any}): {type: string; data: any} | null | Promise<{type: string; data: any} | null> => {
    if (!emits) {
      if (!warnedNone) { warnedNone = true; drop(ev.type, 'none', 'no emits declared') }
      return null
    }
    const schema = Object.prototype.hasOwnProperty.call(emits, ev.type) ? emits[ev.type] : undefined
    if (!schema) { drop(ev.type, 'undeclared', 'not declared in emits'); return null }
    const done = (r: any) => {
      if (r && r.issues) { drop(ev.type, 'invalid', 'invalid data: ' + r.issues.map((i: any) => i.message).join('; '), r.issues); return null }
      return {type: ev.type, data: r ? r.value : undefined}
    }
    try {
      const r = schema['~standard'].validate(ev.data)
      return r && typeof (r as any).then == 'function' ? (r as Promise<any>).then(done, (e) => { drop(ev.type, 'threw', 'its schema threw: ' + (e?.message || e)); return null }) : done(r)
    } catch (e: any) { drop(ev.type, 'threw', 'its schema threw: ' + (e?.message || e)); return null }
  }
  return (ev: {type: string; data: any}) => {
    if (!ev || typeof ev.type != 'string') return
    const r = check(ev)
    if (!chain && !(r && typeof (r as any).then == 'function')) { if (r) deliver(r as any); return }
    // an async schema: keep the guest's order
    const prev = chain || Promise.resolve()
    const next: Promise<void> = prev.then(() => r).then((x: any) => { if (x) deliver(x) })
    chain = next
    next.then(() => { if (chain === next) chain = null })
  }
}

export function createSandbox(opts: SandboxOptions): Sandbox {
  if (!opts || typeof opts.kernel != 'string' || !opts.kernel) throw new TypeError("sygnal/sandbox: `kernel` is required (import kernel from 'sygnal/sandbox/kernel?raw' with sygnal/vite, or buildSandboxKernel())")
  if (typeof opts.source != 'string') throw new TypeError('sygnal/sandbox: `source` must be the component compiled to a CommonJS string')
  const isolation = opts.isolation ?? 'worker'
  if (isolation !== 'worker' && isolation !== 'thread') throw new TypeError(`sygnal/sandbox: isolation must be 'worker' or 'thread', got ${JSON.stringify(isolation)}`)
  const limits = limitsOf(opts.limits)
  if (!opts.container || typeof (opts.container as any).appendChild != 'function') throw new TypeError('sygnal/sandbox: `container` must be an element (renderToHTML renders without one)')
  const caps = opts.capabilities || {}
  const gate = emitGate(opts.emits, (ev) => opts.onEmit?.(ev), opts.onReject && ((r) => opts.onReject!(r)))
  let dead = false, failure: SandboxError | null = null
  const onError = (e: SandboxError) => {
    if (dead) return
    dead = true
    failure = e
    opts.onError?.(e)
  }
  const common = {
    kernel: opts.kernel, source: opts.source, exportName: opts.exportName, props: opts.props, limits,
    container: opts.container, policy: opts.policy, fetch: caps.fetch, focus: !!caps.focus, navigate: caps.navigate, log: caps.log,
    onEmit: gate, onError,
  }

  if (isolation === 'worker') {
    const w = createWorkerEngine({...common, worker: opts.worker, preventKeys: opts.preventKeys, wasm: opts.wasm})
    return w as unknown as Sandbox
  }

  // thread: an engine now (a module given) or once a fresh capped instance is loaded
  let e: Engine | null = null, props = opts.props, disposed = false
  const boot = (QJS: any) => {
    if (disposed) return
    e = createEngine(QJS, {...common, props})
    if (failure) throw failure
  }
  let ready: Promise<void>
  try {
    ready = opts.quickjs ? (boot(opts.quickjs), Promise.resolve()) : loadQuickJS({maxWasmBytes: limits.maxWasmBytes}).then(boot)
  } catch (err) { ready = Promise.reject(err) }
  ready = ready.catch((err) => {
    const se = err instanceof SandboxError ? err : new SandboxError('error', String(err?.message || err))
    onError(se)
    throw failure || se
  })
  ready.catch(() => {})
  return {
    ready,
    get dead() { return dead || disposed || !!e?.dead },
    get violations() { return e ? e.violations : [] },
    get stats() { return e ? e.stats : {} },
    setProps(p: any) { if (e) e.setProps(p); else props = p },
    dispose() { disposed = true; e?.dispose() },
    memory() { return e ? e.memory() : null },
    dispatch(id: number, type: string, init?: any) { return e ? e.dispatch(id, type, init) : undefined },
  }
}
