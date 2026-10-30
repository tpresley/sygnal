// The heavy-model case (README §4.3): stream/app.jsx re-parses a streamed buffer for ~25 ms per
// chunk while the user types into a controlled field. Per mode, median of RUNS: keystroke
// input→paint (Event Timing durations of keydown, all of them: durationThreshold 16, below that
// counted as 16), long tasks, the longest frame gap, how long the 120 chunks took, and whether
// the field ends with exactly what was typed.
//   node dev-plans/research/web-worker/spike/measure-stream.mjs
import {createRequire} from 'node:module'
import {serve} from './serve.mjs'

const require = createRequire(new URL('../../../../browser-tests/package.json', import.meta.url))
const {chromium} = require('playwright')
const RUNS = +(process.env.RUNS || 5)
const TEXT = 'the quick brown fox jumps over'
const {server, url} = await serve()
const browser = await chromium.launch()
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)] }
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const r1 = (x) => Math.round(x * 10) / 10
const out = {}
const rec = (k, mode, v) => ((out[k] ||= {})[mode] ||= []).push(v)

for (let run = 0; run < RUNS; run++) {
  for (const mode of ['main', 'worker']) {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      window.__long = []; window.__events = []; window.__frames = []
      new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({type: 'longtask', buffered: true})
      new PerformanceObserver((l) => window.__events.push(...l.getEntries().filter((e) => e.name === 'keydown').map((e) => e.duration))).observe({type: 'event', durationThreshold: 16, buffered: true})
      const f = (t) => { window.__frames.push(t); requestAnimationFrame(f) }
      requestAnimationFrame(f)
    })
    await page.goto(`${url}/stream/${mode}.html`)
    await page.waitForSelector('.note')
    await page.evaluate(() => { window.__long.length = 0; window.__events.length = 0; window.__frames.length = 0; window.__t0 = performance.now() })
    await page.click('.start')
    await page.click('.note')
    // a fast typist: 80 ms a key, all while the chunks stream
    await page.keyboard.type(TEXT, {delay: 80})
    await page.waitForFunction(() => document.querySelector('.status').textContent.startsWith('120 chunks'), null, {timeout: 60000})
    const r = await page.evaluate((n) => {
      const f = window.__frames
      let gap = 0
      for (let i = 1; i < f.length; i++) gap = Math.max(gap, f[i] - f[i - 1])
      const keys = window.__events.concat(Array(Math.max(0, n - window.__events.length)).fill(16))
      return {keys, long: window.__long.length, longMs: window.__long.reduce((a, b) => a + b, 0), gap, total: performance.now() - window.__t0, value: document.querySelector('.note').value}
    }, TEXT.length)
    rec('keystroke input→paint p50 (ms)', mode, pct(r.keys, 0.5))
    rec('keystroke input→paint p95 (ms)', mode, pct(r.keys, 0.95))
    rec('keystroke input→paint max (ms)', mode, Math.max(...r.keys))
    rec('page long tasks (count)', mode, r.long)
    rec('page long tasks (ms)', mode, r.longMs)
    rec('longest frame gap (ms)', mode, r.gap)
    rec('120 chunks streamed in (ms)', mode, r.total)
    rec('field ends with what was typed (1 = yes)', mode, r.value === TEXT ? 1 : 0)
    await page.close()
  }
}
await browser.close()
server.close()
const table = {}
for (const [k, v] of Object.entries(out)) table[k] = {main: r1(median(v.main)), worker: r1(median(v.worker)), 'main runs': v.main.map(r1).join(' '), 'worker runs': v.worker.map(r1).join(' ')}
console.table(table)
