/**
 * The canvas-game perf runner: the platformer (examples/platformer, production build) and the
 * plain-JS baseline (../baseline, production build) in Chromium, the same scenarios and inputs.
 *
 *   npm --prefix examples/platformer run build
 *   node examples/platformer/node_modules/vite/bin/vite.js build --config dev-plans/research/canvas-game/baseline/vite.config.js
 *   node dev-plans/research/canvas-game/perf/run.mjs [--secs=10] [--runs=3] [--only=sygnal|baseline] [--scenarios=level,stress100,stress300,stress1000,stress2000]
 *   node dev-plans/research/canvas-game/perf/run.mjs --cpu=4 --label=cpu4                  (CPU throttled ×4)
 *   node dev-plans/research/canvas-game/perf/run.mjs --url=http://localhost:5190/ --label=dev   (a running server: the dev build)
 *
 * Per scenario and app: 2 s warm-up, then `secs` seconds measured with a V8 CPU profile (100 µs
 * sampling) running. Frame intervals come from a requestAnimationFrame loop in the page
 * (window.__bench), the simulation time from sim.ts's counters, the paint time from the canvas's
 * own stats (Sygnal) or the loop's (baseline). The CPU profile's samples are attributed through the
 * bundles' source maps to: the game's sim, the game's node building, sygnal core, sygnal/canvas,
 * xstream, snabbdom, native calls (Canvas 2D, DOM), GC, other, idle.
 *
 * `level`: the meadow level with an autopilot (→ + sprint held, a jump every 0.9 s); `stressN`:
 * the one-screen arena with N enemies (all in view, all moving).
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const require = createRequire(path.join(repo, 'package.json'))
const {chromium} = await import(path.join(repo, 'browser-tests/node_modules/playwright/index.mjs'))
const {TraceMap, originalPositionFor} = require('@jridgewell/trace-mapping')

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d
const SECS = Number(arg('secs', 10)), RUNS = Number(arg('runs', 1))
const SCENARIOS = arg('scenarios', 'level,stress100,stress300,stress1000,stress2000').split(',')
const APPS = {sygnal: path.join(repo, 'examples/platformer/dist'), baseline: path.join(here, '../baseline/dist')}
const only = arg('only', '')
// more query parameters for the app (e.g. --query=paint=lazy) and a label for the results
const QUERY = arg('query', ''), LABEL = arg('label', '')
// --cpu=4: Chromium's CPU throttling (a slower device), set before the page loads
const CPU = Number(arg('cpu', 1))

// ---------------------------------------------------------------- static servers
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json'}
function serve(dir) {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
      const f = fs.existsSync(p) && fs.statSync(p).isFile() ? p : path.join(dir, 'index.html')
      rsp.writeHead(200, {'content-type': TYPES[path.extname(f)] || 'application/octet-stream'})
      fs.createReadStream(f).pipe(rsp)
    })
    s.listen(0, () => res({url: `http://localhost:${s.address().port}/`, close: () => s.close()}))
  })
}

// ---------------------------------------------------------------- attribution
const maps = new Map()
async function traceFor(url) {
  if (maps.has(url)) return maps.get(url)
  let tm = null
  try {
    const js = await (await fetch(url)).text()
    const m = /\/\/# sourceMappingURL=(\S+)/.exec(js)
    if (m) tm = new TraceMap(await (await fetch(new URL(m[1], url))).text())
  } catch (_) {}
  maps.set(url, tm)
  return tm
}
function category(src, fn) {
  if (!src) {
    if (fn == '(garbage collector)') return 'GC'
    if (fn == '(idle)') return 'idle'
    if (fn == '(program)') return 'program'
    if (fn == '(root)') return 'idle'
    return 'native (Canvas 2D, DOM)'
  }
  // the game (production maps: src/x.ts; the dev server: x.ts; the baseline: main.ts)
  const game = /(?:^|\/)(?:src\/)?(sim|nodes|bench|Game|keys|level|main)\.tsx?(\?.*)?$/.exec(src)
  if (game && !/\.\.\/src\/(core|cycle|extra|pragma|canvas)\//.test(src)) return game[1] == 'sim' ? 'game: sim' : game[1] == 'nodes' ? 'game: nodes' : game[1] == 'bench' ? 'bench probe' : 'game: view / loop'
  if (/xstream/.test(src)) return 'xstream'
  if (/snabbdom/.test(src)) return 'snabbdom'
  if (/dist\/canvas\.esm\.js|src\/canvas\/|src\/extra\/(pointer|controlled)\.ts/.test(src)) return 'sygnal/canvas'
  if (/src\/extra\/(diagnostics|devtools|devGraph|devMcp)/.test(src)) return 'sygnal dev tooling'
  if (/dist\/[\w-]+\.esm\.js|\/src\/(core|cycle|extra|pragma|jsx)/.test(src)) return 'sygnal core'
  return 'other: ' + src.replace(/.*node_modules\//, '')
}
async function attribute(profile) {
  const self = new Map()
  for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0))
  const out = {}, fns = {}
  for (const n of profile.nodes) {
    const us = self.get(n.id)
    if (!us) continue
    const cf = n.callFrame
    let src = '', name = cf.functionName || '(anonymous)'
    if (cf.url && /^http/.test(cf.url)) {
      const tm = await traceFor(cf.url)
      const p = tm && originalPositionFor(tm, {line: cf.lineNumber + 1, column: cf.columnNumber})
      src = p?.source || cf.url
      if (p?.name) name = p.name
    } else if (cf.url) src = cf.url
    const c = category(src, cf.functionName)
    out[c] = (out[c] || 0) + us / 1000
    const k = `${c} | ${name} (${src.replace(/.*\/(src|dist)\//, '$1/')})`
    fns[k] = (fns[k] || 0) + us / 1000
  }
  return {byCategory: out, top: Object.entries(fns).sort((a, b) => b[1] - a[1]).slice(0, 25)}
}

// ---------------------------------------------------------------- one measurement
const stats = (xs) => {
  if (!xs.length) return {}
  const s = [...xs].sort((a, b) => a - b), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return {n: xs.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1]}
}
async function measure(browser, base, scenario) {
  const page = await browser.newPage({viewport: {width: 800, height: 520}})
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  if (CPU > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', {rate: CPU})
  const stress = /^stress(\d+)$/.exec(scenario)
  await page.goto(base + '?bench' + (stress ? `&stress=${stress[1]}` : '') + (QUERY ? '&' + QUERY : ''))
  await page.waitForFunction(() => window.__bench)
  let pilot = null
  if (!stress) {
    await page.keyboard.press('Enter')
    await page.keyboard.down('ArrowRight')
    await page.keyboard.down('ShiftLeft')
    let on = true
    pilot = (async () => {
      while (on) {
        await page.keyboard.down('Space'); await page.waitForTimeout(450)
        await page.keyboard.up('Space'); await page.waitForTimeout(450)
      }
    })()
    pilot.stop = () => { on = false }
  }
  await page.waitForTimeout(2000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', {interval: 100})
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize
  await page.evaluate(() => window.__bench.reset())
  await cdp.send('Profiler.start')
  const heap = []
  for (let i = 0; i < SECS; i++) { await page.waitForTimeout(1000); heap.push(Math.round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1024)) }
  const {profile} = await cdp.send('Profiler.stop')
  const b = await page.evaluate(() => window.__bench.read())
  const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize
  if (pilot) { pilot.stop(); await pilot }
  const att = await attribute(profile)
  await page.close()
  const frames = b.frames, wall = (profile.endTime - profile.startTime) / 1000
  const busy = Object.entries(att.byCategory).filter(([k]) => k != 'idle').reduce((a, [, v]) => a + v, 0)
  return {
    scenario, frames: stats(frames), dropped: frames.filter(f => f > 1.5 * 1000 / 60).length,
    fps: frames.length / (frames.reduce((a, c) => a + c, 0) / 1000), paint: stats(b.paints),
    simMsPerFrame: b.simMs / frames.length, stepsPerFrame: b.steps / frames.length,
    busyMsPerFrame: busy / frames.length, wallMs: wall, mode: b.state,
    perFrame: Object.fromEntries(Object.entries(att.byCategory).sort((a, c) => c[1] - a[1]).map(([k, v]) => [k, +(v / frames.length).toFixed(3)])),
    heapDeltaKB: Math.round((heap1 - heap0) / 1024), heapKB: heap, top: att.top, errors,
  }
}

// ---------------------------------------------------------------- main
const results = []
const browser = await chromium.launch({args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling']})
const given = arg('url', '')
for (const [app, dir] of given ? [[arg('label', 'url'), given]] : Object.entries(APPS)) {
  if (only && only != app) continue
  if (!given && !fs.existsSync(path.join(dir, 'index.html'))) { console.error(`${app}: no build at ${dir}`); continue }
  const srv = given ? {url: given, close() {}} : await serve(dir)
  for (const sc of SCENARIOS) for (let r = 0; r < RUNS; r++) {
    const m = await measure(browser, srv.url, sc)
    results.push({app: LABEL && !given ? `${app}:${LABEL}` : app, query: QUERY, cpu: CPU, run: r, ...m})
    const pf = Object.entries(m.perFrame).filter(([k]) => k != 'idle').map(([k, v]) => `${k} ${v}`).join(', ')
    console.log(`${app.padEnd(8)} ${sc.padEnd(10)} fps ${m.fps.toFixed(1)}  frame p50 ${m.frames.p50?.toFixed(1)} p99 ${m.frames.p99?.toFixed(1)} max ${m.frames.max?.toFixed(1)}  dropped ${m.dropped}/${m.frames.n}  busy ${m.busyMsPerFrame.toFixed(2)} ms/frame  sim ${m.simMsPerFrame.toFixed(3)}  paint p50 ${m.paint.p50?.toFixed(2)}  heapΔ ${m.heapDeltaKB} KB  mode ${m.mode}${m.errors.length ? '  ERR ' + m.errors[0] : ''}`)
    console.log(`         ${pf}`)
  }
  srv.close()
}
await browser.close()
const out = path.join(here, 'results', `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`)
fs.mkdirSync(path.dirname(out), {recursive: true})
fs.writeFileSync(out, JSON.stringify(results, null, 1))
console.log('→', path.relative(repo, out))
