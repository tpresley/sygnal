/**
 * What the CPU profile calls "(program)": a Chromium trace of the same scenarios (3 s), the
 * renderer main thread's top-level events summed by name per frame (FireAnimationFrame = our JS,
 * Paint / Layerize / UpdateLayerTree / Commit = the browser's frame work), plus the time on the
 * compositor and raster threads.
 *   node dev-plans/research/canvas-game/perf/trace.mjs [--scenarios=level,stress300] [--query=paint=lazy]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const {chromium} = await import(path.join(repo, 'browser-tests/node_modules/playwright/index.mjs'))
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d
const SCENARIOS = arg('scenarios', 'level,stress300').split(','), QUERY = arg('query', '')
const APPS = {sygnal: path.join(repo, 'examples/platformer/dist'), baseline: path.join(here, '../baseline/dist')}
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}
const serve = (dir) => new Promise(res => {
  const s = http.createServer((req, rsp) => {
    const p = path.join(dir, new URL(req.url, 'http://x').pathname), f = fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(dir, 'index.html')
    rsp.writeHead(200, {'content-type': TYPES[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(rsp)
  })
  s.listen(0, () => res({url: `http://localhost:${s.address().port}/`, close: () => s.close()}))
})

const browser = await chromium.launch()
for (const [app, dir] of Object.entries(APPS)) {
  const srv = await serve(dir)
  for (const sc of SCENARIOS) {
    const page = await browser.newPage({viewport: {width: 800, height: 520}})
    const stress = /^stress(\d+)$/.exec(sc)
    await page.goto(srv.url + '?bench' + (stress ? `&stress=${stress[1]}` : '') + (QUERY ? '&' + QUERY : ''))
    await page.waitForFunction(() => window.__bench)
    if (!stress) { await page.keyboard.press('Enter'); await page.keyboard.down('ArrowRight') }
    await page.waitForTimeout(1500)
    await browser.startTracing(page, {categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'cc', 'gpu', 'v8']})
    await page.waitForTimeout(3000)
    const buf = await browser.stopTracing()
    await page.close()
    const ev = JSON.parse(buf.toString()).traceEvents
    const names = {}
    for (const e of ev) if (e.ph == 'M' && e.name == 'thread_name') names[`${e.pid}:${e.tid}`] = e.args.name
    const main = Object.entries(names).find(([, n]) => n == 'CrRendererMain')?.[0]
    // per thread: busy time (top-level slices); on the main thread: self time per event name
    const byName = {}, threads = {}
    const byThread = {}
    for (const e of ev) if (e.ph == 'X' && e.dur != null && names[`${e.pid}:${e.tid}`]) (byThread[`${e.pid}:${e.tid}`] ||= []).push(e)
    for (const [k, list] of Object.entries(byThread)) {
      list.sort((a, b) => a.ts - b.ts || b.dur - a.dur)
      const stack = []
      for (const e of list) {
        while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop()
        if (!stack.length) threads[names[k]] = (threads[names[k]] || 0) + e.dur / 1000
        if (k == main) {
          byName[e.name] = (byName[e.name] || 0) + e.dur / 1000
          if (stack.length) byName[stack.at(-1).name] -= e.dur / 1000
        }
        stack.push(e)
      }
    }
    const per = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v / 180 >= 0.01).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / 180).toFixed(3)]))
    console.log(`${app} ${sc}${QUERY ? ' ' + QUERY : ''}: ms per frame (3 s = 180 frames)`)
    console.log('  main thread:', JSON.stringify(per(byName)))
    console.log('  threads:', JSON.stringify(per(threads)))
  }
  srv.close()
}
await browser.close()
