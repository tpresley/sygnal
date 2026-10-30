// main-thread time by trace event (self time, top level tasks) for N steps of a scenario at 10k (argv: <pan|zoom|drag> <url> [selection size for drag])
const { chromium } = await import('playwright')
const mode = process.argv[2] || 'pan', url = process.argv[3] || 'http://localhost:4801/', N = 60
const b = await chromium.launch(), page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url); await page.waitForFunction(() => window.__canvasBench)
await page.evaluate(() => window.__canvasBench.generate(10000))
const c = await page.evaluate(() => window.__canvasBench.canvasCenter())
await page.mouse.move(c.x + 37, c.y - 23)
if ((process.argv[2] || '') == 'zoom' || process.argv[3] == 'zoom') await page.keyboard.down('Control')
if (mode == 'drag') { await page.evaluate((n) => window.__canvasBench.select(n), Number(process.argv[4] || 1)); const p = await page.evaluate(() => window.__canvasBench.dragPoint()); await page.mouse.move(p.x, p.y); await page.mouse.down() }
for (let i = 0; i < 10; i++) { await page.mouse.wheel(mode == 'zoom' ? 0 : 24, mode == 'zoom' ? -20 : 18); await page.evaluate(() => window.__canvasBench.frame()) }
await b.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'skia', 'v8'] })
let P = null
for (let i = 0; i < N; i++) {
  if (mode == 'pan') await page.mouse.wheel(i % 40 < 20 ? 24 : -24, i % 30 < 15 ? 18 : -18)
  else if (mode == 'zoom') await page.mouse.wheel(0, Math.floor(i / 20) % 2 ? 20 : -20)
  else { P ||= await page.evaluate(() => window.__canvasBench.dragPoint()); await page.mouse.move(P.x + 3 * (i + 1), P.y + 2 * (i + 1)) }
  await page.evaluate(() => window.__canvasBench.frame())
}
const buf = await b.stopTracing()
const ev = JSON.parse(buf.toString()).traceEvents
const names = new Map(ev.filter(e => e.name == 'thread_name').map(e => [e.pid + ':' + e.tid, e.args.name]))
const main = ev.filter(e => names.get(e.pid + ':' + e.tid) == 'CrRendererMain' && e.ph == 'X' && e.dur)
// self time: subtract children (same thread, nested)
main.sort((a, b) => a.ts - b.ts || b.dur - a.dur)
const stack = [], self = new Map()
for (const e of main) {
  while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop()
  if (stack.length) { const p = stack.at(-1); p._child = (p._child || 0) + e.dur }
  stack.push(e)
}
for (const e of main) self.set(e.name, (self.get(e.name) || 0) + e.dur - (e._child || 0))
const tasks = main.filter(e => e.name == 'RunTask' || e.name == 'ThreadControllerImpl::RunTask').reduce((a, e) => a + e.dur, 0)
console.log('tasks total ms/step', (tasks / 1000 / N).toFixed(2))
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log((v / 1000 / N).toFixed(3).padStart(7), k)
await b.close()
