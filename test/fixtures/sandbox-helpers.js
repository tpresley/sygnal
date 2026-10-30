// Shared by test/sandbox-*.test.js: the guest kernel (built once per file from the repo's dist/,
// as an app's install would be: `npm run build` first), a JSX → CommonJS compile step for guest
// code, and a sandbox mounted in the test's jsdom document.
import path from 'node:path'
import fs from 'node:fs'
import ts from 'typescript'
import { buildSandboxKernel } from '../../src/sandbox/build.ts'
import { createSandbox } from '../../src/sandbox.ts'

export const root = path.resolve(__dirname, '../..')
// Rollup, not esbuild (it refuses to run under jsdom), unminified (terser's worker can't start
// there either). Cached by the dist files' mtimes: one build for every test file of a run
const inputs = ['index.esm.js', 'host.esm.js', 'sandbox-kernel.esm.js'].map((f) => fs.statSync(path.join(root, 'dist', f)).mtimeMs).join('-')
const cache = path.join(root, 'node_modules/.cache/sygnal-sandbox-kernel', inputs.replace(/\./g, '_') + '.js')
export const kernel = fs.existsSync(cache) ? fs.readFileSync(cache, 'utf8') : await buildSandboxKernel({ root, bundler: 'rollup', minify: false })
if (!fs.existsSync(cache)) { fs.mkdirSync(path.dirname(cache), { recursive: true }); fs.writeFileSync(cache + '.tmp' + process.pid, kernel); fs.renameSync(cache + '.tmp' + process.pid, cache) }
export const workerFile = path.join(root, 'dist/sandbox-worker.cjs.js')
export const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms))
export const until = async (f, ms = 4000) => {
  const t0 = Date.now()
  while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await settle(2) }
}

/** the host's compile step for guest code: JSX → __h / __frag, ESM → CommonJS */
export const compile = (code) => ts.transpileModule(code, {
  fileName: 'guest.jsx',
  compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: '__h', jsxFragmentFactory: '__frag', module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, allowJs: true },
}).outputText

/** a Standard Schema without a library: `check(v)` returns an error message or nothing */
export const schema = (check = () => undefined, map = (v) => v) => ({
  '~standard': { version: 1, vendor: 'test', validate: (v) => { const m = check(v); return m ? { issues: [{ message: m }] } : { value: map(v) } } },
})
export const any = schema()

/** a worker_threads spawn of the shipped worker script (dist/) */
export async function nodeWorker() {
  const { Worker } = await import('node:worker_threads')
  const w = new Worker(workerFile)
  w.unref()
  return w
}

/** a sandbox in a fresh container of the jsdom document; returns the handles a test reads */
export function mount(code, opts = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const errors = [], emits = [], logs = []
  const sb = createSandbox({
    kernel, source: opts.raw ? code : compile(code), container, isolation: 'thread', emits: { COUNT: any, X: any, PICKED: any, ANSWER: any }, ...opts,
    capabilities: { log: (l, t) => logs.push([l, t]), ...opts.capabilities },
    onEmit: (e) => emits.push(e),
    onError: (e) => errors.push(e),
  })
  const $ = (sel) => container.querySelector(sel)
  const fire = (sel, type, init = {}) => {
    const el = typeof sel == 'string' ? $(sel) : sel
    const E = /^key/.test(type) ? KeyboardEvent : /click|mouse|pointer/.test(type) ? MouseEvent : Event
    const e = new E(type, { bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(e)
    return e
  }
  return { sb, container, $, fire, errors, emits, logs, ready: () => sb.ready.catch(() => {}) }
}
