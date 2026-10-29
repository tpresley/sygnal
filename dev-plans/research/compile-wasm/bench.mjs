// Builds the compile-wasm prototype pages (apps/*.html) plus the audit's React table, and times
// the table ops with the audit harness's method (benchmarks/audit/bench.mjs: quiet wait, gc,
// latency = event -> DOM settled + layout; cpu = CDP main-thread task time).
//   node dev-plans/research/compile-wasm/bench.mjs [--pages=table-base,table-a] [--ops=substr,substr]
//        [--iter=10] [--warmup=3] [--no-build] [--profile]   (--profile: unminified, for profile.mjs-style use)
// Needs: npm run build (dist/), npm ci --prefix benchmarks. Uses benchmarks/'s Vite and Playwright.
import { createRequire } from 'node:module'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'

const here = import.meta.dirname
const repo = resolve(here, '../../..')
const req = createRequire(resolve(repo, 'benchmarks/package.json'))
const imp = (m) => import(pathToFileURL(req.resolve(m)).href)
const { build } = await imp('vite')
const sygnal = (await imp('sygnal/vite')).default
const react = (await imp('@vitejs/plugin-react')).default
const pw = await imp('playwright'), chromium = pw.chromium || pw.default.chromium
const { HELPERS, OPS } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/ops.mjs')).href)
const { serve } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/server.mjs')).href)

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const ALL = ['table-base', 'table-a', 'table-b', 'coll-base', 'coll-a', 'coll-b', 'react']
const PAGES = arg('pages', ALL.join(',')).split(',')
const OPF = arg('ops', 'create 1k rows,replace 1k rows,update every 10th,select row (1k),swap rows,remove row,create 10k,append 1k,clear 1k rows').split(',')
const ITER = +arg('iter', 10), WARMUP = +arg('warmup', 3)
const profile = process.argv.includes('--profile')
const out = resolve(process.env.CW_OUT || resolve(here, 'results'), profile ? 'dist-profile' : 'dist')

const html = (p) => p === 'react' ? resolve(repo, 'benchmarks/audit/apps/react/table.html') : resolve(here, 'apps', `${p}.html`)
const url = (p) => '/' + relative(repo, html(p)).replace(/\\/g, '/')

if (!process.argv.includes('--no-build')) {
  for (const fw of ['sygnal', 'react']) {
    const pages = PAGES.filter(p => (p === 'react') === (fw === 'react'))
    if (!pages.length) continue
    await build({
      root: repo, configFile: false, logLevel: 'warn', mode: 'production', base: '/',
      plugins: fw === 'react' ? [react()] : [sygnal()],
      define: { 'process.env.NODE_ENV': '"production"' },
      build: { outDir: out, emptyOutDir: false, minify: profile ? false : 'esbuild', sourcemap: profile, rollupOptions: { input: Object.fromEntries(pages.map(p => [p, html(p)])) } },
    })
  }
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const round = (x) => Math.round(x * 100) / 100
const server = await serve(out)
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
async function openPage(page) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await p.addInitScript(HELPERS)
  await p.goto(server.url + url(page))
  await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
  const cdp = await ctx.newCDPSession(p)
  await cdp.send('Performance.enable')
  return { p, cdp, ctx, errors }
}
const taskSeconds = async (cdp) => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration').value
async function heapMB(cdp) {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  return round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576)
}
async function runOp(page, op) {
  let { p, cdp, ctx, errors } = await openPage(page)
  const lat = [], cpu = []
  const warm = op.fresh ? 1 : WARMUP, n = warm + (op.iterations ?? ITER)
  try {
    for (let i = 0; i < n; i++) {
      if (op.fresh && i > 0) { await ctx.close(); ({ p, cdp, ctx } = await openPage(page)); p.on('pageerror', e => errors.push(e.message)) }
      await p.evaluate(`(async () => { const h = window.__h; ${op.setup} })()`)
      await p.evaluate('window.__h.quiet()')
      const before = await taskSeconds(cdp)
      const r = await p.evaluate(`(() => { const h = window.__h; return h.measure(() => { ${op.act} }, () => (${op.done})) })()`)
      await p.waitForTimeout(150)
      const after = await taskSeconds(cdp)
      if (i >= warm) { lat.push(r.dom); cpu.push((after - before) * 1000) }
    }
  } catch (e) { errors.push(String(e.message).slice(0, 200)) }
  await ctx.close()
  return { latency: lat.length ? round(median(lat)) : null, cpu: cpu.length ? round(median(cpu)) : null, errors: errors.slice(0, 2) }
}
// heap with 1k rows (after GC), per page
async function memory(page) {
  const { p, cdp, ctx } = await openPage(page)
  const h = (code) => p.evaluate(`(async () => { const h = window.__h; ${code}; await h.settle(200) })()`)
  const ready = await heapMB(cdp)
  await h(`h.click('#run'); await h.waitFor(() => h.n('.row') === 1000)`)
  const rows = await heapMB(cdp)
  await ctx.close()
  return round(rows - ready)
}

const ops = OPS.table.filter(o => OPF.some(f => o.name.startsWith(f)))
const results = {}
console.log(`pages: ${PAGES.join(', ')}; ${ITER} iterations (+${WARMUP} warm-up); median latency / cpu ms`)
for (const op of ops) {
  results[op.name] = {}
  const cells = []
  for (const page of PAGES) {
    const r = await runOp(page, op)
    results[op.name][page] = r
    cells.push(`${page} ${r.latency}/${r.cpu}${r.errors.length ? ' ERR ' + r.errors.join(' | ') : ''}`)
  }
  console.log(`${op.name.padEnd(24)} ${cells.join('   ')}`)
}
if (!process.argv.includes('--no-memory')) {
  results.memory = {}
  for (const page of PAGES) results.memory[page] = await memory(page)
  console.log(`heap MB for 1k rows       ${PAGES.map(p => `${p} ${results.memory[p]}`).join('   ')}`)
}
await browser.close(); server.close()
mkdirSync(resolve(here, 'results'), { recursive: true })
const file = resolve(here, 'results', `bench-${new Date().toISOString().slice(0, 16).replace(/[:]/g, '')}.json`)
writeFileSync(file, JSON.stringify({ date: new Date().toISOString(), iter: ITER, results }, null, 2))
console.log('wrote', relative(repo, file))
