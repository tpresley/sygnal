/*
 * The QuickJS WASM module: `quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync`,
 * optional peer dependencies (D209), loaded on first use. Stock packages only (README §9 Q6):
 * a quickjs-ng variant can be passed as `variant`.
 */
import {SandboxError} from './protocol'

let compiled: Promise<WebAssembly.Module> | null = null
let shared: Promise<any> | null = null

export interface LoadQuickJSOptions {
  /** the whole linear memory of a fresh instance capped at this (heap, ArrayBuffers, C stack) */
  maxWasmBytes?: number
  /** a shared module (one per page) instead of a fresh instance: no ArrayBuffer cap, and one crash poisons it for everyone */
  shared?: boolean
  /** another variant (default '@jitl/quickjs-wasmfile-release-sync') */
  variant?: any
  /** the .wasm bytes or a compiled WebAssembly.Module (default: the variant's own file) */
  wasm?: ArrayBuffer | Uint8Array | WebAssembly.Module
}

const isNode = () => typeof (globalThis as any).process == 'object' && !!(globalThis as any).process.versions?.node && typeof (globalThis as any).window == 'undefined'

/**
 * A QuickJS module. By default a fresh instance whose own `WebAssembly.Memory` is capped at
 * `maxWasmBytes` (64 MB): QuickJS's `setMemoryLimit()` doesn't count ArrayBuffer storage, so
 * without the cap a guest can grow the instance to 2 GB (README finding 1). Instances share
 * one compiled `WebAssembly.Module` (compiled once per page).
 */
export async function loadQuickJS(opts: LoadQuickJSOptions = {}): Promise<any> {
  if (opts.shared && !opts.wasm && !opts.variant && shared) return shared
  const p = load(opts)
  if (opts.shared && !opts.wasm && !opts.variant) shared = p
  return p
}

async function load({maxWasmBytes = 64 << 20, shared: sh, variant, wasm}: LoadQuickJSOptions): Promise<any> {
  let core: any, base: any
  try {
    core = await import('quickjs-emscripten-core')
    base = variant || (await import('@jitl/quickjs-wasmfile-release-sync')).default
  } catch (e: any) {
    throw new Error("sygnal/sandbox needs quickjs-emscripten-core and @jitl/quickjs-wasmfile-release-sync (optional peer dependencies): npm install quickjs-emscripten-core @jitl/quickjs-wasmfile-release-sync (" + (e?.message || e) + ')')
  }
  const custom: any = {}
  if (wasm) custom.wasmModule = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm as any)
  else if (!variant && isNode()) custom.wasmModule = await (compiled ??= nodeWasm())
  // a browser without `wasm` lets the variant fetch its .wasm itself (the bundler emits the file)
  if (!sh) custom.wasmMemory = new WebAssembly.Memory({initial: 256, maximum: Math.max(256, Math.ceil(maxWasmBytes / 65536))})
  return core.newQuickJSWASMModuleFromVariant(Object.keys(custom).length ? core.newVariant(base, custom) : base)
}

async function nodeWasm(): Promise<WebAssembly.Module> {
  const [{readFile}, {createRequire}] = await Promise.all([nodeImport('node:fs/promises'), nodeImport('node:module')])
  // next to sygnal (a peer), else from the app's root
  let file: string
  try { file = createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm') } catch {
    file = createRequire((globalThis as any).process.cwd() + '/').resolve('@jitl/quickjs-wasmfile-release-sync/wasm')
  }
  return WebAssembly.compile(await readFile(file))
}

// Node built-ins by a name bundlers don't follow (a browser bundle never loads them)
export const nodeImport = (name: string): Promise<any> => import(/* @vite-ignore */ /* webpackIgnore: true */ name)

/**
 * Modules a guest crashed: the host's stack overflowed or the WASM trapped in the middle of a
 * QuickJS call, so its C state was unwound without cleanup. createSandbox refuses them.
 */
export const poisoned = new WeakSet<object>()
export const checkModule = (QJS: any) => {
  if (!QJS || typeof QJS.newRuntime != 'function') throw new TypeError('sygnal/sandbox: quickjs must be a module from loadQuickJS()')
  if (poisoned.has(QJS)) throw new SandboxError('crash', 'this QuickJS module crashed earlier; load a fresh one')
}
