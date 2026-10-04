// Speed + memory benchmark: Sygnal vs React vs Vue in headless Chromium.
//   node bench.mjs [--fw=sygnal,react] [--scenario=table] [--op=substring] [--iter=10] [--no-memory] [--out=results/x.json]
// Per op and app: a fresh page, warmup iterations, then measured ones. Reports the median
// latency (dispatch -> DOM shows the result, layout included) and the median main-thread
// CPU (CDP TaskDuration from dispatch to 150 ms after the result: includes trailing work).
import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { serve } from './lib/server.mjs'
import { HELPERS, OPS, pagesFor } from './lib/ops.mjs'

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const FWS = arg('fw', 'sygnal,react,vue').split(',')
const SCENARIOS = arg('scenario', Object.keys(OPS).join(',')).split(',')
const OPF = arg('op', '')
const ITER = +arg('iter', 10)
const WARMUP = +arg('warmup', 3)
const DIST = arg('dist', 'dist')
const OUT = arg('out', `results/bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
const memory = !process.argv.includes('--no-memory')

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const round = (x) => Math.round(x * 100) / 100

const server = await serve(resolve(import.meta.dirname, DIST))
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })

async function openPage(fw, page) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await p.addInitScript(HELPERS)
  await p.goto(`${server.url}/${fw}/apps/${fw}/${page}.html`)
  await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
  const cdp = await ctx.newCDPSession(p)
  await cdp.send('Performance.enable')
  return { p, cdp, ctx, errors }
}

async function taskSeconds(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return metrics.find(m => m.name === 'TaskDuration').value
}

async function heap(cdp) {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  const { nodes } = await cdp.send('Memory.getDOMCounters')
  return { heapMB: round(usedSize / 1048576), domNodes: nodes }
}

async function runOp(fw, page, op) {
  let { p, cdp, ctx, errors } = await openPage(fw, page)
  const lat = [], cpu = []
  // fresh: a new page per iteration (ops whose setup would be distorted by the previous run)
  const warm = op.fresh ? 1 : WARMUP
  const n = warm + (op.iterations ?? ITER)
  try {
    for (let i = 0; i < n; i++) {
      if (op.fresh && i > 0) { await ctx.close(); ({ p, cdp, ctx } = await openPage(fw, page)); p.on('pageerror', e => errors.push(e.message)) }
      await p.evaluate(`(async () => { const h = window.__h; ${op.setup} })()`)
      await p.evaluate('window.gc && window.gc()')
      const before = await taskSeconds(cdp)
      const ms = await p.evaluate(`(() => { const h = window.__h; return h.measure(() => { ${op.act} }, () => (${op.done})) })()`)
      await p.waitForTimeout(150)
      const after = await taskSeconds(cdp)
      if (i >= warm) { lat.push(ms); cpu.push((after - before) * 1000) }
    }
  } catch (e) {
    errors.push(String(e.message).slice(0, 300))
  }
  await ctx.close()
  return { latency: lat.length ? round(median(lat)) : null, cpu: cpu.length ? round(median(cpu)) : null, min: lat.length ? round(Math.min(...lat)) : null, samples: lat.map(round), errors: errors.slice(0, 3) }
}

async function memoryRuns(fw) {
  const out = {}
  for (const [label, page] of pagesFor(fw, 'table')) {
    const { p, cdp, ctx } = await openPage(fw, page)
    const h = (code) => p.evaluate(`(async () => { const h = window.__h; ${code}; await h.settle(200) })()`)
    const m = {}
    m.ready = await heap(cdp)
    await h(`h.click('#run'); await h.waitFor(() => h.n('.row') === 1000)`)
    m['1k rows'] = await heap(cdp)
    await h(`h.click('#runlots'); await h.waitFor(() => h.n('.row') === 10000)`)
    m['10k rows'] = await heap(cdp)
    await h(`h.click('#clear'); await h.waitFor(() => h.n('.row') === 0)`)
    for (let i = 0; i < 5; i++) await h(`h.click('#run'); await h.waitFor(() => h.n('.row') === 1000); h.click('#clear'); await h.waitFor(() => h.n('.row') === 0)`)
    m['after 5x create/clear'] = await heap(cdp)
    out[label] = m
    await ctx.close()
  }
  {
    const { p, cdp, ctx } = await openPage(fw, 'counters')
    const h = (code) => p.evaluate(`(async () => { const h = window.__h; ${code}; await h.settle(200) })()`)
    const m = { ready: await heap(cdp) }
    await h(`h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000)`)
    m['1k components'] = await heap(cdp)
    for (let i = 0; i < 5; i++) await h(`h.click('#destroy'); await h.waitFor(() => h.n('.counter') === 0); h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000)`)
    await h(`h.click('#destroy'); await h.waitFor(() => h.n('.counter') === 0)`)
    m['after 6x mount/unmount'] = await heap(cdp)
    out[`${fw === 'sygnal' ? 'sygnal' : fw} counters`] = m
    await ctx.close()
  }
  return out
}

const results = { date: new Date().toISOString(), iter: ITER, warmup: WARMUP, chromium: browser.version(), speed: {}, memory: {} }
for (const scenario of SCENARIOS) {
  for (const op of OPS[scenario]) {
    if (OPF && !op.name.includes(OPF)) continue
    results.speed[op.name] = {}
    for (const fw of FWS) {
      for (const [label, page] of pagesFor(fw, scenario)) {
        const r = await runOp(fw, page, op)
        results.speed[op.name][label] = r
        console.log(`${op.name.padEnd(26)} ${label.padEnd(20)} latency ${String(r.latency).padStart(9)} ms   cpu ${String(r.cpu).padStart(9)} ms${r.errors.length ? '   ERR ' + r.errors.join(' | ') : ''}`)
      }
    }
  }
}
if (memory) {
  for (const fw of FWS) {
    results.memory[fw] = await memoryRuns(fw)
    for (const [k, v] of Object.entries(results.memory[fw])) console.log(`memory ${k.padEnd(22)} ${Object.entries(v).map(([s, x]) => `${s}: ${x.heapMB} MB / ${x.domNodes} nodes`).join('  |  ')}`)
  }
}
await mkdir(resolve(import.meta.dirname, 'results'), { recursive: true })
await writeFile(resolve(import.meta.dirname, OUT), JSON.stringify(results, null, 2))
console.log(`wrote ${OUT}`)
await browser.close()
server.close()
