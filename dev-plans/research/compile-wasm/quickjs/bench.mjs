// Sygnal headless (model + intent, no DOM) and SSR in V8 vs in QuickJS compiled to WASM
// (quickjs-emscripten, the sandbox an untrusted or generated component could run in).
//   node dev-plans/research/compile-wasm/quickjs/bench.mjs <dir with node_modules/quickjs-emscripten>
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const here = import.meta.dirname, repo = resolve(here, '../../../..')
const esbuild = createRequire(resolve(repo, 'package.json'))('esbuild')
const tools = process.argv[2]
const { getQuickJS } = await import(pathToFileURL(createRequire(resolve(tools, 'package.json')).resolve('quickjs-emscripten')).href)

const built = await esbuild.build({ entryPoints: [resolve(here, 'headless-entry.js')], bundle: true, write: false, format: 'iife', globalName: 'Sygnal', minify: true, platform: 'neutral', mainFields: ['module', 'main'], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, absWorkingDir: repo, nodePaths: [resolve(repo, 'node_modules')] })
// xstream's globalthis shim looks for `global` when there is no window
const bundle = 'var global = globalThis;' + built.outputFiles[0].text
const workload = readFileSync(resolve(here, 'workload.js'), 'utf8')
console.log(`guest bundle: ${(bundle.length / 1024).toFixed(1)} KB min`)

// V8: a fresh vm context (no DOM, no Node globals but the ones given)
{
  const t0 = performance.now()
  const ctx = vm.createContext({ __now: () => performance.now(), console, queueMicrotask, setTimeout })
  vm.runInContext(bundle, ctx)
  const load = performance.now() - t0
  const r = JSON.parse(vm.runInContext(workload, ctx))
  console.log('V8 (node vm context)  ', JSON.stringify({ loadMs: +load.toFixed(2), ...r }))
}
// QuickJS in WASM
{
  let t0 = performance.now()
  const QuickJS = await getQuickJS()
  const wasmInit = performance.now() - t0
  t0 = performance.now()
  const rt = QuickJS.newRuntime(), q = rt.newContext()
  const now = q.newFunction('__now', () => q.newNumber(performance.now()))
  q.setProp(q.global, '__now', now); now.dispose()
  const logFn = q.newFunction('log', (...a) => { console.log('[guest]', ...a.map(x => q.dump(x))) })
  const con = q.newObject(); q.setProp(con, 'log', logFn); q.setProp(con, 'error', logFn); q.setProp(con, 'warn', logFn); q.setProp(q.global, 'console', con); con.dispose(); logFn.dispose()
  const ev = (code) => { const r = q.evalCode(code); if (r.error) { const e = q.dump(r.error); r.error.dispose(); throw new Error(JSON.stringify(e)) } const v = q.dump(r.value); r.value.dispose(); return v }
  // no timers in a bare QuickJS context: xstream's deferred stop() runs as a job instead
  ev('globalThis.setTimeout = (f) => (Promise.resolve().then(f), 0); globalThis.clearTimeout = () => {}')
  ev(bundle)
  const load = performance.now() - t0
  const r = JSON.parse(ev(workload))
  rt.executePendingJobs()
  console.log('QuickJS (WASM)        ', JSON.stringify({ wasmInitMs: +wasmInit.toFixed(2), loadMs: +load.toFixed(2), ...r }))
  q.dispose(); rt.dispose()
}
