// Instrumented counts behind the audit's root causes (findings 1, 2, 4), on an unminified build
// with counters injected at build time:
//   - DOM patches: the DOM driver's `.fold(patch, ...)` in sygnal's dist is wrapped
//   - xstream streams: xstream's Stream constructor is wrapped
//   - setTimeout / setInterval calls: wrapped in the page (init script)
//   - retained ScopeCheckers: CDP heap snapshots before and after mount/unmount cycles
//   node instrument.mjs [--no-build | --build-only] [--only=patches,streams,retention] [--out=results/instrument.json]
import { build } from 'vite'
import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import sygnal from 'sygnal/vite'
import { serve } from './lib/server.mjs'
import { HELPERS } from './lib/ops.mjs'

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const ONLY = arg('only', 'patches,streams,retention').split(',')
const OUT = arg('out', 'results/instrument.json')
const root = resolve(import.meta.dirname)
const outDir = resolve(root, 'dist-instr')
const PAGES = ['table', 'table-coll', 'counters', 'deep', 'input']

const counters = {
  name: 'perf-counters',
  enforce: 'pre',
  transform(code, id) {
    if (/sygnal\/dist\/index\.esm\.js$|\/dist\/index\.esm\.js$/.test(id) && code.includes('.fold(patch, ')) {
      return code.replace('.fold(patch, ', '.fold((a, b) => (globalThis.__perf && globalThis.__perf.patches++, patch(a, b)), ')
    }
    if (/node_modules\/xstream\/index\.js$/.test(id)) {
      return code.replace('function Stream(producer) {', 'function Stream(producer) { globalThis.__perf && globalThis.__perf.streams++;')
    }
  },
}

if (!process.argv.includes('--no-build')) {
  await build({
    root, configFile: false, logLevel: 'warn', mode: 'production', base: './',
    plugins: [counters, sygnal()],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: resolve(outDir, 'sygnal'), emptyOutDir: true, minify: false, rollupOptions: { input: Object.fromEntries(PAGES.map(s => [s, resolve(root, 'apps/sygnal', `${s}.html`)])) } },
  })
  console.log('built dist-instr/sygnal')
}
if (process.argv.includes('--build-only')) process.exit(0)

const COUNT = `
window.__perf = { patches: 0, streams: 0, timeouts: 0, intervals: 0 };
(() => {
  const st = window.setTimeout, si = window.setInterval
  window.setTimeout = function (...a) { window.__perf.timeouts++; return st.apply(this, a) }
  window.setInterval = function (...a) { window.__perf.intervals++; return si.apply(this, a) }
})();
`

const server = await serve(outDir)
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })

async function open(page) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('pageerror', e.message))
  await p.addInitScript(COUNT + HELPERS)
  await p.goto(`${server.url}/sygnal/apps/sygnal/${page}.html`)
  await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
  const cdp = await ctx.newCDPSession(p)
  const run = (code) => p.evaluate(`(async () => { const h = window.__h; ${code} })()`)
  return { p, ctx, cdp, run }
}
const reset = `Object.keys(window.__perf).forEach(k => window.__perf[k] = 0)`
const read = `return { ...window.__perf }`

// counts after `act` once `done` holds, plus a trailing window for deferred work
async function counted(page, setup, act, done, trail = 500) {
  const { ctx, run } = await open(page)
  await run(setup)
  await run(`await h.settle(300); ${reset}`)
  const r = await run(`${act}; await h.waitFor(() => ${done}); await h.settle(${trail}); ${read}`)
  await ctx.close()
  return r
}

async function scopeCheckers(cdp) {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  let chunks = ''
  const onChunk = (e) => { chunks += e.chunk }
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
  const snap = JSON.parse(chunks)
  const f = snap.snapshot.meta.node_fields, nf = f.length
  const ti = f.indexOf('type'), ni = f.indexOf('name')
  const types = snap.snapshot.meta.node_types[0]
  const counts = {}
  const WANT = new Set(['ScopeChecker', 'ElementFinder', 'Component', 'Stream', 'MemoryStream'])
  for (let i = 0; i < snap.nodes.length; i += nf) {
    if (types[snap.nodes[i + ti]] !== 'object') continue
    const name = snap.strings[snap.nodes[i + ni]]
    if (WANT.has(name)) counts[name] = (counts[name] || 0) + 1
  }
  return counts
}

const rows1k = `h.click('#run'); await h.waitFor(() => h.n('.row') === 1000)`
const out = { date: new Date().toISOString(), chromium: browser.version() }

if (ONLY.includes('patches')) {
  out.patches = {
    'select row (1k Collection)': await counted('table-coll', rows1k, `h.click('.row:nth-child(2) .lbl')`, `h.q('.row:nth-child(2)').classList.contains('danger')`),
    'update every 10th (1k Collection)': await counted('table-coll', rows1k, `h.click('#update')`, `h.text('.row .lbl').endsWith('!!!')`),
    'select row (1k single component)': await counted('table', rows1k, `h.click('.row:nth-child(2) .lbl')`, `h.q('.row:nth-child(2)').classList.contains('danger')`),
    'update 1 of 1k counters': await counted('counters', `h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000)`, `h.click('.counter:nth-child(500) .inc')`, `h.text('.counter:nth-child(500) .val') === '1'`),
    'leaf click, 30 deep': await counted('deep', `await h.waitFor(() => h.q('.leaf'))`, `h.click('.leaf .inc')`, `h.text('.leaf .val') === '1'`),
    'keystroke (1k list)': await counted('input', `await h.waitFor(() => h.q('.draft'))`, `h.type('.draft', 'a')`, `h.text('.echo') === h.q('.draft').value`),
  }
  for (const [k, v] of Object.entries(out.patches)) console.log(`patches  ${k.padEnd(36)} ${v.patches}  (streams ${v.streams}, setTimeout ${v.timeouts}, setInterval ${v.intervals})`)
}

if (ONLY.includes('streams')) {
  out.mount = {
    'mount 1k counters': await counted('counters', '', `h.click('#create')`, `h.n('.counter') === 1000`, 1000),
    'unmount 1k counters': await counted('counters', `h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000)`, `h.click('#destroy')`, `h.n('.counter') === 0`, 1500),
    'create 1k Collection rows': await counted('table-coll', '', `h.click('#run')`, `h.n('.row') === 1000`, 1000),
    'clear 1k Collection rows': await counted('table-coll', rows1k, `h.click('#clear')`, `h.n('.row') === 0`, 1500),
  }
  for (const [k, v] of Object.entries(out.mount)) console.log(`mount    ${k.padEnd(36)} streams ${v.streams} (${(v.streams / 1000).toFixed(1)}/item), setTimeout ${v.timeouts}, setInterval ${v.intervals}, patches ${v.patches}`)
}

if (ONLY.includes('retention')) {
  out.retention = {}
  for (const [label, page, mount, unmount, sel] of [
    ['counters 5x mount/unmount 1k', 'counters', '#create', '#destroy', '.counter'],
    ['Collection table 5x create/clear 1k', 'table-coll', '#run', '#clear', '.row'],
  ]) {
    const { ctx, cdp, run } = await open(page)
    await run('await h.settle(300)')
    const before = await scopeCheckers(cdp)
    for (let i = 0; i < 5; i++) await run(`h.click('${mount}'); await h.waitFor(() => h.n('${sel}') === 1000); h.click('${unmount}'); await h.waitFor(() => h.n('${sel}') === 0)`)
    await run('await h.settle(1500)')
    const after = await scopeCheckers(cdp)
    const delta = Object.fromEntries(Object.keys({ ...before, ...after }).map(k => [k, (after[k] || 0) - (before[k] || 0)]))
    out.retention[label] = { before, after, delta }
    console.log(`retained ${label.padEnd(36)} ${JSON.stringify(delta)}`)
    await ctx.close()
  }
}

await mkdir(resolve(root, 'results'), { recursive: true })
await writeFile(resolve(root, OUT), JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}`)
await browser.close()
server.close()
