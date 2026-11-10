#!/usr/bin/env node
// Why does a Sygnal change touch more files than the equivalent React change?
// Splits the files-touched gap by cause, from data on disk: reference solutions (hidden/ and react/hidden/)
// and passing trials (results/analysis/*.json, the runs diff-size.mjs uses). No model runs.
//
//   node dev-plans/research/files-touched/classify.mjs [--out <base>]
//
// The decomposition is exact: for a task, S - R = sum over files f of (pS(f) - pR(f)), where p is the share
// of trials touching f (1 or 0 for a reference). Grouping f by cause adds up to the gap with no remainder.
// Tests are excluded as in diff-size.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listTasks, armPaths, OVERLAY_DELETE_FILE } from '../../../evals/agent-ergonomics/lib/common.mjs'
import { isTestPath } from '../../../evals/agent-ergonomics/analysis/lib/classify.mjs'
import { lineDiff } from '../../../evals/agent-ergonomics/analysis/lib/code.mjs'
import { MAINLINE, loadRuns, tierOf } from './diff-size.mjs'

export const CAUSES = ['entry', 'routes', 'driver-module', 'types', 'style', 'new-component', 'new-module', 'existing-source']
const LABEL = {
  entry: 'entry point (`main.*`)',
  routes: 'routes module',
  'driver-module': 'hand-written driver file',
  types: 'types / events declaration file',
  style: 'stylesheet',
  'new-component': 'new component file',
  'new-module': 'new helper module',
  'existing-source': 'an existing component or module',
}
const isSrc = (f) => /^src\/.*\.(jsx?|tsx?|mjs|cjs|css)$/.test(f) && !isTestPath(f) && !/(^|\/)(test-utils|fixtures|setupTests)[^/]*$/.test(f)
export function causeOf(f, status) {
  const b = path.posix.basename(f)
  if (/^main\.[cm]?[jt]sx?$/.test(b) || /^index\.[jt]sx?$/.test(b) && path.posix.dirname(f) === 'src') return 'entry'
  if (/^routes?\b/i.test(b) || /^router\./i.test(b)) return 'routes'
  if (/\.css$/.test(b)) return 'style'
  if (/^(types?|events?)\.ts$/.test(b) || /\.d\.ts$/.test(b)) return 'types'
  if (status === 'new') {
    if (/driver|socket/i.test(b)) return 'driver-module'
    return /^[A-Z]/.test(b) ? 'new-component' : 'new-module'
  }
  return 'existing-source'
}

/** Reference solutions as { task: { arm: { file: status } } }. */
export function referenceFiles() {
  const out = {}
  for (const arm of ['sygnal', 'react']) {
    const { tasks, hidden } = armPaths(arm)
    for (const task of listTasks(arm)) {
      const sol = path.join(hidden, task, 'solution')
      if (!fs.existsSync(sol)) continue
      const files = {}
      const walk = (d, rel) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const r = path.posix.join(rel, e.name)
          if (e.isDirectory()) walk(path.join(d, e.name), r)
          else if (e.name !== OVERLAY_DELETE_FILE) {
            const start = path.join(tasks, task, 'starter', r)
            const a = fs.existsSync(start) ? fs.readFileSync(start, 'utf8') : ''
            const b = fs.readFileSync(path.join(d, e.name), 'utf8')
            if (a !== b) files[r] = { status: a ? 'modified' : 'new', ...lineDiff(a, b) }
          }
        }
      }
      walk(sol, '')
      const del = path.join(sol, OVERLAY_DELETE_FILE)
      if (fs.existsSync(del)) for (const rel of fs.readFileSync(del, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)) {
        const start = path.join(tasks, task, 'starter', rel)
        if (fs.existsSync(start) && !fs.statSync(start).isDirectory()) files[rel] = { status: 'deleted', ...lineDiff(fs.readFileSync(start, 'utf8'), '') }
      }
      ;(out[task] ??= {})[arm] = files
    }
  }
  return out
}

const add = (o, k, v) => (o[k] = (o[k] ?? 0) + v)
/** One task's (or cell's) probability of touching each src file, by cause. */
function byCause(fileProbs) {
  const c = Object.fromEntries(CAUSES.map((x) => [x, 0]))
  for (const [f, { p, status }] of Object.entries(fileProbs)) add(c, causeOf(f, status), p)
  return c
}
const rowsFor = (pairs) => {
  const totals = { S: 0, R: 0 }
  const cause = Object.fromEntries(CAUSES.map((x) => [x, { S: 0, R: 0 }]))
  for (const { sygnal, react } of pairs) {
    const s = byCause(sygnal)
    const r = byCause(react)
    for (const k of CAUSES) {
      cause[k].S += s[k]
      cause[k].R += r[k]
      totals.S += s[k]
      totals.R += r[k]
    }
  }
  const n = pairs.length
  return { n, sMean: totals.S / n, rMean: totals.R / n, gap: (totals.S - totals.R) / n, cause: Object.fromEntries(CAUSES.map((k) => [k, { S: cause[k].S / n, R: cause[k].R / n, net: (cause[k].S - cause[k].R) / n }])) }
}

const gm = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length)
const sum = (o) => Object.values(o).reduce((a, x) => a + x.p, 0)
const ratio = (pairs, f = (s) => sum(s)) => gm(pairs.filter(({ sygnal: s, react: r }) => f(s, r) > 0 && sum(r) > 0).map(({ sygnal: s, react: r }) => f(s, r) / sum(r)))
/** Geometric-mean ratio if the Sygnal arm's files of these causes were not touched (the cause goes to zero in S only). */
export const ratioWithout = (pairs, causes) => ratio(pairs, (s) => Math.max(0.5, Object.entries(s).reduce((a, [f, x]) => a + (causes.includes(causeOf(f, x.status)) ? 0 : x.p), 0)))

export function referencePairs() {
  const ref = referenceFiles()
  const pairs = []
  for (const [task, c] of Object.entries(ref)) {
    if (!c.sygnal || !c.react) continue
    const conv = (o) => Object.fromEntries(Object.entries(o).filter(([f]) => isSrc(f)).map(([f, v]) => [f, { p: 1, status: v.status }]))
    pairs.push({ task, model: 'ref', sygnal: conv(c.sygnal), react: conv(c.react) })
  }
  return pairs
}

const fam = (m) => (m ? m.replace(/^claude-/, '').replace(/-\d{8}$/, '') : 'unknown')
/** Trials as paired cells, newest mainline run per (model, task, arm), passing trials only. */
export function trialPairs() {
  const runs = loadRuns()
  const cells = {}
  for (const arm of ['sygnal', 'react']) {
    for (const run of MAINLINE[arm]) {
      const groups = {}
      for (const t of runs[run] ?? []) {
        if (t.arm !== arm || !t.diff || !t.scored?.pass) continue
        ;(groups[`${fam(t.usage?.model ?? t.model)}|${t.task}`] ??= []).push(t)
      }
      for (const [k, trials] of Object.entries(groups)) {
        const c = (cells[k] ??= {})
        if (c[arm]) continue
        const p = {}
        for (const t of trials) for (const [f, d] of Object.entries(t.diff.files ?? {})) if (isSrc(f)) {
          p[f] ??= { p: 0, status: d.status }
          p[f].p += 1 / trials.length
        }
        c[arm] = p
      }
    }
  }
  return Object.entries(cells).filter(([, c]) => c.sygnal && c.react).map(([k, c]) => ({ model: k.split('|')[0], task: k.split('|')[1], sygnal: c.sygnal, react: c.react }))
}

const f2 = (x) => (x == null ? '' : x.toFixed(2))
function table(title, pairs) {
  const r = rowsFor(pairs)
  const lines = [`### ${title} (${r.n} tasks)`, '', `Files per task: Sygnal ${f2(r.sMean)}, React ${f2(r.rMean)}, gap ${f2(r.gap)}; geometric-mean ratio ${f2(ratio(pairs))}×.`, '', '| Cause | Sygnal | React | Net per task | Share of gap | Ratio if the cause were gone from Sygnal |', '|---|---|---|---|---|---|']
  for (const k of CAUSES) {
    const c = r.cause[k]
    lines.push(`| ${LABEL[k]} | ${f2(c.S)} | ${f2(c.R)} | ${c.net >= 0 ? '+' : ''}${f2(c.net)} | ${r.gap ? ((100 * c.net) / r.gap).toFixed(0) : 0}% | ${f2(ratioWithout(pairs, [k]))}× |`)
  }
  lines.push('')
  return { lines, r }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const refs = referencePairs()
  const out = ['# Files touched: gap by cause', '', 'Generated by `classify.mjs`. Exact additive split: net per task = mean Sygnal − mean React files of that cause. Tests excluded. Ratio column: geometric mean S/R over tasks with that cause\'s Sygnal files removed (the React arm keeps its own).', '']
  out.push('## Reference solutions', '')
  out.push(...table('All', refs).lines)
  const trials = trialPairs()
  out.push('## Trials (passing, newest mainline run per cell)', '')
  for (const m of ['opus-5-5', 'sonnet-5-5', 'haiku-4-5', 'haiku-5-5']) {
    const ps = trials.filter((t) => t.model === m)
    if (ps.length >= 4) out.push(...table(m, ps).lines)
  }
  out.push(...table('All models pooled', trials).lines)
  out.push('## Reference solutions, per task (Sygnal-only and React-only files)', '', '| Task | Tier | S | R | Sygnal-only | React-only |', '|---|---|---|---|---|---|')
  for (const p of refs) {
    const sOnly = Object.keys(p.sygnal).filter((f) => !p.react[f]).map((f) => `${f.replace(/^src\//, '')} (${causeOf(f, p.sygnal[f].status)})`)
    const rOnly = Object.keys(p.react).filter((f) => !p.sygnal[f]).map((f) => `${f.replace(/^src\//, '')} (${causeOf(f, p.react[f].status)})`)
    if (sOnly.length || rOnly.length) out.push(`| ${p.task} | ${tierOf(Number(p.task.slice(0, 2)))} | ${Object.keys(p.sygnal).length} | ${Object.keys(p.react).length} | ${sOnly.join(', ')} | ${rOnly.join(', ')} |`)
  }
  const args = process.argv.indexOf('--out')
  const base = args > 0 ? process.argv[args + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), 'cause-table')
  fs.writeFileSync(`${base}.md`, out.join('\n') + '\n')
  console.log(out.join('\n'))
}
