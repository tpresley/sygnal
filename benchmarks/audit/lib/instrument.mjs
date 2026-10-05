// Shared by instrument.mjs (the audit's count report) and scripts/perf-gate.mjs (the count
// gate in `npm test`): an unminified build of the Sygnal apps with counters injected at build
// time, and helpers to count work and retained objects in headless Chromium.
//
//   - DOM patches: snabbdom's `patch` (the function `init()` returns) is wrapped, so every
//     patch counts, whichever part of Sygnal calls it
//   - xstream streams: xstream's Stream constructor is wrapped
//   - setTimeout / setInterval calls: wrapped in the page (init script)
//   - retained objects (ScopeChecker, ...): CDP heap snapshots
//   - heap: CDP Runtime.getHeapUsage after three forced GCs
import { build } from 'vite'
import { resolve } from 'node:path'
import sygnal from 'sygnal/vite'
import { serve } from './server.mjs'
import { HELPERS } from './ops.mjs'

const root = resolve(import.meta.dirname, '..')

// Each hook must be found in the build, or the counts would silently read 0.
const HOOKS = {
  patches: {
    file: /node_modules\/snabbdom\/build\/init\.js$/,
    find: 'return function patch(oldVnode, vnode) {',
    add: 'globalThis.__perf && globalThis.__perf.patches++;',
  },
  streams: {
    file: /node_modules\/xstream\/index\.js$/,
    find: 'function Stream(producer) {',
    add: 'globalThis.__perf && globalThis.__perf.streams++;',
  },
}

// Builds apps/sygnal/<page>.html for each page into outDir/sygnal (unminified, production mode).
// fw: 'sygnal' (the shipped core) or 'next' (PLAN-4.6 R1-R4: the next core's apps, with the
// D175 strip turned off by __SYGNAL_NEXT_CORE__)
export async function buildInstrumented({ pages, outDir, logLevel = 'warn', fw = 'sygnal' }) {
  const applied = new Set()
  const counters = {
    name: 'perf-counters',
    enforce: 'pre',
    transform(code, id) {
      for (const [name, h] of Object.entries(HOOKS)) {
        if (h.file.test(id) && code.includes(h.find)) {
          applied.add(name)
          return code.replace(h.find, h.find + ' ' + h.add)
        }
      }
    },
  }
  await build({
    root, configFile: false, logLevel, mode: 'production', base: './',
    plugins: [counters, sygnal()],
    define: { 'process.env.NODE_ENV': '"production"', ...(fw === 'next' && { __SYGNAL_NEXT_CORE__: 'true' }) },
    build: {
      outDir: resolve(outDir, fw), emptyOutDir: true, minify: false,
      rollupOptions: { input: Object.fromEntries(pages.map(s => [s, resolve(root, `apps/${fw}`, `${s}.html`)])) },
    },
  })
  const missing = Object.keys(HOOKS).filter(k => !applied.has(k))
  if (missing.length) {
    throw new Error(`instrumentation hook(s) not found in the build: ${missing.map(k => `${k} (\`${HOOKS[k].find}\` in ${HOOKS[k].file})`).join(', ')}. Update HOOKS in benchmarks/audit/lib/instrument.mjs.`)
  }
}

export const COUNT = `
window.__perf = { patches: 0, streams: 0, timeouts: 0, intervals: 0 };
(() => {
  const st = window.setTimeout, si = window.setInterval
  window.setTimeout = function (...a) { window.__perf.timeouts++; return st.apply(this, a) }
  window.setInterval = function (...a) { window.__perf.intervals++; return si.apply(this, a) }
})();
`
export const RESET = `Object.keys(window.__perf).forEach(k => window.__perf[k] = 0)`
export const READ = `return { ...window.__perf }`

// A browser + static server over outDir. `chromium` is a Playwright BrowserType (the gate
// passes browser-tests' copy, so it runs the same Chromium as `npm run test:browser`).
export async function openSession({ chromium, outDir, fw = 'sygnal' }) {
  const server = await serve(outDir)
  const browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] })
  const pageErrors = []

  async function open(page) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const p = await ctx.newPage()
    p.on('pageerror', e => pageErrors.push(`${page}: ${e.message}`))
    await p.addInitScript(COUNT + HELPERS)
    await p.goto(`${server.url}/${fw}/apps/${fw}/${page}.html`)
    await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
    const cdp = await ctx.newCDPSession(p)
    const run = (code) => p.evaluate(`(async () => { const h = window.__h; ${code} })()`)
    return { p, ctx, cdp, run }
  }

  // Counts during `act` until `done` holds, plus a fixed trailing window for deferred work.
  async function counted(page, setup, act, done, trail = 500) {
    const { ctx, run } = await open(page)
    await run(setup)
    await run(`await h.settle(300); ${RESET}`)
    const r = await run(`${act}; await h.waitFor(() => ${done}); await h.settle(${trail}); ${READ}`)
    await ctx.close()
    return r
  }

  return { browser, server, open, counted, pageErrors, close: async () => { await browser.close(); server.close() } }
}

// Instances per constructor name (objects only), from a heap snapshot taken after three GCs.
export async function countObjects(cdp, names = ['ScopeChecker', 'ElementFinder', 'Component', 'Stream', 'MemoryStream']) {
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
  const want = new Set(names)
  const counts = Object.fromEntries(names.map(n => [n, 0]))
  for (let i = 0; i < snap.nodes.length; i += nf) {
    if (types[snap.nodes[i + ti]] !== 'object') continue
    const name = snap.strings[snap.nodes[i + ni]]
    if (want.has(name)) counts[name]++
  }
  return counts
}

// JS heap (MB) and DOM node count after three forced GCs.
export async function heapUsage(cdp) {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  const { nodes } = await cdp.send('Memory.getDOMCounters')
  return { heapMB: usedSize / 1048576, domNodes: nodes }
}
