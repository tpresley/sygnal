#!/usr/bin/env node
/**
 * Where a drag's main-thread time goes: a CPU profile (CDP) of `moves` moves of a selection
 * through the bench contract, on an unminified build (dist-prof/), top functions by self time.
 *   node perf/profile.mjs [--n=10000] [--select=all] [--moves=40] [--query=input=transient]
 */
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:http'
import {readFileSync, existsSync, statSync} from 'node:fs'
import {join, extname, resolve} from 'node:path'
import {execSync} from 'node:child_process'

const here = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(join(resolve(here, '../../../..'), 'browser-tests/package.json'))
const {chromium} = require('playwright')
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const N = +(args.n || 10000), SEL = args.select == null ? 'all' : (args.select == 'all' ? 'all' : +args.select), MOVES = +(args.moves || 40)
if (!args['no-build']) execSync('npx vite build --config vite.config.mjs --minify false --outDir dist-prof --logLevel warn', {cwd: here, stdio: 'inherit'})
const dir = join(here, 'dist-prof')
const srv = createServer((req, res) => {
  let p = join(dir, new URL(req.url, 'http://x').pathname)
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html')
  res.writeHead(200, {'content-type': {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}[extname(p)] || 'application/octet-stream'}); res.end(readFileSync(p))
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({headless: true})
const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1})
const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page)
await page.goto(`http://127.0.0.1:${srv.address().port}/${args.query ? '?' + args.query : ''}`)
await page.waitForFunction(() => window.__canvasBench)
await page.evaluate(n => window.__canvasBench.generate(n), N)
await page.evaluate(s => window.__canvasBench.select(s), SEL)
const at = await page.evaluate(() => window.__canvasBench.dragPoint())
await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 6, at.y + 6)
await page.evaluate(() => window.__canvasBench.frame())
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', {interval: 100}); await cdp.send('Profiler.start')
for (let i = 1; i <= MOVES; i++) { await page.mouse.move(at.x + 6 + 160 * Math.sin(i / 10), at.y + 6 + 110 * Math.sin(i / 8)); await page.evaluate(() => window.__canvasBench.frame()) }
const {profile} = await cdp.send('Profiler.stop')
await page.mouse.up()
const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]))
const dt = profile.timeDeltas, total = (profile.endTime - profile.startTime) / 1000
profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000) })
const top = [...self].filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25)
console.log(`${N} shapes, select ${SEL}, ${MOVES} moves: ${total.toFixed(0)} ms profiled; idle ${((self.get('(idle) :0') || 0)).toFixed(0)} ms`)
for (const [k, ms] of top) console.log(`${(ms / MOVES).toFixed(2).padStart(7)} ms/move  ${k}`)
await browser.close(); srv.close()
