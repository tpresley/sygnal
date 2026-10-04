#!/usr/bin/env node
// Timing report (PLAN-4.5 §3, warn-only; not part of `npm test`).
//
// Builds the audit apps (production, benchmarks/audit/build.mjs), runs the timing bench for
// Sygnal, React and Vue in the same run (benchmarks/audit/bench.mjs), and prints Sygnal's
// latency ratio to React for each PLAN-4.5 timing target. Ratios, not milliseconds, because
// absolute times depend on the machine; React and Vue are re-measured in every run.
// Never fails on a ratio: exit 1 only when the bench itself fails.
//
//   node scripts/perf-report.mjs [--no-build] [--iter=10] [--warmup=3] [--all]
//     --all   every bench op and the memory runs (about 15 min), not just the target ops
//
// Writes benchmarks/audit/results/perf-report-<date>.json (gitignored). Needs `npm run build`
// and `npm ci --prefix benchmarks`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const benchmarks = path.join(repo, 'benchmarks')
const audit = path.join(benchmarks, 'audit')
const argv = process.argv.slice(2)
const opt = (k, d) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d

// PLAN-4.5 §3 timing targets: Sygnal latency / React latency, same run. `now` is the ratio
// measured when the gate landed (P45-0, plan45-integration, two runs agreeing within 1x), with
// this harness's quiet-page wait. The baseline write-up's ratios (70x, 11x, 15x, 9x, 13x) are
// higher for the Collection ops, because without the wait the setup's trailing teardown landed
// in the measurement. React's sub-millisecond latencies sit on a 0.1 ms timer resolution, so a
// ratio can move by ~20% between runs.
const TARGETS = [
  { name: 'Collection: select row (1k)', op: 'select row (1k)', app: 'sygnal (Collection)', target: 5, now: 28 },
  { name: 'Mount 1k components', op: 'mount 1k components', app: 'sygnal', target: 3, now: 7 },
  { name: 'Leaf update, 30 deep', op: 'leaf update, 30 deep', app: 'sygnal', target: 3, now: 13 },
  { name: 'Keystroke (1k list)', op: 'keystroke (1k list)', app: 'sygnal', target: 2, now: 9 },
  { name: 'Single component: select row (1k)', op: 'select row (1k)', app: 'sygnal', target: 4, now: 16 },
]

if (!fs.existsSync(path.join(benchmarks, 'node_modules', 'vite'))) {
  console.error('perf-report: benchmarks/ is not installed. Run `npm ci --prefix benchmarks` first.')
  process.exit(2)
}
if (!fs.existsSync(path.join(repo, 'dist', 'index.esm.js'))) {
  console.error('perf-report: dist/ is missing. Run `npm run build` first.')
  process.exit(2)
}

const node = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(audit, script), ...args], { cwd: audit, stdio: 'inherit' })
  if (r.status !== 0) { console.error(`perf-report: ${script} failed`); process.exit(1) }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const resultsDir = path.join(audit, 'results')
fs.mkdirSync(resultsDir, { recursive: true })
const benchOut = path.join(resultsDir, `bench-${stamp}.json`)

if (!argv.includes('--no-build')) node('build.mjs', [])
const benchArgs = ['--fw=sygnal,react,vue', `--iter=${opt('iter', 10)}`, `--warmup=${opt('warmup', 3)}`, `--out=${benchOut}`]
if (!argv.includes('--all')) benchArgs.push(`--ops=${[...new Set(TARGETS.map(t => t.op))].join(';')}`, '--no-memory')
node('bench.mjs', benchArgs)

const bench = JSON.parse(fs.readFileSync(benchOut, 'utf8'))
const ratios = TARGETS.map(t => {
  const s = bench.speed[t.op]?.[t.app]?.latency
  const r = bench.speed[t.op]?.react?.latency
  const ratio = s != null && r ? s / r : null
  const sc = bench.speed[t.op]?.[t.app]?.cpu, rc = bench.speed[t.op]?.react?.cpu
  const cpuRatio = sc != null && rc ? sc / rc : null
  return { ...t, sygnalMs: s ?? null, reactMs: r ?? null, vueMs: bench.speed[t.op]?.vue?.latency ?? null, ratio, cpuRatio, met: ratio != null && ratio <= t.target }
})

const f = (x, d = 1) => (x == null ? '-' : x.toFixed(d))
const rows = ratios.map(r => [r.name, f(r.sygnalMs, 2), f(r.reactMs, 2), f(r.vueMs, 2), r.ratio == null ? '-' : `${f(r.ratio)}x`, `<= ${r.target}x`, `${r.now}x`, r.cpuRatio == null ? '-' : `${f(r.cpuRatio)}x`, r.ratio == null ? 'no data' : r.met ? 'met' : 'WARN: above target'])
const head = ['Op', 'Sygnal ms', 'React ms', 'Vue ms', 'Ratio', 'Target', 'P45-0', 'CPU ratio', '']
const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)))
const line = (r) => r.map((c, i) => (i === 0 || i === 8 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ')
console.log(`\nPLAN-4.5 timing report (warn-only): median latency (event -> DOM settled + layout), Chromium ${bench.chromium}, ${bench.iter} runs after ${bench.warmup} warm-ups\n`)
console.log(line(head))
for (const r of rows) console.log(line(r))
console.log('\nRatio: Sygnal / React latency (the target). P45-0: the ratio when the gate landed (same method).\n' +
  'CPU ratio: main-thread task time from the event to 150 ms after idle (informational; catches trailing work).')
const missed = ratios.filter(r => !r.met).length
console.log(`\n${missed ? `${missed} of ${ratios.length} ratios above target (warning only)` : 'all ratios within target'}`)

const out = path.join(resultsDir, `perf-report-${stamp}.json`)
fs.writeFileSync(out, JSON.stringify({ date: bench.date, chromium: bench.chromium, iter: bench.iter, warmup: bench.warmup, ratios, bench: path.relative(repo, benchOut) }, null, 2))
console.log(`wrote ${path.relative(repo, out)}`)
