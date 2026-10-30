// Numbers for README.md: sizes, cold start, per-event round trip, memory, and baselines.
//   npm run bench   (node bench.mjs [--quick])
import {readFileSync, statSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {gzipSync, brotliCompressSync} from 'node:zlib'
import {spawnSync} from 'node:child_process'
import {JSDOM} from 'jsdom'
import {newQuickJSWASMModuleFromVariant, newVariant} from 'quickjs-emscripten-core'
import releaseSync from '@jitl/quickjs-wasmfile-release-sync'
import {createSandbox} from './src/sandbox.js'
import {createWorkerSandbox, nodeWorkerSpawner} from './src/worker-sandbox.js'
import {compile} from './src/compile.js'

const here = import.meta.dirname, repo = resolve(here, '../../..')
const require = createRequire(import.meta.url)
const esbuild = createRequire(resolve(repo, 'package.json'))('esbuild')
const quick = process.argv.includes('--quick')
const kernel = readFileSync(resolve(here, 'dist/guest.js'), 'utf8')
const kb = (n) => (n / 1024).toFixed(1)
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)] }
const f = (n, d = 2) => n.toFixed(d)
const out = {}

// ---- sizes --------------------------------------------------------------------------------------
{
  const row = (name, buf) => ({name, raw: kb(buf.length), gzip: kb(gzipSync(buf, {level: 9}).length), br: kb(brotliCompressSync(buf).length)})
  const wasm = readFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))
  const ngWasm = readFileSync(require.resolve('@jitl/quickjs-ng-wasmfile-release-sync/wasm'))
  const bundle = async (entry, extra = {}) => Buffer.from((await esbuild.build({stdin: {contents: entry, resolveDir: here, loader: 'js'}, bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', logLevel: 'error', external: ['node:*'], ...extra})).outputFiles[0].contents)
  // the page side: quickjs-emscripten-core + the variant's glue (wasm excluded) + sandbox.js + mirror.js
  const host = await bundle(`export {loadQuickJS, createSandbox} from './src/sandbox.js'`)
  const coreOnly = await bundle(`export * from 'quickjs-emscripten-core'; export {default} from '@jitl/quickjs-wasmfile-release-sync'`)
  out.sizes = [row('quickjs .wasm (release-sync)', wasm), row('quickjs-ng .wasm (release-sync)', ngWasm), row('quickjs-emscripten-core + variant glue (JS)', coreOnly),
    row('page side: glue + sandbox.js + mirror.js', host), row('guest kernel: Sygnal core + sygnal/host + kernel (evaluated in QuickJS)', Buffer.from(kernel))]
  console.log('\n## sizes (KB)\n| file | raw | gzip -9 | brotli |\n|---|---:|---:|---:|')
  for (const r of out.sizes) console.log(`| ${r.name} | ${r.raw} | ${r.gzip} | ${r.br} |`)
}

// ---- cold start ---------------------------------------------------------------------------------
const COUNTER = compile(`
export default function Counter({ state }) {
  return <div className="counter"><button className="inc">+</button><span className="n">{state.count}</span></div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.select('.inc').events('click') })
Counter.model = { INC: (s) => ({ count: s.count + 1 }) }
`)
const ROWS = compile(`
import { Collection } from 'sygnal'
function Row({ state }) { return <li className={state.done ? 'row done' : 'row'}><input type="checkbox" className="t" checked={state.done} /> {state.text}</li> }
Row.intent = ({ DOM }) => ({ T: DOM.select('.t').events('click') })
Row.model = { T: (s) => ({ ...s, done: !s.done }) }
export default function List({ state }) { return <div><p className="n">{state.items.filter(i => i.done).length} done</p><ul><Collection of={Row} from="items" /></ul></div> }
List.initialState = { items: Array.from({ length: 100 }, (_, i) => ({ id: i, text: 'item ' + i, done: false })) }
`)
const page = () => new JSDOM('<!doctype html><div id="app"></div>').window
{
  const N = quick ? 5 : 20
  const wasmBytes = readFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))
  const steps = {compile: [], instantiate: [], boot: [], bootRows: [], warmBoot: []}
  let t = performance.now()
  const mod = await WebAssembly.compile(wasmBytes)
  steps.compile.push(performance.now() - t)
  for (let i = 0; i < N; i++) {
    t = performance.now(); await WebAssembly.compile(wasmBytes); steps.compile.push(performance.now() - t)
    t = performance.now()
    const QJS = await newQuickJSWASMModuleFromVariant(newVariant(releaseSync, {wasmModule: mod, wasmMemory: new WebAssembly.Memory({initial: 256, maximum: 1024})}))
    steps.instantiate.push(performance.now() - t)
    const w = page()
    const sb = createSandbox(QJS, {kernel, source: COUNTER, container: w.document.getElementById('app')})
    steps.boot.push(sb.stats.bootMs)
    const sb2 = createSandbox(QJS, {kernel, source: ROWS, container: w.document.getElementById('app')})
    steps.bootRows.push(sb2.stats.bootMs)
    const sb3 = createSandbox(QJS, {kernel, source: COUNTER, container: w.document.getElementById('app')})
    steps.warmBoot.push(sb3.stats.bootMs)
    sb.dispose(); sb2.dispose(); sb3.dispose()
  }
  // where boot goes: the kernel's evaluation vs the rest
  const QJS = await newQuickJSWASMModuleFromVariant(newVariant(releaseSync, {wasmModule: mod}))
  const evalKernel = [], ctxNew = []
  for (let i = 0; i < N; i++) {
    t = performance.now(); const rt = QJS.newRuntime(), ctx = rt.newContext(); ctxNew.push(performance.now() - t)
    const h = ctx.newObject(); for (const k of ['render', 'emit', 'log', 'timer', 'clearTimer', 'fetch']) { const fn = ctx.newFunction(k, () => {}); ctx.setProp(h, k, fn); fn.dispose() } ctx.setProp(ctx.global, '__host', h); h.dispose()
    t = performance.now(); const r = ctx.evalCode(kernel); evalKernel.push(performance.now() - t); (r.value || r.error).dispose(); ctx.dispose(); rt.dispose()
  }
  out.cold = {compile: med(steps.compile.slice(1)), firstCompile: steps.compile[0], instantiate: med(steps.instantiate), ctxNew: med(ctxNew), evalKernel: med(evalKernel), boot: med(steps.boot), bootRows: med(steps.bootRows), warmBoot: med(steps.warmBoot)}
  console.log(`\n## cold start (median of ${N}, ms)\n| step | ms |\n|---|---:|`)
  console.log(`| WebAssembly.compile of the .wasm (first / later) | ${f(out.cold.firstCompile)} / ${f(out.cold.compile)} |`)
  console.log(`| instantiate (own capped Memory, compiled module reused) | ${f(out.cold.instantiate)} |`)
  console.log(`| new runtime + context | ${f(out.cold.ctxNew)} |`)
  console.log(`| evaluate the guest kernel (156 KB) | ${f(out.cold.evalKernel)} |`)
  console.log(`| createSandbox → first render applied, counter (kernel incl.) | ${f(out.cold.boot)} |`)
  console.log(`| same, 100-row Collection | ${f(out.cold.bootRows)} |`)
  console.log(`| a second counter on the same module | ${f(out.cold.warmBoot)} |`)
}

// ---- per-event round trip -----------------------------------------------------------------------
{
  const N = quick ? 200 : 2000
  const QJS = await newQuickJSWASMModuleFromVariant(releaseSync)
  const res = {}
  for (const [name, src, sel] of [['counter', COUNTER, '.inc'], ['100 rows, toggle one', ROWS, '.t']]) {
    const w = page()
    const c = w.document.getElementById('app')
    const sb = createSandbox(QJS, {kernel, source: src, container: c, limits: {cpuShare: 1e9}})
    const els = [...c.querySelectorAll(sel)]
    const times = []
    // a macrotask every 100 clicks: the core's loop guard defers a flush after ~1000 in one task
    for (let i = 0; i < N; i++) {
      if (i % 100 == 99) await new Promise(r => setImmediate(r))
      const el = els[i % els.length]
      const t = performance.now()
      el.dispatchEvent(new w.MouseEvent('click', {bubbles: true, cancelable: true}))
      times.push(performance.now() - t)
    }
    await new Promise(r => setImmediate(r))
    res['in-thread: ' + name] = {median: med(times.slice(N / 10)), p95: p95(times.slice(N / 10)), check: c.querySelector('.n').textContent}
    sb.dispose()
  }
  // the guest side alone (no page DOM): QuickJS's share of the in-thread number
  {
    const w = page(), c = w.document.getElementById('app')
    const sb = createSandbox(QJS, {kernel, source: COUNTER, container: c, limits: {cpuShare: 1e9}})
    const id = 0
    const times = []
    const bid = [...Array(50).keys()].find(i => sb.dispatch(i, 'click') !== undefined && c.querySelector('.n').textContent !== '0')
    for (let i = 0; i < N; i++) { if (i % 100 == 99) await new Promise(r => setImmediate(r)); const t = performance.now(); sb.dispatch(bid, 'click'); times.push(performance.now() - t) }
    res['in-thread: counter, guest call only (sb.dispatch, mirror included)'] = {median: med(times.slice(N / 10)), p95: p95(times.slice(N / 10))}
    sb.dispose()
  }
  // the same guest in V8 (a node:vm context with the same bridge): what QuickJS costs per event
  res['same guest in V8 (node:vm), guest side only: counter'] = await v8Baseline(N)
  res['same guest in V8 (node:vm), guest side only: 100 rows (one row)'] = await v8Baseline(N, ROWS, 't')
  // the worker sandbox: click → render applied on the page
  const spawn = await nodeWorkerSpawner(new URL('./src/worker-entry.js', import.meta.url))
  for (const [name, src, sel] of [['worker: counter', COUNTER, '.inc'], ['worker: 100 rows', ROWS, '.t']]) {
    const w = page(), c = w.document.getElementById('app')
    let rendered, ready
    const readyP = new Promise(r => { ready = r })
    const t0 = performance.now()
    const sb = createWorkerSandbox({spawn, kernel, source: src, container: c, onReady: (s) => ready(s), onRender: () => rendered?.(), limits: {cpuShare: 1e9}})
    const st = await readyP
    while (!c.querySelector(sel)) await new Promise(r => setTimeout(r, 1))
    const firstPaint = performance.now() - t0
    const times = []
    const M = Math.min(N, 500)
    for (let i = 0; i < M; i++) {
      const els = [...c.querySelectorAll(sel)]
      const p = new Promise(r => { rendered = r })
      const t = performance.now()
      els[i % els.length].dispatchEvent(new w.MouseEvent('click', {bubbles: true, cancelable: true}))
      await p
      times.push(performance.now() - t)
    }
    res[name] = {median: med(times.slice(M / 10)), p95: p95(times.slice(M / 10)), check: c.querySelector('.n').textContent, firstPaint, readyMs: st.readyMs, wasmMs: st.wasmMs, bootMs: st.bootMs}
    sb.dispose()
  }
  // a bare worker echo: the floor of the worker hop
  {
    const {Worker} = await import('node:worker_threads')
    const w = new Worker('const {parentPort} = require("node:worker_threads"); parentPort.on("message", (m) => parentPort.postMessage(m))', {eval: true})
    const times = []
    for (let i = 0; i < 500; i++) { const t = performance.now(); await new Promise(r => { w.once('message', r); w.postMessage({i}) }); times.push(performance.now() - t) }
    res.echo = {median: med(times.slice(50)), p95: p95(times.slice(50))}
    await w.terminate()
  }
  out.rtt = res
  console.log(`\n## per event (ms; click dispatched on the page → the guest's render applied to the page DOM)\n| | median | p95 |\n|---|---:|---:|`)
  for (const [k, v] of Object.entries(res)) console.log(`| ${k} | ${f(v.median, 3)} | ${f(v.p95, 3)} |${v.check ? ' after: ' + v.check : ''}`)
  console.log(`worker cold start: ready ${f(res['worker: counter'].readyMs)} ms (instantiate ${f(res['worker: counter'].wasmMs)}, boot ${f(res['worker: counter'].bootMs)}), first paint ${f(res['worker: counter'].firstPaint)} ms`)
}

// V8 baseline: the same kernel in a node:vm context, dispatching into it like the QuickJS bridge
async function v8Baseline(N, src = COUNTER, cls = 'inc') {
  const findClass = (n, cls) => { if (typeof n != 'object' || !n) return; if ((n.a?.class || '').split(' ').includes(cls)) return n.i; for (const c of n.c || []) { const r = findClass(c, cls); if (r) return r } }
  const vm = require('node:vm')
  let tree, renders = 0
  let fire
  const ctx = vm.createContext({__host: {render: (j) => { tree = j; renders++ }, emit() {}, log() {}, timer: (id, ms) => setTimeout(() => fire(id), Math.max(0, ms)), clearTimer() {}, fetch() {}}})
  const t0 = performance.now()
  vm.runInContext(kernel, ctx)
  fire = vm.runInContext('__sandbox.fire', ctx)
  vm.runInContext(src, ctx)
  vm.runInContext('__sandbox.start("")', ctx)
  // the bridge's order: the entry, its promise jobs, then flush() (one render)
  const flush = vm.runInContext('__sandbox.flush', ctx)
  const settleJobs = () => new Promise(r => setImmediate(r))
  await settleJobs(); flush()
  const boot = performance.now() - t0
  const id = findClass(JSON.parse(tree).tree[0], cls)
  const dispatch = vm.runInContext('__sandbox.dispatch', ctx)
  const times = []
  for (let i = 0; i < N; i++) {
    if (i % 100 == 99) await settleJobs()
    const t = performance.now(), r = renders
    dispatch(id, 'click', '{}')
    for (let k = 0; k < 4; k++) await null   // the core's flush is a microtask (two hops)
    flush()
    if (renders === r) throw new Error('V8 baseline: no render')
    times.push(performance.now() - t)
  }
  return {median: med(times.slice(N / 10)), p95: p95(times.slice(N / 10)), boot, note: 'guest only, no page DOM'}
}

// ---- memory -------------------------------------------------------------------------------------
{
  const QJS = await newQuickJSWASMModuleFromVariant(releaseSync)
  const w = page()
  const sb = createSandbox(QJS, {kernel, source: ROWS, container: w.document.getElementById('app')})
  const m = sb.memory()
  out.memory = {heapUsed: m.memory_used_size, rows: true}
  sb.dispose()
  // 20 sandboxes, each its own capped instance: RSS growth per sandbox
  const mod = await WebAssembly.compile(readFileSync(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')))
  globalThis.gc?.()
  const before = process.memoryUsage().rss
  const keep = []
  for (let i = 0; i < 20; i++) {
    const Q = await newQuickJSWASMModuleFromVariant(newVariant(releaseSync, {wasmModule: mod, wasmMemory: new WebAssembly.Memory({initial: 256, maximum: 1024})}))
    keep.push(createSandbox(Q, {kernel, source: COUNTER, container: page().document.getElementById('app')}))
  }
  out.memory.rssPerInstance = (process.memoryUsage().rss - before) / 20
  const shared = await newQuickJSWASMModuleFromVariant(releaseSync)
  const before2 = process.memoryUsage().rss
  for (let i = 0; i < 20; i++) keep.push(createSandbox(shared, {kernel, source: COUNTER, container: page().document.getElementById('app')}))
  out.memory.rssPerSharedRuntime = (process.memoryUsage().rss - before2) / 20
  console.log(`\n## memory\nQuickJS heap after boot, 100-row list: ${kb(out.memory.heapUsed)} KB\nRSS per sandbox, own instance (16 MB initial linear memory): ${f(out.memory.rssPerInstance / 2 ** 20, 1)} MB\nRSS per sandbox, runtimes sharing one instance: ${f(out.memory.rssPerSharedRuntime / 2 ** 20, 1)} MB (jsdom page included in both)`)
  keep.forEach(s => s.dispose())
}

// ---- SES: lockdown() freezes the process's intrinsics, so it runs in a child process -----------
{
  const r = spawnSync(process.execPath, [resolve(here, 'probes/ses.mjs')], {encoding: 'utf8', cwd: here, timeout: 60000})
  out.ses = r.stdout.trim() || r.stderr.trim()
  console.log('\n## SES (child process)\n' + out.ses)
}
