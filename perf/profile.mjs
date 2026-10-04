// CPU-profiles one benchmark op on the unminified build (node build.mjs --profile) and
// attributes self time to original source (through the app's source map, then Sygnal's own
// dist source map back to src/*.ts).
//   node profile.mjs --fw=sygnal --page=table-coll --op="select row (1k)" [--repeat=5] [--top=40] [--trail=300]
import { chromium } from 'playwright'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { SourceMapConsumer } from 'source-map-js'
import { serve } from './lib/server.mjs'
import { HELPERS, OPS } from './lib/ops.mjs'

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const FW = arg('fw', 'sygnal'), PAGE = arg('page', 'table'), OPNAME = arg('op', 'select row (1k)')
const REPEAT = +arg('repeat', 5), TOP = +arg('top', 40), TRAIL = +arg('trail', 300)
const DIST = resolve(import.meta.dirname, arg('dist', 'dist-profile'))
const REPO = resolve(import.meta.dirname, '..')
const op = Object.values(OPS).flat().find(o => o.name === OPNAME)
if (!op) throw new Error(`no op ${OPNAME}`)

// --- source mapping (two hops) ---
const consumers = new Map()
function consumerFor(file) {
  if (!consumers.has(file)) {
    const map = file + '.map'
    consumers.set(file, existsSync(map) ? new SourceMapConsumer(JSON.parse(readFileSync(map, 'utf8'))) : null)
  }
  return consumers.get(file)
}
function mapPos(file, line, column) {
  // line: 1-based, column: 0-based
  let cur = { file, line, column, name: null }
  for (let hop = 0; hop < 3; hop++) {
    const c = consumerFor(cur.file)
    if (!c) break
    const o = c.originalPositionFor({ line: cur.line, column: cur.column })
    if (!o.source) break
    const src = resolve(dirname(cur.file), o.source)
    cur = { file: src, line: o.line, column: o.column, name: o.name || cur.name }
  }
  return cur
}
const short = (f) => {
  const r = relative(REPO, f)
  const nm = r.lastIndexOf('node_modules/')
  return nm >= 0 ? r.slice(nm + 13) : r
}
const bucket = (f) => {
  const s = short(f)
  if (s.startsWith('src/')) return s
  const m = s.match(/^(@[^/]+\/[^/]+|[^/]+)/)
  return m ? m[1] : s
}

const server = await serve(DIST)
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] })
const ctx = await browser.newContext()
const p = await ctx.newPage()
p.on('pageerror', e => console.log('pageerror', e.message))
await p.addInitScript(HELPERS)
await p.goto(`${server.url}/${FW}/apps/${FW}/${PAGE}.html`)
await p.waitForFunction(() => document.querySelector('#main')?.children.length > 0)
const cdp = await ctx.newCDPSession(p)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 50 })

const self = new Map() // key -> ms
const incl = new Map() // key -> ms (each function once per sample stack)
const keyCache = new Map()
function keyOf(cf) {
  const ck = `${cf.url}|${cf.lineNumber}|${cf.columnNumber}|${cf.functionName}`
  if (keyCache.has(ck)) return keyCache.get(ck)
  let key, file = 'native/other'
  if (cf.url && cf.url.startsWith(server.url)) {
    const local = resolve(DIST, '.' + new URL(cf.url).pathname)
    const m = mapPos(local, cf.lineNumber + 1, cf.columnNumber)
    file = m.file
    key = `${cf.functionName || '(anon)'}  ${short(m.file)}:${m.line}`
  } else {
    key = `${cf.functionName || '(anon)'}  [${cf.url ? 'page' : 'native'}]`
  }
  const r = { key, file }
  keyCache.set(ck, r)
  return r
}
const byFile = new Map()
let total = 0, idle = 0, gc = 0, program = 0
const lat = []
let lastProfile
for (let i = 0; i < REPEAT + 1; i++) {
  await p.evaluate(`(async () => { const h = window.__h; ${op.setup} })()`)
  await p.evaluate('window.gc && window.gc()')
  if (i > 0) await cdp.send('Profiler.start')
  lat.push(await p.evaluate(`(() => { const h = window.__h; return h.measure(() => { ${op.act} }, () => (${op.done})) })()`))
  await p.waitForTimeout(TRAIL)
  if (i === 0) continue // warmup
  const { profile } = await cdp.send('Profiler.stop')
  lastProfile = profile
  const nodes = new Map(profile.nodes.map(n => [n.id, n]))
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id)
  const dt = new Map()
  for (let k = 0; k < profile.samples.length; k++) {
    const id = profile.samples[k]
    dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[k + 1] ?? 0) / 1000)
  }
  for (const [id, ms] of dt) {
    const n = nodes.get(id), cf = n.callFrame
    total += ms
    if (cf.functionName === '(idle)') { idle += ms; continue }
    if (cf.functionName === '(garbage collector)') { gc += ms; continue }
    if (cf.functionName === '(program)') { program += ms; continue }
    const { key, file } = keyOf(cf)
    const seen = new Set()
    for (let a = id; a !== undefined; a = parent.get(a)) {
      const k = keyOf(nodes.get(a).callFrame).key
      if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + ms) }
    }
    self.set(key, (self.get(key) || 0) + ms)
    const b = file === 'native/other' ? `native: ${cf.functionName}` : bucket(file)
    byFile.set(b, (byFile.get(b) || 0) + ms)
  }
}
const busy = total - idle
const pct = (x) => `${(x / busy * 100).toFixed(1).padStart(5)}%`
const per = (x) => (x / REPEAT).toFixed(2).padStart(8)
console.log(`\n${FW}/${PAGE} :: ${OPNAME}  (${REPEAT} runs, ${TRAIL} ms trailing window)`)
console.log(`latency median ${lat.slice(1).sort((a, b) => a - b)[lat.length >> 1].toFixed(1)} ms; busy ${(busy / REPEAT).toFixed(1)} ms/run (gc ${(gc / REPEAT).toFixed(1)}, program ${(program / REPEAT).toFixed(1)})`)
console.log(`\n-- self time by module (ms/run, % of busy) --`)
for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`${per(v)} ${pct(v)}  ${k}`)
console.log(`\n-- top ${TOP} functions by self time --`)
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${per(v)} ${pct(v)}  ${k}`)
if (process.argv.includes('--inclusive')) {
  console.log(`\n-- top ${TOP} functions by inclusive time (Sygnal src only) --`)
  for (const [k, v] of [...incl].filter(([k]) => / src\//.test(k)).sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${per(v)} ${pct(v)}  ${k}`)
}
mkdirSync(resolve(import.meta.dirname, 'results/profiles'), { recursive: true })
const out = resolve(import.meta.dirname, `results/profiles/${FW}-${PAGE}-${OPNAME.replace(/[^a-z0-9]+/gi, '_')}.cpuprofile`)
writeFileSync(out, JSON.stringify(lastProfile))
console.log(`\nsaved ${relative(process.cwd(), out)}`)
await browser.close()
server.close()
