// CPU profile of N wheel-pan steps (or a drag) at 10k shapes; self time by function
const { chromium } = await import('playwright')
const mode = process.argv[2] || 'pan', url = process.argv[3] || 'http://localhost:4801/'
const b = await chromium.launch(), page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url); await page.waitForFunction(() => window.__canvasBench)
await page.evaluate(() => window.__canvasBench.generate(10000))
const cdp = await page.context().newCDPSession(page)
const c = await page.evaluate(() => window.__canvasBench.canvasCenter())
await page.mouse.move(c.x, c.y)
if (mode == 'drag') { await page.evaluate(() => window.__canvasBench.select(1)); const p = await page.evaluate(() => window.__canvasBench.dragPoint()); await page.mouse.move(p.x, p.y); await page.mouse.down() }
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start')
for (let i = 0; i < 120; i++) {
  if (mode == 'pan') await page.mouse.wheel(i % 40 < 20 ? 24 : -24, i % 30 < 15 ? 18 : -18)
  else if (mode == 'zoom') await page.mouse.wheel(0, Math.floor(i / 20) % 2 ? 20 : -20)
  else { const p = await page.evaluate(() => window.__canvasBench.dragPoint()); await page.mouse.move(p.x + (i % 2 ? 3 : -2), p.y + 2) }
  await page.evaluate(() => window.__canvasBench.frame())
}
const { profile } = await cdp.send('Profiler.stop')
const self = new Map(), total = profile.samples.length
const dt = (profile.endTime - profile.startTime) / total
const byId = new Map(profile.nodes.map(n => [n.id, n]))
const counts = new Map(); for (const s of profile.samples) counts.set(s, (counts.get(s) || 0) + 1)
for (const [id, k] of counts) { const n = byId.get(id), f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(key, (self.get(key) || 0) + k) }
const rows = [...self].sort((a, b) => b[1] - a[1]).slice(0, 40)
for (const [k, v] of rows) console.log((v * dt / 1000 / 120).toFixed(3).padStart(7), 'ms/step', k)
await b.close()
