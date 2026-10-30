// CV-3b: a Chromium timeline trace of create 1k per page, durations summed by event (Layout, FunctionCall, GC, ...)
//   node dev-plans/research/compile-wasm/trace.mjs <repo> <built dist> page...
import { createRequire } from 'node:module'; import { resolve } from 'node:path'; import { pathToFileURL } from 'node:url'
const repo = process.argv[2], dist = process.argv[3], pages = process.argv.slice(4)
const req = createRequire(resolve(repo, 'benchmarks/package.json')); const pw = await import(pathToFileURL(req.resolve('playwright')).href), chromium = pw.chromium || pw.default.chromium
const { HELPERS } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/ops.mjs')).href)
const { serve } = await import(pathToFileURL(resolve(repo, 'benchmarks/audit/lib/server.mjs')).href)
const server = await serve(dist); const b = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
const NAMES = /^(FunctionCall|EvaluateScript|RunMicrotasks|V8\.GC_.*|MinorGC|MajorGC|UpdateLayoutTree|Layout|Paint|PrePaint|Layerize|ParseHTML|HitTest|TimerFire|FireAnimationFrame|v8\.callFunction|RecalculateStyles|ScheduleStyleRecalculation|InvalidateLayout|MutationObserver.*|V8\.Execute|ProfileCall)$/
for (const page of pages) {
  const p = await b.newPage(); await p.addInitScript(HELPERS)
  await p.goto(server.url + '/dev-plans/research/compile-wasm/apps/' + page + '.html'); await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
  const cdp = await p.context().newCDPSession(p)
  const sum = new Map(); const RUNS = 8; let lat = []
  for (let r = 0; r < RUNS + 2; r++) {
    await p.evaluate(`(async () => { const h = window.__h; h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); await h.quiet(); gc() })()`)
    const events = []
    cdp.removeAllListeners('Tracing.dataCollected'); cdp.on('Tracing.dataCollected', e => events.push(...e.value))
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' })
    const t = await p.evaluate(`(async () => { const h = window.__h; const t0 = performance.now(); h.click('#run'); await h.waitFor(() => h.n('.row') === 1000); document.body.offsetHeight; return performance.now() - t0 })()`)
    const done = new Promise(r => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await done
    if (r < 2) continue
    lat.push(t)
    for (const e of events) if (e.ph === 'X' && NAMES.test(e.name) && e.dur) sum.set(e.name, (sum.get(e.name) || 0) + e.dur / 1000 / RUNS)
  }
  lat.sort((a, c) => a - c)
  console.log(`\n${page}: latency median ${lat[RUNS >> 1].toFixed(1)} ms`)
  for (const [k, v] of [...sum].sort((a, c) => c[1] - a[1]).slice(0, 12)) console.log(v.toFixed(2).padStart(8), k)
  await p.close()
}
await b.close(); server.close()
