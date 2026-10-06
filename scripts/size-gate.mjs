#!/usr/bin/env node
// Size gate (D48): gzipped kanban production bundle.
//
// Builds examples/kanban twice with its own Vite and the built sygnal/vite plugin:
//   (a) sygnal({ nativeGlobalThis: false }): core + xstream's original deps. This is the
//       number a budget gates, so it keeps measuring core growth.
//   (b) sygnal(): the default, with `globalthis` aliased to the native stub (G-099).
//       Reported only: what apps actually ship.
// and reports (c) the component core alone (src/core/**, everything else external), min + gzip.
//
// (a) is gated against BUDGET (D48; PLAN-4.6 D185: 42,300 B for the rewritten core, as before
// it): exit 1 when over. `--budget <bytes>` overrides it. Needs `npm run build` and
// `npm install --prefix examples/kanban` first.
//
// The size is `gzip -c <bundle> | wc -c` (the gzip CLI's default level and header, as
// the gate was measured before this script), falling back to zlib when gzip is missing.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

// D48; PLAN-4.6 D185 re-enabled it at 42,300 B (D182 had made it informational during the rewrite)
const BUDGET = 42700  // PLAN-5 D230 (was 42,500 B, D222; 42,300 B, D185)

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const kanban = path.join(repo, 'examples', 'kanban')
const budgetArg = process.argv.indexOf('--budget')
const budget = budgetArg > 0 ? Number(process.argv[budgetArg + 1]) : BUDGET
// R2-8: a missing or non-numeric --budget (NaN) would make the comparison always pass
if (!Number.isFinite(budget) || budget <= 0) {
  console.error(`size-gate: --budget must be a positive number of bytes (got ${budgetArg > 0 ? JSON.stringify(process.argv[budgetArg + 1] ?? '') : budget}).`)
  process.exit(2)
}

const req = createRequire(path.join(kanban, 'package.json'))
let vite, sygnal
try {
  vite = await import(pathToFileURL(req.resolve('vite')).href)
  sygnal = (await import(pathToFileURL(req.resolve('sygnal/vite')).href)).default
} catch (err) {
  console.error(`size-gate: cannot load vite / sygnal/vite from examples/kanban (${err.message}).`)
  console.error('Run `npm run build` and `npm install --prefix examples/kanban` first.')
  process.exit(2)
}

function gzipSize(file) {
  const r = spawnSync('gzip', ['-c', file], { maxBuffer: 64 * 1024 * 1024 })
  if (r.status === 0 && r.stdout) return r.stdout.length
  return zlib.gzipSync(fs.readFileSync(file)).length
}

async function measure(label, pluginOptions, define) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-size-gate-'))
  try {
    // Same as examples/kanban/vite.config.js (`plugins: [sygnal()]`), with the plugin options
    await vite.build({
      root: kanban,
      configFile: false,
      logLevel: 'warn',
      plugins: [sygnal(pluginOptions)],
      ...(define && { define }),
      build: { outDir, emptyOutDir: true },
    })
    const assets = path.join(outDir, 'assets')
    const files = fs.readdirSync(assets).filter(f => /^index-.*\.js$/.test(f))
    if (files.length !== 1) throw new Error(`expected one assets/index-*.js, found ${files.length}`)
    const file = path.join(assets, files[0])
    return { label, raw: fs.statSync(file).size, gzip: gzipSize(file) }
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
}

// (c) the component core alone: every module under src/core/, bundled and minified with
// esbuild; everything outside src/core/ (drivers, diagnostics, xstream, snabbdom) is external
async function coreAlone() {
  const req2 = createRequire(path.join(repo, 'package.json'))
  const esbuild = await import(pathToFileURL(req2.resolve('esbuild')).href)
  const coreDir = path.join(repo, 'src', 'core')
  const files = []
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p) } }
  walk(coreDir)
  const entry = files.map((f, i) => `export * as m${i} from ${JSON.stringify(f)}`).join('\n')
  const out = await esbuild.build({
    stdin: { contents: entry, resolveDir: coreDir, loader: 'js' },
    bundle: true, minify: true, write: false, format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'core-only', setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === 'entry-point' || !a.importer) return
        const p = a.path.startsWith('.') ? path.resolve(a.resolveDir, a.path) : a.path
        if (p.startsWith(coreDir + path.sep)) return
        return { path: a.path, external: true }
      })
    } }],
  })
  const code = out.outputFiles[0].contents
  return { label: '(c) src/core/** alone (esbuild, minified; the rest external)', raw: code.length, gzip: zlib.gzipSync(code, { level: 9 }).length }
}

const gated = await measure('(a) nativeGlobalThis: false', { nativeGlobalThis: false })
const shipped = await measure('(b) default (native globalThis)', {})
const core = await coreAlone()

const fmt = n => n.toLocaleString('en-US')
console.log('kanban production bundle, gzip -c | wc -c:')
console.log(`  ${gated.label}: ${fmt(gated.gzip)} B  (budget ${fmt(budget)} B, ${budget - gated.gzip >= 0 ? `${fmt(budget - gated.gzip)} B headroom` : `${fmt(gated.gzip - budget)} B OVER`})`)
console.log(`  ${shipped.label}: ${fmt(shipped.gzip)} B  (informational; ${fmt(gated.gzip - shipped.gzip)} B less)`)
console.log(`  ${core.label}: ${fmt(core.raw)} B min / ${fmt(core.gzip)} B gzip  (informational)`)

if (gated.gzip > budget) {
  console.error(`size-gate: FAIL: ${fmt(gated.gzip)} B > ${fmt(budget)} B`)
  process.exit(1)
}
console.log('size-gate: OK')
