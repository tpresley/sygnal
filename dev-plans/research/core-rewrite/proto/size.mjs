// Spike 0-S: size of the prototype core.
//   node dev-plans/research/core-rewrite/proto/size.mjs     (after npm run build + npm install --prefix examples/kanban)
// 1. examples/kanban (unchanged components) on the current core and on the prototype, built as
//    scripts/size-gate.mjs does: kanban's Vite, sygnal({ nativeGlobalThis: false }), gzip -c | wc -c
// 2. the prototype's own modules, minified (esbuild) + gzip, one by one and bundled together
//    (sygnal external)
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const here = import.meta.dirname
const repo = path.resolve(here, '../../../..')
const kanban = path.join(repo, 'examples', 'kanban')
const req = createRequire(path.join(kanban, 'package.json'))
const vite = await import(pathToFileURL(req.resolve('vite')).href)
const sygnal = (await import(pathToFileURL(req.resolve('sygnal/vite')).href)).default
const esbuild = await import(pathToFileURL(path.join(repo, 'node_modules/esbuild/lib/main.js')).href)

const gz = (buf) => {
  const tmp = path.join(os.tmpdir(), `p46-size-${process.pid}-${Math.random()}.js`)
  fs.writeFileSync(tmp, buf)
  const r = spawnSync('gzip', ['-c', tmp], { maxBuffer: 64 * 1024 * 1024 })
  fs.rmSync(tmp)
  return r.status === 0 ? r.stdout.length : zlib.gzipSync(buf).length
}

async function app(root, alias) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p46-size-'))
  try {
    await vite.build({
      root, configFile: false, logLevel: 'warn',
      plugins: [sygnal({ nativeGlobalThis: false })],
      resolve: alias ? { alias: [{ find: /^sygnal$/, replacement: path.join(repo, 'dist/index.esm.js') }] } : undefined,
      build: { outDir, emptyOutDir: true },
    })
    const assets = path.join(outDir, 'assets')
    const files = fs.readdirSync(assets).filter(f => /^index-.*\.js$/.test(f))
    const buf = fs.readFileSync(path.join(assets, files[0]))
    return { raw: buf.length, gzip: gz(buf), code: buf.toString() }
  } finally { fs.rmSync(outDir, { recursive: true, force: true }) }
}

const cur = await app(kanban, false)
const next = await app(path.join(here, 'kanban-next'), true)
const fmt = (n) => n.toLocaleString('en-US')
console.log('kanban production bundle (nativeGlobalThis: false), gzip -c | wc -c:')
console.log(`  current core   ${fmt(cur.gzip)} B  (raw ${fmt(cur.raw)})`)
console.log(`  prototype core ${fmt(next.gzip)} B  (raw ${fmt(next.raw)})  delta ${fmt(next.gzip - cur.gzip)} B`)
// what of the current core is still in the prototype build (tree-shaking leftovers)
for (const marker of ['sygnal.ABORT', '_remove=function', 'pickCombine', 'makeCollection', 'instantiateCollection', 'withState']) {
  console.log(`    marker ${marker.padEnd(22)} current ${cur.code.includes(marker) ? 'yes' : 'no '}  prototype ${next.code.includes(marker) ? 'yes' : 'no'}`)
}

const mods = ['runtime', 'define', 'cell', 'instance', 'hosts', 'statics', 'registry', 'markers', 'uses']
let sum = 0
console.log('\nprototype modules, esbuild minify (no bundling) + gzip:')
for (const m of mods) {
  const r = await esbuild.build({ entryPoints: [path.join(here, m + '.ts')], bundle: false, minify: true, format: 'esm', write: false, target: 'es2020' })
  const code = r.outputFiles[0].contents
  const g = gz(Buffer.from(code))
  sum += g
  console.log(`  ${(m + '.ts').padEnd(14)} ${fmt(code.length).padStart(7)} B min  ${fmt(g).padStart(6)} B gzip`)
}
console.log(`  ${'sum'.padEnd(14)} ${''.padStart(7)}        ${fmt(sum).padStart(6)} B gzip (per-file gzip; sum overstates)`)
for (const [label, entries] of [['core (core-next.ts: runtime..hosts, statics)', ['core-next.ts']], ['core + markers + uses', ['core-next.ts', 'markers.ts', 'uses.ts']]]) {
  const stdin = { contents: entries.map(e => `export * from './${e}'`).join('\n'), resolveDir: here, loader: 'ts' }
  const r = await esbuild.build({ stdin, bundle: true, minify: true, format: 'esm', write: false, target: 'es2020', external: ['sygnal'] })
  const code = r.outputFiles[0].contents
  console.log(`  bundled: ${label.padEnd(46)} ${fmt(code.length).padStart(7)} B min  ${fmt(gz(Buffer.from(code))).padStart(6)} B gzip`)
}
