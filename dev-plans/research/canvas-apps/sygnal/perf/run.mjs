#!/usr/bin/env node
/**
 * The Figma-lite benchmarks (README §2–§4), in Playwright Chromium from the cache (never downloaded).
 *
 *   node perf/run.mjs                       # every scenario of this build
 *   node perf/run.mjs --only=data           # scenarios whose name contains "data"
 *   node perf/run.mjs --runs=3 --moves=60
 *   node perf/run.mjs --react=<dir>         # also the React + react-konva baseline (its built dist/)
 *   node perf/run.mjs --throttle=4          # CDP CPU throttling
 *   node perf/run.mjs --zoom=1              # stress documents at 100 % (most shapes culled) instead of fitted
 *   node perf/run.mjs --max-load=12         # wait (≤ 10 min) for no other gate process and a 1-min load below this
 *
 * What it measures, per scenario (a document of n shapes, the build's own stress generator):
 * - startup: navigation start → the first canvas paint with the shapes (ms, in-page clock)
 * - heap: JS heap after a forced GC (MB), and DOM nodes (CDP)
 * - drag: real mouse input (CDP) — press on shape 0, `moves` moves of 3 px, one per frame, release.
 *   main ms/move = Δ CDP TaskDuration / moves: main-thread time per pointer move, whatever it
 *   was spent on (events, state, render, patch, paint, GC). frame p50/p95/max = rAF intervals
 *   during the drag (16.7 ms when nothing drops). paint ms = the canvas's own paint (this build).
 *
 * Results: perf/results/<name>.json and a table on stdout.
 */
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:http'
import {readFileSync, writeFileSync, mkdirSync, existsSync, statSync} from 'node:fs'
import {join, extname, resolve} from 'node:path'
import {execSync} from 'node:child_process'
import os from 'node:os'

const here = fileURLToPath(new URL('..', import.meta.url))
const repo = resolve(here, '../../../..')
const require = createRequire(join(repo, 'browser-tests/package.json'))
const {chromium} = require('playwright')

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const RUNS = +(args.runs || 1), MOVES = +(args.moves || 60), MAX_LOAD = +(args['max-load'] || 0)
const SIZES = (args.sizes || '1000,5000,10000').split(',').map(Number)

// ------------------------------------------------------------ static servers for the built apps

const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2'}
function serve(dir) {
  return new Promise(ok => {
    const srv = createServer((req, res) => {
      let p = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
      if (!existsSync(p) || statSync(p).isDirectory()) p = join(dir, 'index.html')
      res.writeHead(200, {'content-type': TYPES[extname(p)] || 'application/octet-stream'})
      res.end(readFileSync(p))
    })
    srv.listen(0, '127.0.0.1', () => ok({srv, url: `http://127.0.0.1:${srv.address().port}/`}))
  })
}

// another session's gate (vitest, the browser suite, check-live, the perf gate) running on this machine
const GATES = /vitest|check-live|perf-gate|test-examples|browser-tests\/|size-gate|astro build/
const foreignGate = () => {
  try { return execSync('ps -Ao pid,command', {encoding: 'utf8'}).split('\n').filter(l => GATES.test(l) && !l.includes(String(process.pid)) && !/perf\/run\.mjs|perf\/backends\.mjs/.test(l)).length > 0 } catch (_) { return false }
}
// this machine idles at a load of ~10 (a Docker VM, media analysis): wait for no other gate and a
// 1-min load under --max-load, at most 10 minutes, then measure and note it
async function waitForQuiet() {
  if (!MAX_LOAD) return {gate: foreignGate()}
  const t0 = Date.now()
  while (foreignGate() || os.loadavg()[0] > MAX_LOAD) {
    if (Date.now() - t0 > 600_000) { console.warn(`busy after 10 min (load ${os.loadavg()[0].toFixed(1)}, gate ${foreignGate()}): measuring anyway`); break }
    await new Promise(r => setTimeout(r, 10_000))
  }
  return {gate: foreignGate()}
}

// ------------------------------------------------------------ per build: how to open n shapes and find shape 0

const builds = {
  sygnal: {
    dir: join(here, 'dist'),
    build: () => execSync('npx vite build --config vite.config.mjs --logLevel warn', {cwd: here, stdio: 'inherit'}),
    url: (base, n, o) => `${base}?shapes=${n}&render=${o.render || 'data'}&input=${o.input || 'queue'}&repaint=${o.repaint || 'layers'}${args.zoom ? '&zoom=' + args.zoom : ''}`,
    // ready: the canvas painted the document; returns [first paint ms, shape 0's centre in page px]
    ready: async page => {
      await page.waitForFunction(() => { const i = document.querySelector('.board')?.__sw?.i; return i && i.st.first > 0 }, null, {timeout: 120_000})
      return page.evaluate(() => {
        const b = document.querySelector('.board'), i = b.__sw.i, r = b.getBoundingClientRect(), c = i.camera
        const s = window.__app.__runtime.getState().shapes.find(x => x.id === 's0')
        return {first: i.st.first, x: r.left + (s.x + s.width / 2 - c.x) * c.zoom, y: r.top + (s.y + s.height / 2 - c.y) * c.zoom}
      })
    },
    paintMs: page => page.evaluate(() => document.querySelector('.board').__sw.i.st.ms),
  },
}

// the React + react-konva baseline: dist/ of its folder, the same URL protocol if it has one (see README)
if (args.react) {
  const dir = resolve(String(args.react))
  builds.react = {
    dir: join(dir, 'dist'),
    build: () => execSync('npx vite build --logLevel warn', {cwd: dir, stdio: 'inherit'}),
    url: (base, n) => `${base}?shapes=${n}`,
    ready: async page => {
      // react-konva: the stage's canvas exists and the page reports its shapes (window.__bench, see README)
      await page.waitForFunction(() => window.__bench?.ready?.(), null, {timeout: 120_000})
      return page.evaluate(() => window.__bench.shape0())
    },
    paintMs: () => null,
  }
}

// ------------------------------------------------------------ one scenario

async function measure(browser, base, b, n, o) {
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1})
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  // --throttle=4: CDP CPU throttling (a mid-range laptop's main thread, roughly)
  if (args.throttle) await cdp.send('Emulation.setCPUThrottlingRate', {rate: +args.throttle})
  await page.goto(b.url(base, n, o))
  const at = await b.ready(page)
  await page.waitForTimeout(300)
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576
  const dom = (await cdp.send('Memory.getDOMCounters')).nodes
  // the frame recorder
  await page.evaluate(() => { window.__frames = []; let last = 0; const loop = t => { if (last) window.__frames.push(t - last); last = t; window.__rafId = requestAnimationFrame(loop) }; window.__rafId = requestAnimationFrame(loop) })
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const nextFrame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())))
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await nextFrame()
  await page.evaluate(() => { window.__frames = [] })
  const m0 = await metric(), w0 = Date.now()
  const paints = []
  for (let i = 1; i <= MOVES; i++) {
    await page.mouse.move(at.x + i * 3, at.y + i * 1.5)
    await nextFrame()
    const pm = await b.paintMs(page)
    if (pm != null) paints.push(pm)
  }
  const m1 = await metric(), wall = (Date.now() - w0) / MOVES
  await page.mouse.up()
  await nextFrame()
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.__rafId); return window.__frames })
  // the drag really moved shape 0 (the app's own state)
  const moved = await page.evaluate(() => window.__bench?.moved?.() ?? (() => { const s = window.__app?.__runtime.getState().shapes.find(x => x.id === 's0'); return s ? s.x !== 0 : null })())
  await ctx.close()
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null }
  const r1 = x => x == null ? null : Math.round(x * 10) / 10
  return {
    startup: r1(at.first), heapMB: r1(heap), dom,
    mainPerMove: r1((m1.TaskDuration - m0.TaskDuration) * 1000 / MOVES),
    scriptPerMove: r1((m1.ScriptDuration - m0.ScriptDuration) * 1000 / MOVES),
    framesP50: r1(q(frames, 0.5)), framesP95: r1(q(frames, 0.95)), framesMax: r1(Math.max(...frames)),
    paintP50: r1(q(paints, 0.5)), wallPerMove: r1(wall), moved,
  }
}

// ------------------------------------------------------------ the scenarios

const SCENARIOS = [
  // §2: per-shape cost. Shapes as data (one element) vs one Collection item per shape
  ...SIZES.map(n => ({build: 'sygnal', name: `data ${n}`, n, o: {render: 'data'}})),
  ...SIZES.map(n => ({build: 'sygnal', name: `collection ${n}`, n, o: {render: 'collection'}})),
  // §3: the drag through the action queue (above) vs the transient channel (follow)
  ...SIZES.map(n => ({build: 'sygnal', name: `data+transient ${n}`, n, o: {render: 'data', input: 'transient'}})),
  // §4: repaint everything each frame vs the static layer + live layer
  ...SIZES.map(n => ({build: 'sygnal', name: `data+full-repaint ${n}`, n, o: {render: 'data', repaint: 'full'}})),
  ...(builds.react ? SIZES.map(n => ({build: 'react', name: `react-konva ${n}`, n, o: {}})) : []),
]

const only = args.only ? String(args.only) : null
const todo = SCENARIOS.filter(s => !only || s.name.includes(only))
const used = [...new Set(todo.map(s => s.build))]
if (!args['no-build']) for (const b of used) builds[b].build()
const servers = {}
for (const b of used) servers[b] = await serve(builds[b].dir)

// a browser per run, launched after the wait (another session's gate may stop stray browsers)
const probe = await chromium.launch({headless: true}), version = probe.version()
await probe.close()
const out = {date: new Date().toISOString(), throttle: +(args.throttle || 1), moves: MOVES, runs: RUNS, chromium: version, cpus: os.cpus().length, results: []}
console.log(`Chromium ${version}, ${MOVES} moves, ${RUNS} run(s); load ${os.loadavg().map(x => x.toFixed(1)).join(' ')}`)
console.log('scenario'.padEnd(26) + 'startup  heapMB   dom  main/move script/move  frame p50/p95/max   paint  load')
for (const s of todo) {
  const runs = []
  for (let r = 0; r < RUNS; r++) {
    const {gate} = await waitForQuiet()
    const load = os.loadavg()[0]
    const browser = await chromium.launch({headless: true})
    try { runs.push({...(await measure(browser, servers[s.build].url, builds[s.build], s.n, s.o)), load: Math.round(load * 10) / 10, gate}) }
    finally { await browser.close().catch(() => {}) }
  }
  // the median run by main-thread time per move
  const med = [...runs].sort((a, b) => a.mainPerMove - b.mainPerMove)[Math.floor(runs.length / 2)]
  out.results.push({...s, ...med, runs})
  const f = (v, w) => String(v ?? '–').padStart(w)
  console.log(s.name.padEnd(26) + f(med.startup, 7) + f(med.heapMB, 8) + f(med.dom, 6) + f(med.mainPerMove, 11) + f(med.scriptPerMove, 12) + `  ${f(med.framesP50, 5)}/${f(med.framesP95, 5)}/${f(med.framesMax, 5)}` + f(med.paintP50, 8) + f(med.load, 6) + (med.gate ? ' (another gate ran)' : '') + (med.moved === false ? '  (did not move!)' : ''))
}
for (const s of Object.values(servers)) s.srv.close()
mkdirSync(join(here, 'perf/results'), {recursive: true})
const file = join(here, 'perf/results', (args.out || 'latest') + '.json')
writeFileSync(file, JSON.stringify(out, null, 2))
console.log('→', file)
