// Per-app dead-code elimination probes on the size gate's bundle (examples/kanban, nativeGlobalThis:
// false). Each variant simulates what a compiling sygnal/vite could decide from the app's own
// source, by rewriting dist/index.esm.js as the app bundle loads it:
//   switchable  the app never names Switchable / <switchable>: drop the host registered on import
//   strict-reg  as switchable, plus Collection's host registered on first use (the app does use
//               Collection, so this only shows the registration's own cost: none expected)
//   noSvg       the app's JSX has no SVG tag: drop the pragma's SVG table and applySvg
//   msgs        upper bound for React-style message extraction: Sygnal's and xstream's prose
//               strings (>= 20 chars) replaced by "" (codes and docs links would stay)
//   node dev-plans/research/compile-wasm/size/dce.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const repo = path.resolve(import.meta.dirname, '../../../..')
const kanban = path.join(repo, 'examples/kanban')
const req = createRequire(path.join(kanban, 'package.json'))
const vite = await import(pathToFileURL(req.resolve('vite')).href)
const sygnal = (await import(pathToFileURL(req.resolve('sygnal/vite')).href)).default
const acorn = createRequire(path.join(repo, 'package.json'))('acorn')
const gz = (f) => spawnSync('gzip', ['-c', f], { maxBuffer: 1 << 26 }).stdout.length

const NPM = /intrinsic|Object\.keys|Function\.prototype|binder|use strict|async function|allowMissing|document fragment|Please file/
function stripProse(code) {
  const lits = []
  acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', onToken: t => { if (t.type.label === 'string' || t.type.label === 'template') lits.push(t) } })
  let out = code
  for (const t of lits.filter(t => typeof t.value === 'string' && t.value.length >= 20 && / \w/.test(t.value) && !NPM.test(t.value)).sort((a, b) => b.start - a.start)) out = out.slice(0, t.start) + (t.type.label === 'string' ? '""' : '') + out.slice(t.end)
  return out
}
const cut = (re) => (code) => { const n = code.replace(re, ''); if (n === code) throw new Error('no match: ' + re); return n }
const VARIANTS = {
  base: {},
  switchable: { lib: [cut(/^hosts\.switchable = .*;$/m)] },
  noSvg: { lib: [cut(/if \(t & 2\)\s*applySvg\(vnode\);/)] },
  'switchable+noSvg': { lib: [cut(/^hosts\.switchable = .*;$/m), cut(/if \(t & 2\)\s*applySvg\(vnode\);/)] },
  msgs: { out: stripProse },
}
async function measure(v) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-dce-'))
  const rewrite = { name: 'cw-dce', enforce: 'pre', transform(code, id) { if (/dist\/index\.esm\.js$/.test(id) && v.lib) return v.lib.reduce((c, f) => f(c), code) } }
  await vite.build({ root: kanban, configFile: false, logLevel: 'silent', plugins: [sygnal({ nativeGlobalThis: false }), rewrite], build: { outDir, emptyOutDir: true } })
  const dir = path.join(outDir, 'assets'), f = path.join(dir, fs.readdirSync(dir).find(f => /^index-.*\.js$/.test(f)))
  if (v.out) fs.writeFileSync(f, v.out(fs.readFileSync(f, 'utf8')))
  const r = { min: fs.statSync(f).size, gzip: gz(f) }
  fs.rmSync(outDir, { recursive: true, force: true })
  return r
}
const base = await measure(VARIANTS.base)
for (const [name, v] of Object.entries(VARIANTS)) {
  const r = name === 'base' ? base : await measure(v)
  console.log(`${name.padEnd(18)} ${String(r.min).padStart(7)} B min  ${String(r.gzip).padStart(6)} B gzip  (${r.gzip - base.gzip >= 0 ? '+' : ''}${r.gzip - base.gzip})`)
}
