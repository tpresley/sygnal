// Interleaved A/B of the core's per-item cost in Chromium (the compile-wasm ab.mjs method: every
// page open in its own context, measured round-robin in a rotating order, so load drift on a shared
// machine hits every build alike). The pages are the audit's Sygnal apps (benchmarks/audit/apps/
// sygnal/*.html), built once per Sygnal dist with `sygnal` aliased to that dist.
//
// Per op it reports two medians:
//   core: click -> the core's onPatch hook (the action, the reducer, the render pass: instances,
//         views, the same-output check; the vnode handed to the DOM driver). A hook layer is
//         installed through __SYGNAL_DIAGNOSTICS__.layers, the dev entries' slot (no app change).
//   dom:  the audit's latency (event -> DOM settled + layout, benchmarks/audit/lib/ops.mjs).
//
//   node dev-plans/research/collection-cost/ab.mjs --dists=base:<dir>,new:dist [--rounds=25]
//        [--ops=select row (1k),create 1k rows,...] [--no-build]
// <dir>: a built Sygnal dist (npm run build's dist/); CC_OUT: where the pages are built
// (default results/ next to this file, git-ignored).
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const here = import.meta.dirname, repo = resolve(here, '../../..')
const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const req = createRequire(resolve(repo, 'benchmarks/package.json'))
const imp = (m) => import(pathToFileURL(req.resolve(m)).href)
const { HELPERS, OPS } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/ops.mjs')).href)
const { serve } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/server.mjs')).href)
const DISTS = arg('dists', 'new:dist').split(',').map(s => { const [n, d] = s.split(':'); return { n, d: resolve(repo, d) } })
const ROUNDS = +arg('rounds', 25)
const out = resolve(process.env.CC_OUT || resolve(here, 'results'), 'pages')
const PAGES = { table: 'table-coll', counters: 'counters', calc: 'coll-calc' }
const OPF = arg('ops', 'select row (1k),create 1k rows,replace 1k rows,update every 10th,clear 1k rows,create 10k rows,append 1k,mount 1k components,unmount 1k components,update 1 of 1k').split(',')
const ops = Object.entries(OPS).flatMap(([k, list]) => (k === 'table' || k === 'counters' || k === 'calc') ? list.map(o => ({ ...o, page: PAGES[k] })) : [])
  .filter(o => OPF.some(f => o.name.startsWith(f)) && !o.name.includes('(tags)'))

if (!process.argv.includes('--no-build')) {
  const { build } = await imp('vite')
  const sygnal = (await imp('sygnal/vite')).default
  for (const { n, d } of DISTS) {
    const alias = [
      { find: /^sygnal\/jsx-dev-runtime$/, replacement: resolve(d, 'jsx-dev-runtime.esm.js') },
      { find: /^sygnal\/jsx-runtime$/, replacement: resolve(d, 'jsx-runtime.esm.js') },
      { find: /^sygnal$/, replacement: resolve(d, 'index.esm.js') },
    ]
    const pages = [...new Set(ops.map(o => o.page))]
    await build({
      root: repo, configFile: false, logLevel: 'warn', mode: 'production', base: `/${n}/`,
      plugins: [sygnal({ devtools: false, check: false, diagnostics: 'off' })], resolve: { alias },
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { outDir: resolve(out, n), emptyOutDir: true, minify: 'esbuild', rollupOptions: { input: Object.fromEntries(pages.map(p => [p, resolve(repo, `benchmarks/audit/apps/sygnal/${p}.html`)])) } },
    })
  }
}

// the hook layer: the core overwrites __SYGNAL_DIAGNOSTICS__ when it loads; the setter adds it
const HOOK = `(() => {
  let d
  Object.defineProperty(globalThis, '__SYGNAL_DIAGNOSTICS__', { configurable: true,
    get: () => d, set: (v) => { d = v; d.layers = [() => ({ onPatch() { window.__tp = performance.now() } })] } })
})()`
const pw = await imp('playwright'), chromium = pw.chromium || pw.default.chromium
const server = await serve(out), browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
const open = async (n, page) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), p = await ctx.newPage()
  p.on('pageerror', e => console.error(n, page, e.message))
  await p.addInitScript(HELPERS); await p.addInitScript(HOOK)
  await p.goto(`${server.url}/${n}/benchmarks/audit/apps/sygnal/${page}.html`)
  await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0, null, { timeout: 120000 })
  return { p, ctx }
}
const q = (a, f) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * f)] }
const results = {}
for (const op of ops) {
  const R = op.fresh ? Math.min(ROUNDS, 8) : ROUNDS
  let tabs = {}
  for (const { n } of DISTS) tabs[n] = await open(n, op.page)
  const core = Object.fromEntries(DISTS.map(x => [x.n, []])), lat = Object.fromEntries(DISTS.map(x => [x.n, []]))
  for (let r = 0; r < R + 2; r++) {
    const order = DISTS.map((_, i) => DISTS[(i + r) % DISTS.length].n)
    for (const n of order) {
      if (op.fresh && r > 0) { await tabs[n].ctx.close(); tabs[n] = await open(n, op.page) }
      const { p } = tabs[n]
      await p.evaluate(`(async () => { const h = window.__h; ${op.setup} })()`)
      await p.evaluate('window.__h.quiet()')
      const m = await p.evaluate(`(async () => { const h = window.__h; window.__tp = 0; let t0; const m = await h.measure(() => { t0 = performance.now(); ${op.act} }, () => (${op.done})); return { dom: m.dom, core: window.__tp - t0 } })()`)
      if (r >= 2) { core[n].push(m.core); lat[n].push(m.dom) }
    }
  }
  for (const { n } of DISTS) await tabs[n].ctx.close()
  results[op.name] = {}
  console.log(`\n${op.name} (${op.page}, ${R} interleaved rounds): median [p25 - p75] ms`)
  for (const { n } of DISTS) {
    const c = core[n], l = lat[n]
    results[op.name][n] = { core: +q(c, 0.5).toFixed(3), coreP25: +q(c, 0.25).toFixed(3), coreP75: +q(c, 0.75).toFixed(3), dom: +q(l, 0.5).toFixed(3) }
    console.log(`  ${n.padEnd(8)} core ${q(c, 0.5).toFixed(2).padStart(7)} [${q(c, 0.25).toFixed(2)} - ${q(c, 0.75).toFixed(2)}]   dom ${q(l, 0.5).toFixed(2).padStart(7)} [${q(l, 0.25).toFixed(2)} - ${q(l, 0.75).toFixed(2)}]`)
  }
}
await browser.close(); server.close()
if (arg('json')) { mkdirSync(resolve(arg('json'), '..'), { recursive: true }); writeFileSync(arg('json'), JSON.stringify({ rounds: ROUNDS, dists: DISTS.map(x => x.n), results }, null, 1)) }
