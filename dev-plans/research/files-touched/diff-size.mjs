#!/usr/bin/env node
// Diff size and files touched per feature, Sygnal vs React, from data already on disk: the `diff` of
// every trial in results/analysis/<run>.json (lines against the starter, per file) and the reference
// solutions in hidden/ and react/hidden/. No model runs. Design: dev-plans/research/read-side-eval.
//
//   node evals/agent-ergonomics/analysis/diff-size.mjs [--out results/analysis/diff-size] [--all-trials] [--same-run]
//
// The unit is a task: per (model, task, arm) the mean over the passing trials of one run (a failed
// trial's diff is not a finished feature; --all-trials keeps them). The run per cell is the newest
// mainline run with a usable trial (MAINLINE, newest first), so experiment arms (a skill A/B, a removed
// starter, a TOC format) don't mix in. A ratio is Sygnal / React: below 1 means Sygnal's diff is smaller.
// Tests and non-source files are left out: Sygnal trials write more test code, and a review of the
// feature is a review of the source (tests are reported on their own). --same-run compares each cell
// only within one run that has both arms (fewer tasks, no drift between runs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVAL_ROOT, listTasks, armPaths, parseArgs, OVERLAY_DELETE_FILE } from '../../../evals/agent-ergonomics/lib/common.mjs'
import { lineDiff } from '../../../evals/agent-ergonomics/analysis/lib/code.mjs'
import { isTestPath } from '../../../evals/agent-ergonomics/analysis/lib/classify.mjs'
import { TIERS } from '../../../evals/agent-ergonomics/lib/plan.mjs'

/** Newest first. A cell takes the first run that has it (same model, same arm). */
export const MAINLINE = {
  sygnal: ['p9-final-opus', 'p6-final-opus', 'p6-final-sonnet', 'p6-final-haiku', 'p6-s14-opus', 'p5-final-opus', 'p5-final-sonnet', 'p5-final-haiku', 'p5-mod-sonnet', 'p5-mod-haiku-43', 'p5-mod-haiku-2', 'p5-mod-haiku', 'p5-s14b-opus', 'p46-ev-opus', 'p46-ev-haiku', 'p45-ev-opus', 'p4-final7-opus-ergo', 'p4-final6-opus', 'p4-final6-haiku', 'p4-haiku2', 'p3-v7', 'p3-v7-haiku', 'p3-v6', 'p3-v6-haiku', 'p3-final', 'p3-final-haiku', 'p4-baseline-ts', 'p3-control', 'p3-net-baseline', 'e7-sonnet', 'v2-baseline'],
  react: ['p6-final-opus', 'p6-final-sonnet', 'p6-final-haiku', 'p5-final-opus', 'p5-final-sonnet', 'p5-final-haiku', 'p5-mod-sonnet', 'p5-mod-haiku-43', 'p5-mod-haiku-2', 'p5-mod-haiku', 'p4-final7-react-ergo', 'p4-final6-react-ergo', 'p4-final6-react-ergo-haiku', 'p4-haiku2', 'p4-react-ts', 'p3-v6-react', 'p3-v6-react-haiku', 'p3-net-baseline', 'p3-control-react', 'e7-sonnet', 'v2-baseline'],
}

const CODE_SRC = /^src\/.*\.(jsx?|tsx?|mjs|cjs|css)$/
const fam = (m) => (m ? m.replace(/^claude-/, '').replace(/-\d{8}$/, '') : 'unknown')
const num = (t) => Number(t.slice(0, 2))
export const tierOf = (n) => Object.keys(TIERS).find((k) => TIERS[k](n)) ?? 'other'
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/** Source / test / other line and file counts of one trial's `diff`. */
export function measure(diff) {
  const m = { srcAdded: 0, srcRemoved: 0, srcFiles: 0, srcNewFiles: 0, testAdded: 0, testRemoved: 0, testFiles: 0 }
  for (const [f, d] of Object.entries(diff?.files ?? {})) {
    if (isTestPath(f) || /(^|\/)(test-utils|fixtures|setupTests)[^/]*$/.test(f)) {
      m.testAdded += d.added
      m.testRemoved += d.removed
      m.testFiles++
    } else if (CODE_SRC.test(f)) {
      m.srcAdded += d.added
      m.srcRemoved += d.removed
      m.srcFiles++
      if (d.status === 'new') m.srcNewFiles++
    }
  }
  m.srcChurn = m.srcAdded + m.srcRemoved
  return m
}

/** Exact two-sided sign test: ties dropped. */
export function signTest(xs) {
  const nz = xs.filter((x) => x !== 0)
  const n = nz.length
  if (!n) return 1
  const k = Math.min(nz.filter((x) => x > 0).length, nz.filter((x) => x < 0).length)
  let p = 0
  let c = 1
  for (let i = 0; i <= k; i++) {
    p += c
    c = (c * (n - i)) / (i + 1)
  }
  return Math.min(1, (2 * p) / 2 ** n)
}

/** Geometric mean of ratios with a percentile bootstrap over tasks (fixed seed: the report is reproducible). */
export function ratioStats(pairs, B = 4000) {
  const logs = pairs.filter(([s, r]) => s > 0 && r > 0).map(([s, r]) => Math.log(s / r))
  if (!logs.length) return { n: 0 }
  let seed = 1234567
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const gm = (arr) => Math.exp(mean(arr))
  const boot = []
  for (let b = 0; b < B; b++) boot.push(gm(logs.map(() => logs[Math.floor(rnd() * logs.length)])))
  boot.sort((a, b) => a - b)
  return { n: logs.length, ratio: gm(logs), lo: boot[Math.floor(B * 0.025)], hi: boot[Math.floor(B * 0.975)], signP: signTest(logs), smaller: logs.filter((x) => x < 0).length, larger: logs.filter((x) => x > 0).length }
}

export function loadRuns(dir = path.join(EVAL_ROOT, 'results', 'analysis')) {
  const out = {}
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      if (Array.isArray(j.trials)) out[f.slice(0, -5)] = j.trials
    } catch {}
  }
  return out
}

/** { 'model|task': { sygnal: cell, react: cell } } from the mainline runs. */
export function buildCells(runs, { allTrials = false, runOrder = MAINLINE } = {}) {
  const cells = {}
  for (const arm of ['sygnal', 'react']) {
    for (const run of runOrder[arm]) {
      const groups = {}
      for (const t of runs[run] ?? []) {
        if (t.arm !== arm || !t.diff || !t.scored) continue
        if (!allTrials && !t.scored.pass) continue
        ;(groups[`${fam(t.usage?.model ?? t.model)}|${t.task}`] ??= []).push(t)
      }
      for (const [k, trials] of Object.entries(groups)) {
        const c = (cells[k] ??= {})
        if (c[arm]) continue // a newer run already has this cell
        const ms = trials.map((t) => measure(t.diff))
        c[arm] = { run, n: trials.length, ...Object.fromEntries(Object.keys(ms[0]).map((m) => [m, mean(ms.map((x) => x[m]))])) }
      }
    }
  }
  return cells
}

export const METRICS = ['srcAdded', 'srcChurn', 'srcFiles', 'srcNewFiles', 'testAdded']

export function summarize(cells, keep = () => true) {
  const paired = Object.entries(cells).filter(([k, c]) => c.sygnal && c.react && keep(k))
  const stats = {}
  for (const m of METRICS) {
    const pairs = paired.map(([, c]) => [c.sygnal[m], c.react[m]])
    stats[m] = { ...ratioStats(pairs), sygnalMean: mean(pairs.map((p) => p[0])), reactMean: mean(pairs.map((p) => p[1])) }
  }
  return { tasks: paired.length, stats }
}

/** Reference solutions: source lines from the starter to solution/ (hidden/<task>/solution), both arms. */
export function referenceDiffs() {
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
            if (a !== b) files[r] = { ...lineDiff(a, b), status: a ? 'modified' : 'new' }
          }
        }
      }
      walk(sol, '')
      const del = path.join(sol, OVERLAY_DELETE_FILE)
      if (fs.existsSync(del)) {
        for (const rel of fs.readFileSync(del, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)) {
          const start = path.join(tasks, task, 'starter', rel)
          if (!fs.existsSync(start)) continue
          if (fs.statSync(start).isDirectory()) continue
          files[rel] = { ...lineDiff(fs.readFileSync(start, 'utf8'), ''), status: 'deleted' }
        }
      }
      ;(out[`ref|${task}`] ??= {})[arm] = { run: 'reference', n: 1, ...measure({ files }) }
    }
  }
  return out
}

const fmtRatio = (s) => (s?.n ? `${s.ratio.toFixed(2)}× [${s.lo.toFixed(2)}, ${s.hi.toFixed(2)}]` : 'n/a')
const fmtP = (p) => (p == null ? '' : p < 0.001 ? '<0.001' : p.toFixed(3))
const row = (label, s) => `| ${label} | ${s.tasks} | ${s.stats.srcChurn.sygnalMean?.toFixed(0) ?? ''} | ${s.stats.srcChurn.reactMean?.toFixed(0) ?? ''} | ${fmtRatio(s.stats.srcChurn)} | ${fmtP(s.stats.srcChurn.signP)} | ${s.stats.srcAdded.sygnalMean?.toFixed(0) ?? ''} / ${s.stats.srcAdded.reactMean?.toFixed(0) ?? ''} | ${s.stats.srcFiles.sygnalMean?.toFixed(1) ?? ''} / ${s.stats.srcFiles.reactMean?.toFixed(1) ?? ''} | ${fmtRatio(s.stats.srcFiles)} | ${s.stats.testAdded.sygnalMean?.toFixed(0) ?? ''} / ${s.stats.testAdded.reactMean?.toFixed(0) ?? ''} |`

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const base = path.resolve(typeof args.out === 'string' ? args.out : path.join(EVAL_ROOT, 'results', 'analysis', 'diff-size'))
  const runs = loadRuns()
  const both = MAINLINE.sygnal.filter((r) => MAINLINE.react.includes(r))
  const cells = buildCells(runs, { allTrials: !!args['all-trials'], runOrder: args['same-run'] ? { sygnal: both, react: both } : MAINLINE })
  if (args['same-run']) for (const c of Object.values(cells)) if (c.sygnal && c.react && c.sygnal.run !== c.react.run) delete c.sygnal
  const pool = (keep) => summarize(cells, keep)
  const models = [...new Set(Object.keys(cells).map((k) => k.split('|')[0]))].filter((m) => pool((k) => k.startsWith(`${m}|`)).tasks >= 4).sort()
  const header = '| Group | Tasks | Churn S | Churn R | Churn S/R (95% CI) | sign p | Added S / R | Files S / R | Files S/R (95% CI) | Test lines S / R |\n|---|---|---|---|---|---|---|---|---|---|'
  const lines = [`# Diff size per feature, Sygnal vs React (${args['all-trials'] ? 'all trials' : 'passing trials only'}${args['same-run'] ? ', same run only' : ''})`, '', 'Generated by `analysis/diff-size.mjs` from `results/analysis/*.json` (no model runs). Churn = source lines added + removed against the starter, tests excluded. Means per task, then over tasks; a ratio is the geometric mean over tasks of Sygnal / React (< 1: Sygnal smaller) with a bootstrap CI over tasks.', '']
  const json = { generatedBy: 'analysis/diff-size.mjs', allTrials: !!args['all-trials'], byModel: {}, byModelTier: {}, reference: {} }
  lines.push('## By model, all tasks', '', header)
  for (const m of models) {
    const s = pool((k) => k.startsWith(`${m}|`))
    json.byModel[m] = s
    lines.push(row(m, s))
  }
  lines.push('', '## By model and tier', '', header)
  for (const m of models) {
    for (const tier of Object.keys(TIERS)) {
      const s = pool((k) => k.startsWith(`${m}|`) && tierOf(num(k.split('|')[1])) === tier)
      if (s.tasks < 2) continue
      json.byModelTier[`${m}|${tier}`] = s
      lines.push(row(`${m} ${tier}`, s))
    }
  }
  const ref = referenceDiffs()
  const rs = summarize(ref)
  json.reference.all = rs
  lines.push('', '## Reference solutions (starter → `solution/`, one deterministic diff per task)', '', header, row('all', rs))
  for (const tier of Object.keys(TIERS)) {
    const s = summarize(ref, (k) => tierOf(num(k.split('|')[1])) === tier)
    if (s.tasks < 2) continue
    json.reference[tier] = s
    lines.push(row(tier, s))
  }
  lines.push('', '## Per task (mean over passing trials; runs used)', '', '| Model | Task | Runs (S / R) | n (S / R) | Churn S / R | Files S / R |', '|---|---|---|---|---|---|')
  for (const [k, c] of Object.entries(cells).sort()) {
    if (!c.sygnal || !c.react) continue
    const [m, t] = k.split('|')
    lines.push(`| ${m} | ${t} | ${c.sygnal.run} / ${c.react.run} | ${c.sygnal.n} / ${c.react.n} | ${c.sygnal.srcChurn.toFixed(0)} / ${c.react.srcChurn.toFixed(0)} | ${c.sygnal.srcFiles.toFixed(1)} / ${c.react.srcFiles.toFixed(1)} |`)
  }
  json.cells = cells
  fs.mkdirSync(path.dirname(base), { recursive: true })
  fs.writeFileSync(`${base}.md`, lines.join('\n') + '\n')
  fs.writeFileSync(`${base}.json`, JSON.stringify(json, null, 1) + '\n')
  console.log(lines.slice(0, lines.findIndex((l) => l.startsWith('## Per task'))).join('\n'))
}
