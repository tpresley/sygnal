#!/usr/bin/env node
// Size gate (D48): gzipped kanban production bundle.
//
// Builds examples/kanban twice with its own Vite and the built sygnal/vite plugin:
//   (a) sygnal({ nativeGlobalThis: false }): core + xstream's original deps. This is the
//       gated number, so the gate keeps measuring core growth (budget below).
//   (b) sygnal(): the default, with `globalthis` aliased to the native stub (G-099).
//       Reported only: what apps actually ship.
// Exits 1 when (a) is over budget. Needs `npm run build` and `npm install --prefix
// examples/kanban` first. `--budget <bytes>` overrides the budget.
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

const BUDGET = 42300

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

async function measure(label, pluginOptions) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-size-gate-'))
  try {
    // Same as examples/kanban/vite.config.js (`plugins: [sygnal()]`), with the plugin options
    await vite.build({
      root: kanban,
      configFile: false,
      logLevel: 'warn',
      plugins: [sygnal(pluginOptions)],
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

const gated = await measure('(a) nativeGlobalThis: false (gated)', { nativeGlobalThis: false })
const shipped = await measure('(b) default (native globalThis)', {})

const fmt = n => n.toLocaleString('en-US')
console.log('kanban production bundle, gzip -c | wc -c:')
console.log(`  ${gated.label}: ${fmt(gated.gzip)} B  (budget ${fmt(budget)} B, ${budget - gated.gzip >= 0 ? `${fmt(budget - gated.gzip)} B headroom` : `${fmt(gated.gzip - budget)} B OVER`})`)
console.log(`  ${shipped.label}: ${fmt(shipped.gzip)} B  (informational; ${fmt(gated.gzip - shipped.gzip)} B less)`)

if (gated.gzip > budget) {
  console.error(`size-gate: FAIL: ${fmt(gated.gzip)} B > ${fmt(budget)} B`)
  process.exit(1)
}
console.log('size-gate: OK')
