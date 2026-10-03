// Task-matched comparison of two runs (G-119; used by compare.mjs).
// Unit-tested in analysis/tests/compare.unit.mjs.
//
// A run's mean over all its trials is not comparable with another run's when
// the task sets differ (a 15-trial subset vs a 160-trial baseline). Here every
// comparison is restricted to the (arm, task) cells both sides have: per cell
// the mean of its trials, per metric the matched mean = the mean over cells of
// the cell means (each task weighs the same), and the delta next − base.
//
// Sides can pin an arm (`run:arm`), so a comparison can cross arms and runs:
// `--base v2-baseline:react --next e1-check:sygnal` matches on task alone and
// its deltas are the Sygnal − React gap with the E1 variant.
import fs from 'node:fs'
import path from 'node:path'
import { mean } from './aggregate.mjs'

/** Metrics a row can carry; `from` = which sources have it. */
export const METRICS = {
  pass: { label: 'pass rate', unit: '%', scale: 100, from: 'both' },
  wall: { label: 'wall (s)', from: 'both' },
  costUsd: { label: 'cost ($)', digits: 3, from: 'both' },
  tokens: { label: 'billed tokens (k)', scale: 1 / 1000, from: 'both' },
  outputTokens: { label: 'output tokens (k)', scale: 1 / 1000, digits: 2, from: 'both' },
  iterations: { label: 'iterations', digits: 2, from: 'both' },
  editRounds: { label: 'edit rounds', digits: 2, from: 'both' },
  toolCalls: { label: 'tool calls', from: 'analysis' },
  peakContext: { label: 'peak context (k)', scale: 1 / 1000, from: 'analysis' },
  failedRuns: { label: 'failed runs', digits: 2, from: 'analysis' },
  locAdded: { label: 'LOC added', from: 'analysis' },
  wroteTest: { label: 'wrote a test', unit: '%', scale: 100, from: 'analysis' },
  learn: { label: 'learn (s)', from: 'analysis' },
  // PLAN-4 1-E wiring-class measures (lib/wiring.mjs; Sygnal arm only)
  wiringHits: { label: 'SYG104/110/124 hits', digits: 2, from: 'analysis' },
  wiringFinal: { label: 'SYG104/110/124 in final code', unit: '%', scale: 100, from: 'analysis' },
  wiringFailure: { label: 'wiring failures', unit: '%', scale: 100, from: 'analysis' },
}
export const DEFAULT_TASK_METRICS = ['pass', 'wall', 'costUsd', 'iterations']

const num = (x) => (typeof x === 'number' && !Number.isNaN(x) ? x : null)

/** Rows from an analysis JSON (results/analysis/<run>.json): one per analyzed trial. */
export function rowsFromAnalysis(a) {
  return (a.trials ?? []).map((t) => ({
    arm: t.arm,
    task: t.task,
    trial: t.trialNo ?? null,
    pass: t.scored ? (t.scored.pass ? 1 : 0) : null,
    wall: num(t.wallSeconds),
    costUsd: num(t.usage?.costUsd),
    tokens: num(t.usage?.tokens),
    outputTokens: num(t.usage?.outputTokens),
    iterations: num(t.iterations),
    editRounds: num(t.editRounds),
    toolCalls: num(t.toolCalls?.total),
    peakContext: num(t.tokens?.peakContext),
    failedRuns: Array.isArray(t.failures) ? t.failures.filter((f) => f.kind === 'verify' && f.cause !== 'harness').length : null,
    locAdded: num(t.diff?.added),
    wroteTest: t.wroteTest == null ? null : t.wroteTest ? 1 : 0,
    learn: t.phases ? num(t.phases.learn) ?? 0 : null,
    wiringHits: num(t.wiring?.hitCalls),
    wiringFinal: t.wiring?.finalChecked ? (t.wiring.finalCodes.length ? 1 : 0) : null,
    wiringFailure: t.wiring?.failure == null ? null : t.wiring.failure ? 1 : 0,
    phases: t.phases ?? null,
  }))
}

/** Rows from a results file (results/<run>.json): one per scored trial. */
export function rowsFromResults(records) {
  return records.map((r) => ({
    arm: r.arm,
    task: r.task,
    trial: r.trial ?? null,
    pass: r.pass == null ? null : r.pass ? 1 : 0,
    wall: num(r.wallSeconds) ?? (num(r.durationMs) != null ? r.durationMs / 1000 : null),
    costUsd: num(r.costUsd),
    tokens: num(r.tokens),
    outputTokens: num(r.outputTokens),
    iterations: num(r.iterations),
    editRounds: num(r.editRounds),
    variant: r.variant ?? null,
  }))
}

/**
 * Load a run's rows. source 'auto' (default): the analysis JSON if there is
 * one (more metrics), else results/<run>.json; 'analysis' or 'results' force one.
 */
export function loadRun(run, { evalRoot, source = 'auto' }) {
  const ap = path.join(evalRoot, 'results', 'analysis', `${run}.json`)
  const rp = path.join(evalRoot, 'results', `${run}.json`)
  if (source !== 'results' && fs.existsSync(ap)) {
    const analysis = JSON.parse(fs.readFileSync(ap, 'utf8'))
    return { run, source: 'analysis', rows: rowsFromAnalysis(analysis), analysis }
  }
  if (source === 'analysis') throw new Error(`No analysis for run "${run}" at ${ap}; run analyze.mjs --run ${run} first`)
  if (!fs.existsSync(rp)) throw new Error(`No results for run "${run}" (${rp} or ${ap})`)
  return { run, source: 'results', rows: rowsFromResults(JSON.parse(fs.readFileSync(rp, 'utf8'))) }
}

/** "v2-baseline" → { run }, "v2-baseline:react" → { run, arm }. */
export function parseSide(s) {
  const m = String(s).match(/^([\w.-]+)(?::(sygnal|react))?$/)
  if (!m) throw new Error(`Bad run "${s}" (use <run> or <run>:sygnal|react)`)
  return { run: m[1], arm: m[2] ?? null }
}

const taskNum = (t) => Number(String(t).slice(0, 2))

/**
 * @param base, next  { run, rows }
 * @param o.baseArm, o.nextArm  pin an arm per side (then cells match on task only)
 * @param o.arms      keep only these arms (unpinned sides)
 * @param o.tasks     predicate over task numbers (lib/plan.mjs taskSelector)
 * @param o.metrics   metric keys (default: every metric either side has)
 * @returns {{ groups: Group[] }}  one group per arm, or a single cross-arm group
 *   Group: { label, baseArm, nextArm, cells: Cell[], matched: { [metric]: { base, next, delta, ratio, cells } },
 *            baseOnly: string[], nextOnly: string[], trials: { base, next } }
 *   Cell: { task, base: { n, [metric]: mean }, next: { n, ... }, delta: { [metric]: number|null } }
 */
export function matchedCompare(base, next, { baseArm = null, nextArm = null, arms = null, tasks = () => true, metrics } = {}) {
  if (baseArm || nextArm) {
    baseArm ??= nextArm
    nextArm ??= baseArm
  }
  const keep = (rows, arm) => rows.filter((r) => tasks(taskNum(r.task)) && (arm ? r.arm === arm : !arms || arms.includes(r.arm)))
  const bRows = keep(base.rows, baseArm)
  const nRows = keep(next.rows, nextArm)
  const ms = metrics ?? Object.keys(METRICS).filter((m) => [...bRows, ...nRows].some((r) => r[m] != null))
  const groupKeys = baseArm ? [[baseArm, nextArm]] : [...new Set([...bRows, ...nRows].map((r) => r.arm))].sort().map((a) => [a, a])
  const groups = []
  for (const [ba, na] of groupKeys) {
    const byTask = (rows, arm) => {
      const m = new Map()
      for (const r of rows.filter((x) => x.arm === arm)) (m.get(r.task) ?? m.set(r.task, []).get(r.task)).push(r)
      return m
    }
    const bt = byTask(bRows, ba)
    const nt = byTask(nRows, na)
    const shared = [...bt.keys()].filter((t) => nt.has(t)).sort()
    const cellStats = (rows) => Object.fromEntries([['n', rows.length], ...ms.map((m) => [m, mean(rows.map((r) => r[m]))])])
    const cells = shared.map((task) => {
      const b = cellStats(bt.get(task))
      const n = cellStats(nt.get(task))
      return { task, base: b, next: n, delta: Object.fromEntries(ms.map((m) => [m, b[m] == null || n[m] == null ? null : n[m] - b[m]])) }
    })
    const matched = {}
    for (const m of ms) {
      // Only cells where both sides have the metric, so base and next average over the same tasks.
      const both = cells.filter((c) => c.base[m] != null && c.next[m] != null)
      const b = mean(both.map((c) => c.base[m]))
      const n = mean(both.map((c) => c.next[m]))
      matched[m] = { base: b, next: n, delta: b == null || n == null ? null : n - b, ratio: b ? n / b : null, cells: both.length }
    }
    groups.push({
      label: ba === na ? ba : `${ba} → ${na}`,
      baseArm: ba,
      nextArm: na,
      cells,
      matched,
      baseOnly: [...bt.keys()].filter((t) => !nt.has(t)).sort(),
      nextOnly: [...nt.keys()].filter((t) => !bt.has(t)).sort(),
      trials: { base: shared.reduce((a, t) => a + bt.get(t).length, 0), next: shared.reduce((a, t) => a + nt.get(t).length, 0) },
      rows: { base: [...bt.values()].reduce((x, v) => x + v.length, 0), next: [...nt.values()].reduce((x, v) => x + v.length, 0) },
    })
  }
  return { base: base.run, next: next.run, baseSource: base.source ?? null, nextSource: next.source ?? null, metrics: ms, groups }
}

const fmt = (m, x, signed = false) => {
  if (x == null) return '—'
  const spec = METRICS[m] ?? {}
  const v = x * (spec.scale ?? 1)
  const d = spec.digits ?? 1
  const s = (Math.round(v * 10 ** d) / 10 ** d).toString()
  return `${signed && v > 0 ? '+' : ''}${s}${spec.unit === '%' ? '%' : ''}`
}
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

/** Markdown for matchedCompare()'s result. */
export function renderMatched(c, { taskMetrics = DEFAULT_TASK_METRICS } = {}) {
  const out = []
  const side = (run, arm) => (arm ? `${run}:${arm}` : run)
  for (const g of c.groups) {
    const b = side(c.base, g.baseArm)
    const n = side(c.next, g.nextArm)
    out.push(`## ${g.label}: \`${b}\` → \`${n}\` (task-matched)`, '')
    if (!g.rows.base || !g.rows.next) {
      out.push(`_No shared tasks: ${!g.rows.base ? b : n} has no trials here._`, '')
      continue
    }
    out.push(`${g.cells.length} task(s) in both (${g.trials.base} → ${g.trials.next} trials).${g.baseOnly.length ? ` Only in ${b}: ${g.baseOnly.join(', ')}.` : ''}${g.nextOnly.length ? ` Only in ${n}: ${g.nextOnly.join(', ')}.` : ''} Matched mean = mean over the shared tasks of each task's mean; every task weighs the same.`, '')
    if (!g.cells.length) {
      out.push('_No shared tasks: nothing to compare._', '')
      continue
    }
    out.push(table(['Metric (matched mean)', b, n, 'Δ', 'ratio', 'tasks'], c.metrics.filter((m) => g.matched[m].cells).map((m) => [METRICS[m]?.label ?? m, fmt(m, g.matched[m].base), fmt(m, g.matched[m].next), fmt(m, g.matched[m].delta, true), g.matched[m].ratio == null || METRICS[m]?.unit === '%' ? '—' : `${g.matched[m].ratio.toFixed(2)}×`, g.matched[m].cells])))
    out.push('')
    const tm = taskMetrics.filter((m) => c.metrics.includes(m))
    out.push(table(['Task', 'trials', ...tm.flatMap((m) => [`${METRICS[m]?.label ?? m}`, 'Δ'])], g.cells.map((cell) => [cell.task, `${cell.base.n} → ${cell.next.n}`, ...tm.flatMap((m) => [`${fmt(m, cell.base[m])} → ${fmt(m, cell.next[m])}`, fmt(m, cell.delta[m], true)])])))
    out.push('')
  }
  return out.join('\n')
}
