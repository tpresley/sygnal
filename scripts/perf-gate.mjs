#!/usr/bin/env node
// Performance count gate (PLAN-4.5 §3, `npm run test:perf-gate`, part of `npm test`).
//
// Builds the audit's Sygnal apps (benchmarks/audit/apps/sygnal) unminified against the
// current dist/, with counters injected (benchmarks/audit/lib/instrument.mjs), runs them in
// headless Chromium and compares counts to the limits in benchmarks/audit/gate.json:
//   DOM patches (select row and update every 10th in a 1k Collection; leaf click 30 deep),
//   streams per Collection item, setTimeout calls to unmount 1k components, retained
//   ScopeCheckers after 5x1k mount/unmount (heap snapshot), and the settled heap growth after
//   5x1k Collection create/clear.
// Counts, not timings: they don't depend on the machine. Exits 1 when a value is above its
// limit, 2 when the gate can't run (missing dependencies, build or page errors).
//
// Uses browser-tests' Playwright, so it runs the same Chromium as `npm run test:browser`, and
// Vite + sygnal/vite from benchmarks/ (`npm ci --prefix benchmarks`). No network.
//
//   node scripts/perf-gate.mjs [--runs=N] [--no-build] [--json=<file>] [--gate=<file>] [--install]
//     --runs=N   measure N times (one build) and print the spread of each metric
//     --gate     another limits file (default benchmarks/audit/gate.json)
//     --install  run `npm ci --prefix benchmarks` first when benchmarks/ isn't installed
//                (also on with TEST_EXAMPLES_INSTALL=1, as for the example suites)
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const benchmarks = path.join(repo, 'benchmarks')
const audit = path.join(benchmarks, 'audit')
const outDir = path.join(audit, 'dist-gate')
const argv = process.argv.slice(2)
const opt = (k) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const gateFile = opt('gate') ? path.resolve(opt('gate')) : path.join(audit, 'gate.json')
const RUNS = Math.max(1, Number(opt('runs') ?? 1) || 1)
const JSON_OUT = opt('json')
const install = argv.includes('--install') || /^(1|true|yes)$/i.test(process.env.TEST_EXAMPLES_INSTALL || '')
const fail = (msg) => { console.error(`perf-gate: ${msg}`); process.exit(2) }
const t0 = Date.now()

// --- dependencies --------------------------------------------------------------------------
if (!fs.existsSync(path.join(repo, 'dist', 'index.esm.js')) || !fs.existsSync(path.join(repo, 'dist', 'vite', 'plugin.mjs'))) {
  fail('dist/ is missing or incomplete. Run `npm run build` first.')
}
const benchReady = () => ['vite', 'sygnal'].every(d => fs.existsSync(path.join(benchmarks, 'node_modules', d)))
if (!benchReady() && install) {
  console.log('perf-gate: installing benchmarks/ (npm ci --prefix benchmarks)')
  const r = spawnSync('npm', ['ci', '--prefix', benchmarks], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) fail('`npm ci --prefix benchmarks` failed.')
}
if (!benchReady()) {
  fail('benchmarks/ is not installed (Vite and sygnal/vite for the gate build).\n' +
    '  Run `npm ci --prefix benchmarks` (or `TEST_EXAMPLES_INSTALL=1 npm test`, or this script with --install).')
}
let chromium
try {
  const req = createRequire(path.join(repo, 'browser-tests', 'package.json'))
  ;({ chromium } = req('playwright'))
} catch (err) {
  fail(`cannot load Playwright from browser-tests/ (${err.message}).\n  Run \`npm ci --prefix browser-tests\` first.`)
}
const lib = await import(pathToFileURL(path.join(audit, 'lib', 'instrument.mjs')).href)
const gate = JSON.parse(fs.readFileSync(gateFile, 'utf8'))

// --- measurements --------------------------------------------------------------------------
const rows1k = `h.click('#run'); await h.waitFor(() => h.n('.row') === 1000)`

async function measure(s) {
  const v = {}
  const { counted, open } = s

  v['patches.selectCollection'] = (await counted('table-coll', rows1k, `h.click('.row:nth-child(2) .lbl')`, `h.q('.row:nth-child(2)').classList.contains('danger')`)).patches
  v['patches.update10thCollection'] = (await counted('table-coll', rows1k, `h.click('#update')`, `h.text('.row .lbl').endsWith('!!!')`)).patches
  v['patches.leaf30deep'] = (await counted('deep', `await h.waitFor(() => h.q('.leaf'))`, `h.click('.leaf .inc')`, `h.text('.leaf .val') === '1'`)).patches

  // One counters page: ScopeCheckers before; mount 1k (streams) and unmount (timers) counted
  // as cycle 1; four more cycles; ScopeCheckers after.
  {
    const { ctx, cdp, run } = await open('counters')
    await run('await h.settle(300)')
    const before = (await lib.countObjects(cdp, ['ScopeChecker'])).ScopeChecker
    await run(lib.RESET)
    const mount = await run(`h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000); await h.settle(1000); ${lib.READ}`)
    await run(lib.RESET)
    const unmount = await run(`h.click('#destroy'); await h.waitFor(() => h.n('.counter') === 0); await h.settle(1500); ${lib.READ}`)
    // per item, to 0.1: one more stream per item fails; app-level streams (< 50) don't move it
    v['streams.perCollectionItem'] = Math.round(mount.streams / 100) / 10
    v['info.streamsMount1k'] = mount.streams
    v['timeouts.unmount1k'] = unmount.timeouts
    for (let i = 1; i < 5; i++) await run(`h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000); h.click('#destroy'); await h.waitFor(() => h.n('.counter') === 0)`)
    await run('await h.settle(1500)')
    v['retained.scopeCheckers'] = (await lib.countObjects(cdp, ['ScopeChecker'])).ScopeChecker - before
    await ctx.close()
  }

  // Settled heap growth: 5 back-to-back create/clear cycles of 1k Collection rows, then sample
  // every 750 ms until two samples agree within 0.1 MB (teardown has finished).
  {
    const { ctx, cdp, run } = await open('table-coll')
    await run('await h.settle(300)')
    const ready = (await lib.heapUsage(cdp)).heapMB
    for (let i = 0; i < 5; i++) await run(`h.click('#run'); await h.waitFor(() => h.n('.row') === 1000); h.click('#clear'); await h.waitFor(() => h.n('.row') === 0)`)
    let prev = Infinity, cur
    for (let i = 0; i < 8; i++) {
      await run('await h.settle(750)')
      cur = (await lib.heapUsage(cdp)).heapMB
      if (Math.abs(cur - prev) < 0.1) break
      prev = cur
    }
    v['heap.collectionCyclesMB'] = Math.round((cur - ready) * 100) / 100
    await ctx.close()
  }
  return v
}

// --- run -----------------------------------------------------------------------------------
if (!argv.includes('--no-build')) {
  try {
    await lib.buildInstrumented({ pages: ['table-coll', 'counters', 'deep'], outDir, logLevel: 'error' })
  } catch (err) {
    fail(`build failed: ${err.message}`)
  }
}
const s = await lib.openSession({ chromium, outDir })
const runs = []
try {
  for (let i = 0; i < RUNS; i++) runs.push(await measure(s))
} catch (err) {
  await s.close()
  fail(`measurement failed: ${err.message}${s.pageErrors.length ? '\n  ' + s.pageErrors.join('\n  ') : ''}`)
}
const chromiumVersion = s.browser.version()
await s.close()
if (s.pageErrors.length) fail(`page errors:\n  ${s.pageErrors.join('\n  ')}`)

// --- report --------------------------------------------------------------------------------
const fmt = (x, d = 0) => (x == null ? '-' : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))
const rows = []
let failed = 0
for (const [id, m] of Object.entries(gate.metrics)) {
  const values = runs.map(r => r[id])
  if (values.some(x => typeof x !== 'number' || Number.isNaN(x))) fail(`no measurement for gate metric ${id}`)
  const worst = Math.max(...values)
  const ok = worst <= m.limit
  if (!ok) failed++
  const d = m.decimals ?? 0
  const improved = ok && worst < m.baseline - (m.tolerance ?? 0)
  rows.push([m.label, values.length > 1 ? `${fmt(Math.min(...values), d)} … ${fmt(worst, d)}` : fmt(worst, d), fmt(m.limit, d), ok ? (improved ? 'ok, improved' : 'ok') : 'FAIL'])
}
const head = ['Metric', RUNS > 1 ? `Value (min … max of ${RUNS})` : 'Value', 'Limit', '']
const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
const line = (r) => r.map((c, i) => (i === 0 || i === 3 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')
console.log(`\nperf gate (counts; Chromium ${chromiumVersion}; limits in ${path.relative(repo, gateFile)})\n`)
console.log(line(head))
for (const r of rows) console.log(line(r))
console.log(`\n${failed ? `${failed} metric(s) over the limit` : 'all metrics within limits'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
if (failed) {
  console.log('A count went up. Find the change that added the work (benchmarks/audit/instrument.mjs prints the counts per op);\n' +
    'raise a limit in benchmarks/audit/gate.json only with a recorded decision.')
} else if (rows.some(r => r[3] === 'ok, improved')) {
  console.log('A metric is below its recorded baseline: lower its limit and baseline in benchmarks/audit/gate.json when your workstream lands.')
}
if (JSON_OUT) {
  fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true })
  fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify({ date: new Date().toISOString(), chromium: chromiumVersion, runs, limits: Object.fromEntries(Object.entries(gate.metrics).map(([k, m]) => [k, m.limit])) }, null, 2))
}
process.exit(failed ? 1 : 0)
