// Where the kanban bundle's bytes come from: builds examples/kanban (minified, nativeGlobalThis:
// false as the size gate's (a)) with source maps, maps every output byte back to its source file
// (through dist/*.map to src/*.ts), and prints minified bytes per source plus a gzip estimate
// (each source's bytes gzipped alone; the sum is above the bundle's real gzip).
//   node dev-plans/research/compile-wasm/size/attribute.mjs [--top=40]
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'

const repo = path.resolve(import.meta.dirname, '../../../..')
const kanban = path.join(repo, 'examples/kanban')
const req = createRequire(path.join(kanban, 'package.json'))
const vite = await import(pathToFileURL(req.resolve('vite')).href)
const sygnal = (await import(pathToFileURL(req.resolve('sygnal/vite')).href)).default
const { SourceMapConsumer } = await import(pathToFileURL(createRequire(path.join(repo, 'benchmarks/package.json')).resolve('source-map-js')).href)
const TOP = +(process.argv.find(a => a.startsWith('--top='))?.slice(6) ?? 40)

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-attr-'))
await vite.build({ root: kanban, configFile: false, logLevel: 'warn', plugins: [sygnal({ nativeGlobalThis: false })], build: { outDir, emptyOutDir: true, sourcemap: true } })
const assets = path.join(outDir, 'assets')
const js = fs.readdirSync(assets).find(f => /^index-.*\.js$/.test(f))
const code = fs.readFileSync(path.join(assets, js), 'utf8')
const map = new SourceMapConsumer(JSON.parse(fs.readFileSync(path.join(assets, js + '.map'), 'utf8')))
const dmaps = new Map()
const second = (file) => {
  if (!dmaps.has(file)) { const m = file + '.map'; dmaps.set(file, fs.existsSync(m) ? new SourceMapConsumer(JSON.parse(fs.readFileSync(m, 'utf8'))) : null) }
  return dmaps.get(file)
}
// one segment per mapping: [genLine, genCol] .. next mapping
const segs = []
map.eachMapping(m => segs.push(m))
const lines = code.split('\n')
const bySrc = new Map()
const add = (src, text) => bySrc.set(src, (bySrc.get(src) || '') + text)
for (let i = 0; i < segs.length; i++) {
  const m = segs[i], n = segs[i + 1]
  const line = lines[m.generatedLine - 1]
  const end = n && n.generatedLine === m.generatedLine ? n.generatedColumn : line.length
  const text = line.slice(m.generatedColumn, end)
  let src = m.source ? path.resolve(assets, m.source) : '(unmapped)'
  if (m.source && /\/dist\//.test(src)) {
    const c = second(src)
    const o = c && c.originalPositionFor({ line: m.originalLine, column: m.originalColumn })
    if (o?.source) src = path.resolve(path.dirname(src), o.source)
  }
  add(path.relative(repo, src).replace(/^.*node_modules\//, 'npm:'), text)
}
const rows = [...bySrc].map(([s, t]) => [s, t.length, zlib.gzipSync(t).length]).sort((a, b) => b[1] - a[1])
const total = code.length, gz = zlib.gzipSync(code).length
console.log(`kanban bundle: ${total} B min, ${gz} B gzip (zlib); ${rows.length} sources\n`)
const group = (re) => rows.filter(r => re.test(r[0])).reduce((a, r) => a + r[1], 0)
for (const [label, re] of [['src/core', /^src\/core\//], ['src/pragma', /^src\/pragma\//], ['src/cycle/dom', /^src\/cycle\/dom\//], ['src/cycle (other)', /^src\/cycle\/(?!dom)/], ['src/extra', /^src\/extra\//], ['npm:snabbdom', /^npm:snabbdom/], ['npm:xstream', /^npm:xstream/], ['npm (other)', /^npm:(?!snabbdom|xstream)/], ['app', /^examples\//]])
  console.log(`${label.padEnd(20)} ${String(group(re)).padStart(7)} B min`)
console.log('\nminified B   gzip-alone B   source')
for (const [s, b, g] of rows.slice(0, TOP)) console.log(`${String(b).padStart(10)} ${String(g).padStart(14)}   ${s}`)
fs.rmSync(outDir, { recursive: true, force: true })
