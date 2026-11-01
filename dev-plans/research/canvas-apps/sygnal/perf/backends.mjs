#!/usr/bin/env node
/**
 * README §5: own Canvas 2D painter vs Konva vs PixiJS on the same document, in Playwright Chromium
 * from the cache. `node perf/backends.mjs [--sizes=1000,10000] [--gpu]` (--gpu: ANGLE on Metal,
 * so WebGL runs on the GPU instead of SwiftShader; headless by default)
 */
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:http'
import {readFileSync, writeFileSync, mkdirSync, existsSync, statSync} from 'node:fs'
import {join, extname, resolve} from 'node:path'
import {execSync} from 'node:child_process'
import os from 'node:os'

const here = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(join(resolve(here, '../../../..'), 'browser-tests/package.json'))
const {chromium} = require('playwright')
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const SIZES = (args.sizes || '1000,5000,10000').split(',').map(Number)

if (!args['no-build']) execSync('npx vite build --config perf/backends.vite.mjs --logLevel warn', {cwd: here, stdio: 'inherit'})
const dir = join(here, 'dist-backends')
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}
const srv = createServer((req, res) => {
  let p = join(dir, new URL(req.url, 'http://x').pathname)
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'backends.html')
  res.writeHead(200, {'content-type': TYPES[extname(p)] || 'application/octet-stream'}); res.end(readFileSync(p))
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${srv.address().port}/backends.html`
const browser = await chromium.launch({headless: true, args: args.gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : []})
const out = {date: new Date().toISOString(), chromium: browser.version(), gpu: !!args.gpu, load: os.loadavg()[0], results: []}
console.log(`Chromium ${browser.version()} ${args.gpu ? '(ANGLE/Metal)' : '(default GL)'}; load ${os.loadavg().map(x => x.toFixed(1)).join(' ')}`)
console.log('backend   n      create  frame:move  move:layered   pan     hit/pt  heapMB')
for (const n of SIZES) for (const name of ['own', 'konva', 'pixi']) {
  const ctx = await browser.newContext({viewport: {width: 1200, height: 800}, deviceScaleFactor: 1})
  const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page)
  await page.goto(url)
  await page.waitForFunction(() => window.bench)
  await cdp.send('HeapProfiler.collectGarbage')
  const h0 = (await cdp.send('Runtime.getHeapUsage')).usedSize
  const r = await page.evaluate(([name, n]) => window.bench(name, n), [name, n])
  // the scene is still alive: its retained JS heap over the empty page's
  await cdp.send('HeapProfiler.collectGarbage')
  r.heapMB = Math.round(((await cdp.send('Runtime.getHeapUsage')).usedSize - h0) / 1048576 * 10) / 10
  await page.evaluate(() => window.teardown())
  out.results.push({name, n, ...r})
  const f = (v, w) => String(v ?? '–').padStart(w)
  console.log(name.padEnd(8) + f(n, 6) + f(r.create?.toFixed(1), 10) + f(r.frameMove, 12) + f(r.frameMoveLayered, 14) + f(r.framePan, 8) + f(r.hit, 10) + f(r.heapMB, 8) + (r.renderer ? '  ' + r.renderer : ''))
  await ctx.close()
}
await browser.close(); srv.close()
mkdirSync(join(here, 'perf/results'), {recursive: true})
writeFileSync(join(here, 'perf/results', `backends${args.gpu ? '-gpu' : ''}.json`), JSON.stringify(out, null, 2))
