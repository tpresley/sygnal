// 'sygnal/sandbox' (dev preview): untrusted or generated Sygnal components in QuickJS-in-WASM.
// Needs quickjs-emscripten-core and @jitl/quickjs-wasmfile-release-sync (optional peer dependencies).
// Guide: https://sygnal.js.org/advanced/sandboxed-components
import type { Widget } from 'sygnal'

/** A Standard Schema (zod, valibot, arktype, …): what `emits` takes for each event type */
export interface StandardSchemaLike<Out = unknown> {
  readonly '~standard': {
    readonly validate: (value: unknown) =>
      | { readonly value: Out; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<{ readonly message: string }> }
      | Promise<{ readonly value: Out; readonly issues?: undefined } | { readonly issues: ReadonlyArray<{ readonly message: string }> }>
    readonly types?: { readonly input: unknown; readonly output: Out }
  }
}
type SchemaOut<S> = S extends { readonly '~standard': { readonly types?: { readonly output: infer O } } } ? (unknown extends O ? unknown : O) : unknown

/** Why a sandbox was killed */
export type SandboxReason = 'timeout' | 'memory' | 'cpu' | 'protocol' | 'error' | 'crash'

/** What `onError` / `sandboxerror` gets when a sandbox is killed (it can't be resumed) */
export class SandboxError extends Error {
  readonly reason: SandboxReason
  constructor(reason: SandboxReason, message: string)
}

export interface SandboxLimits {
  /** QuickJS's heap (default 32 MB) */
  memoryBytes: number
  /** QuickJS's stack (default 256 KB; at most 384 KB: above that a recursion can crash the WASM module) */
  stackBytes: number
  /** the instance's whole linear memory, ArrayBuffers included (default 64 MB) */
  maxWasmBytes: number
  /** kernel + component + first render (default 1000 ms) */
  bootMs: number
  /** one event, timer or fetch reply with its render (default 100 ms; polled, see the guide) */
  callMs: number
  /** guest time per rolling second (default 0.5) */
  cpuShare: number
  /** worker: terminated when it doesn't answer the watchdog this long (default 1000 ms) */
  hardMs: number
  /** pending timers (default 64) */
  maxTimers: number
  /** the shortest timer (default 4 ms) */
  minTimerMs: number
  /** fetches in flight (default 4) */
  maxFetches: number
  /** one render or response (default 1 MB) */
  maxMessageBytes: number
  /** console lines (default 100) */
  maxLogs: number
}
export const DEFAULT_LIMITS: Readonly<SandboxLimits>

/** What the mirror allows (the tags and attributes are fixed; these are the knobs) */
export interface SandboxPolicy {
  /** default 5000 */
  maxNodes: number
  /** default 128 */
  maxDepth: number
  /** characters of text (default 1 MB) */
  maxText: number
  /** origins `<img src>` may load from (default none: data:image/* only) */
  imageOrigins: string[]
  /** prefix every guest class (default '': guest classes are kept, so the page's CSS styles them) */
  classPrefix: string
  /** the prefix of guest ids (default a per-sandbox 'sbxN-') */
  idPrefix?: string
}
export const DEFAULT_POLICY: Readonly<SandboxPolicy>

export interface SandboxFetch {
  /** URL prefixes (same origin, a path under it: 'https://api.example.com/v1/') or RegExps on the href */
  allow: (string | RegExp)[]
  /** default ['GET'] */
  methods?: string[]
  /** resolves relative URLs */
  base?: string
  /** default globalThis.fetch; always called with `credentials: 'omit'`, `redirect: 'error'` */
  impl?: (url: string, init: RequestInit) => Promise<Response>
  /** default limits.maxMessageBytes */
  maxBodyBytes?: number
}

export interface SandboxCapabilities {
  /** the guest's `HTTP` driver, through this allowlist (none by default) */
  fetch?: SandboxFetch
  /** an unprevented link click in the box (a link never navigates the page by itself) */
  navigate?: (href: string) => void
  /** the guest may move focus, only while focus is already inside the box (default false) */
  focus?: boolean
  /** the guest's console (default: the page's console, prefixed '[sandbox]') */
  log?: (level: string, text: string) => void
}

/** What makes the Worker for `isolation: 'worker'` (a browser Worker, or worker_threads' Worker) */
export interface SandboxWorker {
  postMessage(message: any): void
  terminate(): void
  addEventListener?(type: 'message', listener: (e: { data: any }) => void): void
  on?(type: 'message', listener: (data: any) => void): void
}

/** The event `onEmit` gets: a declared type, its data as the schema returned it */
export type SandboxEvent<E extends Record<string, StandardSchemaLike<any>>> = { [K in keyof E & string]: { type: K; data: SchemaOut<E[K]> } }[keyof E & string]

export interface SandboxOptions<E extends Record<string, StandardSchemaLike<any>> = Record<string, StandardSchemaLike<any>>> {
  /** the guest kernel: `import kernel from 'sygnal/sandbox/kernel?raw'` (sygnal/vite), or buildSandboxKernel() */
  kernel: string
  /** the component as a CommonJS module: `require('sygnal')`, JSX compiled to `__h(tag, props, ...children)` / `__frag` */
  source: string
  /** the export to run (default `default`, else the first function) */
  exportName?: string
  /** where the sandbox renders (its root div is appended). Required for 'worker' */
  container?: Element | null
  /**
   * `'worker'` (default): QuickJS in a Worker with a watchdog: for code that may be hostile.
   * `'thread'`: on the page's thread, with synchronous events (a guest `preventDefault()` works):
   * for model-written code, not hostile code (a loop over slow builtins can overrun the deadline)
   */
  isolation?: 'worker' | 'thread'
  /** the guest's EVENTS the page accepts, each with a Standard Schema; others are dropped (SYG692 in dev) */
  emits?: E
  onEmit?: (ev: SandboxEvent<E>) => void
  /** the sandbox was killed (it leaves no DOM behind) */
  onError?: (e: SandboxError) => void
  /** the guest's `PROPS` source (JSON) */
  props?: unknown
  capabilities?: SandboxCapabilities
  limits?: Partial<SandboxLimits>
  policy?: Partial<SandboxPolicy>
  /** thread: a module from loadQuickJS() (default: a fresh instance capped at limits.maxWasmBytes) */
  quickjs?: QuickJSModule
  /** worker: makes the Worker (default: the script shipped as 'sygnal/sandbox/worker') */
  worker?: () => SandboxWorker | Promise<SandboxWorker>
  /** worker: keys whose keydown the page prevents for the guest (a worker answers too late to prevent) */
  preventKeys?: string[]
  /** worker: the .wasm bytes or module, posted to the worker */
  wasm?: ArrayBuffer | Uint8Array | WebAssembly.Module
}

export interface Sandbox {
  /** resolves once the guest booted; rejects with the SandboxError that killed it */
  readonly ready: Promise<void>
  readonly dead: boolean
  /** what the sanitizer dropped (the first 100) */
  readonly violations: string[]
  readonly stats: Readonly<Record<string, number>>
  /** new data for the guest's PROPS */
  setProps(props: unknown): void
  /** removes the sandbox and its DOM */
  dispose(): void
  /** thread: QuickJS's memory use (null in a worker or once dead) */
  memory(): Record<string, number> | null
  /** an event as if from the element with that guest id (tests, benchmarks) */
  dispatch(id: number, type: string, init?: Record<string, unknown>): number | undefined
}

/** One untrusted component rendered below `container` */
export function createSandbox<const E extends Record<string, StandardSchemaLike<any>>>(options: SandboxOptions<E>): Sandbox

/** The props `<Sandboxed>` takes (plus the host props: className, style, …) */
export interface SandboxedProps<E extends Record<string, StandardSchemaLike<any>> = Record<string, StandardSchemaLike<any>>>
  extends Omit<SandboxOptions<E>, 'container' | 'props' | 'onEmit' | 'onError' | 'emits'> {
  /** required: the event types the page accepts, each with a Standard Schema (`{}` for none) */
  emits: E
  /** the guest's PROPS (JSON); a new value is sent to the guest */
  input?: unknown
}

/**
 * The sandbox as a JSX tag. Its intent reads `emit` (detail `{ type, data }`, validated) and
 * `sandboxerror` (detail `{ reason, message }`) DOM events; a new `source` replaces the sandbox.
 */
export const Sandboxed: Widget<SandboxedProps, unknown, 'emit' | 'sandboxerror'>
/** A `<Sandboxed>` tag with props preset (`kernel`, `worker`, `limits`, `capabilities`, …) */
export function sandboxed(defaults: Partial<SandboxedProps>): Widget<Partial<Omit<SandboxedProps, 'emits'>> & { emits: Record<string, StandardSchemaLike<any>> }, unknown, 'emit' | 'sandboxerror'>

/** The page's gate for a guest's EVENTS (createSandbox uses it): declared types, valid data, in order */
export function emitGate(emits: Record<string, StandardSchemaLike<any>> | undefined, deliver: (ev: { type: string; data: unknown }) => void): (ev: { type: string; data: unknown }) => void

/** A QuickJS module (quickjs-emscripten-core's QuickJSWASMModule) */
export type QuickJSModule = { newRuntime(...args: any[]): any } & Record<string, any>

export interface LoadQuickJSOptions {
  /** a fresh instance's whole linear memory capped at this (default 64 MB) */
  maxWasmBytes?: number
  /** one module shared by the page (no ArrayBuffer cap; a crash poisons it for every sandbox on it) */
  shared?: boolean
  /** another variant module (default @jitl/quickjs-wasmfile-release-sync) */
  variant?: unknown
  /** the .wasm bytes or a compiled module */
  wasm?: ArrayBuffer | Uint8Array | WebAssembly.Module
}
/** A QuickJS module: by default a fresh instance with its own capped memory (compiled once per page) */
export function loadQuickJS(options?: LoadQuickJSOptions): Promise<QuickJSModule>
/** Modules a guest crashed (createSandbox refuses them: load a fresh one) */
export const poisoned: WeakSet<object>

export interface RenderToHTMLOptions {
  kernel: string
  source: string
  exportName?: string
  props?: unknown
  limits?: Partial<SandboxLimits>
  policy?: Partial<SandboxPolicy>
  /** reuse a module (default: a fresh capped instance per call) */
  quickjs?: QuickJSModule
}
/** SSR: the component's first render as HTML, through the mirror's allowlist (on the caller's thread) */
export function renderToHTML(options: RenderToHTMLOptions): Promise<{ html: string; violations: string[]; ms: number }>
/** One render message's tree as HTML, through the allowlist */
export function treeToHTML(tree: unknown, options?: { policy?: Partial<SandboxPolicy>; prefix?: string }): { html: string; violations: string[] }
/** One element's attributes and style through the allowlist */
export function sanitize(tag: string, node: unknown, prefix: string, policy: SandboxPolicy, violate: (what: string) => void): { attrs: Map<string, string>; css: string }

/** The protocol version between the page and the kernel (internal; a kernel of another version is refused) */
export const PROTOCOL: number
