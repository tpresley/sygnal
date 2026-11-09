#!/usr/bin/env node
// A/B timing of two Sygnal builds on the audit harness (not part of `npm test`).
//
// perf-report.mjs gives ratios to React, which move by ~20% between runs. This compares a
// candidate with a frozen baseline directly: both are benched in alternating rounds (ABBA) on the
// same machine, and each op's result is the median of the rounds' medians. Only one A/B runs at
// a time across all worktrees of this repository (a lock in the git common dir).
//
//   node scripts/perf-ab.mjs --base=<dir> [--cand=<dir>] [--no-build] [--rounds=4] [--iter=8] [--warmup=3] [--op=substring] [--ops="a;b"]
//     --base  a frozen audit production build: a directory holding sygnal/ (a copy of benchmarks/audit/dist)
//     --cand  the same for the candidate; by default this checkout's, rebuilt from its dist/
//
// Prints candidate / baseline per op, for latency and for main-thread CPU, and marks an op
// `SLOWER` when its latency is more than 5% and 0.3 ms above the baseline. Exit 0 either way.
// Needs `npm run build` and `npm ci --prefix benchmarks`.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const audit = path.join(repo, 'benchmarks', 'audit')
const argv = process.argv.slice(2)
const opt = (k, d) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d

const DEFAULT_OPS = [
  'create 1k rows', 'replace 1k rows', 'update every 10th (1k)', 'select row (1k)', 'swap rows (1k)', 'remove row (1k)',
  'append 1k to 1k', 'clear 1k rows', 'mount 1k components', 'update 1 of 1k', 'unmount 1k components',
  'leaf update, 30 deep', 'keystroke (1k list)', 'calc: toggle filter (1k -> 500)', 'switch: show other page (500)',
]

const base = opt('base')
if (!base || !fs.existsSync(path.join(base, 'sygnal'))) {
  console.error('perf-ab: --base must be a directory holding sygnal/ (a copy of benchmarks/audit/dist).')
  process.exit(2)
}
const rounds = +opt('rounds', 4), iter = opt('iter', 8), warmup = opt('warmup', 3)
const filter = opt('op') ? [`--op=${opt('op')}`] : [`--ops=${opt('ops') ?? DEFAULT_OPS.join(';')}`]

const node = (script, args, inherit) => {
  const r = spawnSync(process.execPath, [path.join(audit, script), ...args], { cwd: audit, stdio: inherit ? 'inherit' : ['ignore', 'ignore', 'inherit'] })
  if (r.status !== 0) { console.error(`perf-ab: ${script} failed`); process.exit(1) }
}

let cand = opt('cand')
if (!cand) {
  if (!argv.includes('--no-build')) node('build.mjs', ['--only=sygnal'], true)
  cand = path.join(audit, 'dist')
}

// One run at a time across worktrees: timing next to another bench measures both.
const common = path.resolve(repo, execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim())
const lock = path.join(common, 'perf-ab.lock')
const STALE_MS = 45 * 60 * 1000
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
for (let announced = false; ; pause(5000)) {
  try { fs.mkdirSync(lock); break } catch (e) {
    if (e.code !== 'EEXIST') throw e
    if (Date.now() - fs.statSync(lock).mtimeMs > STALE_MS) { fs.rmSync(lock, { recursive: true, force: true }); continue }
    if (!announced) { console.log('perf-ab: waiting for another run to finish…'); announced = true }
  }
}
const unlock = () => fs.rmSync(lock, { recursive: true, force: true })
process.on('exit', unlock)
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-perf-ab-'))
const runs = { base: [], cand: [] }
const bench = (side, dir, i) => {
  const out = path.join(tmp, `${side}-${i}.json`)
  node('bench.mjs', ['--fw=sygnal', '--no-memory', `--dist=${dir}`, `--iter=${iter}`, `--warmup=${warmup}`, `--out=${out}`, ...filter])
  runs[side].push(JSON.parse(fs.readFileSync(out, 'utf8')).speed)
}
for (let i = 0; i < rounds; i++) {
  const order = i % 2 ? [['cand', cand], ['base', base]] : [['base', base], ['cand', cand]]
  for (const [side, dir] of order) bench(side, dir, i)
  console.log(`perf-ab: round ${i + 1}/${rounds} done`)
}
fs.rmSync(tmp, { recursive: true, force: true })

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pick = (side, op, label, key) => median(runs[side].map(r => r[op]?.[label]?.[key]).filter(v => v != null))
const f = (n) => n.toFixed(2).padStart(9)

console.log(`\n${'op'.padEnd(46)}${'latency base'.padStart(13)}${'cand'.padStart(9)}${'ratio'.padStart(7)}${'cpu base'.padStart(11)}${'cand'.padStart(9)}${'ratio'.padStart(7)}`)
let lat = 0, cpu = 0, n = 0, slower = 0
for (const op of Object.keys(runs.base[0])) for (const label of Object.keys(runs.base[0][op])) {
  const a = pick('base', op, label, 'latency'), b = pick('cand', op, label, 'latency')
  const c = pick('base', op, label, 'cpu'), d = pick('cand', op, label, 'cpu')
  const flag = b > a * 1.05 && b - a > 0.3
  if (flag) slower++
  lat += Math.log(b / a); cpu += Math.log(d / c); n++
  console.log(`${`${op} [${label.replace('sygnal', '').replace(/[ ()]/g, '') || 'view'}]`.padEnd(46)}${f(a).padStart(13)}${f(b)}${(b / a).toFixed(3).padStart(7)}${f(c).padStart(11)}${f(d)}${(d / c).toFixed(3).padStart(7)}${flag ? '  SLOWER' : ''}`)
}
console.log(`\ngeometric mean, candidate / baseline: latency ${Math.exp(lat / n).toFixed(3)}, cpu ${Math.exp(cpu / n).toFixed(3)}; ${slower} op(s) marked SLOWER`)
