// Trial planning for orchestrate.mjs (pure; unit-tested in tests/plan.unit.mjs).
//
// Tasks are read from the task catalog (tasks/NN-slug, react/tasks/NN-slug), so
// new tasks are picked up without code changes. Tiers are number ranges:
// tier1 = 01-08, tier2 = 09-12, tier3 = 13-17, ts = 18-21 (TypeScript variants of
// 02, 03, 09 and 12; PLAN-2 E10), net = 22-25 (WebSocket, declarative read, query cache, router;
// PLAN-3 0-C, 5-6), ergo = 26-29 (autosave, undo/redo, stopwatch, accessible signup; PLAN-4 0-C),
// p5 = 30-34 (checkout form, command menu, chart widget, virtual list, sortable list; PLAN-5 4-E),
// mod = 35-43 (modify existing code: add / change / remove at three app sizes; PLAN-5 p5-mod).
// A new task in an existing tier needs its range widened here.

export const TIERS = {
  tier1: (n) => n >= 1 && n <= 8,
  tier2: (n) => n >= 9 && n <= 12,
  tier3: (n) => n >= 13 && n <= 17,
  ts: (n) => n >= 18 && n <= 21,
  net: (n) => n >= 22 && n <= 25,
  ergo: (n) => n >= 26 && n <= 29,
  p5: (n) => n >= 30 && n <= 34,
  mod: (n) => n >= 35 && n <= 43,
}

const taskNum = (t) => Number(String(t).slice(0, 2))
const pad = (n) => String(n).padStart(2, '0')

/**
 * Which task numbers a --tasks spec selects: "all", "tier1".."tier3", "ts", "net", "ergo", "p5", "mod", "03",
 * "01-05", or a comma list of these. Returns a predicate over task numbers.
 */
export function taskSelector(spec = 'all') {
  const parts = String(spec).split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) throw new Error('--tasks is empty')
  const preds = parts.map((p) => {
    if (p === 'all') return () => true
    if (TIERS[p]) return TIERS[p]
    let m = p.match(/^(\d{1,2})-(\d{1,2})$/)
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])]
      return (n) => n >= a && n <= b
    }
    m = p.match(/^(\d{1,2})(?:-[a-z][\w-]*)?$/)
    if (m) return (n) => n === Number(m[1])
    throw new Error(`Bad --tasks entry "${p}" (use all, tier1|tier2|tier3|ts|net|ergo|p5|mod, 03, 01-05, or a comma list)`)
  })
  return (n) => preds.some((f) => f(n))
}

export const trialName = (arm, task, k) => `${arm}-${pad(taskNum(task))}-t${k}`

/**
 * Build the plan.
 * @param o.arms          ['sygnal', 'react']
 * @param o.tasksByArm    { sygnal: ['01-clear-completed', ...], react: [...] }
 * @param o.tasksSpec     --tasks
 * @param o.trials        trials per (task, arm)
 * @param o.startTrial    first trial id (default 1)
 * @param o.scored        records of results/<run>.json
 * @param o.state(name)   -> 'none' | 'prepared' | 'ran' | 'partial': what exists on disk for a trial
 * @returns { items: [{ arm, task, trial, name, action }], unavailable: [{ arm, taskNum }] }
 *   action: 'skip' (already scored) | 'score' (agent finished, not scored) |
 *           'run' (prepared, never run) | 'redo' (a partial run is moved aside, then prepare+run) |
 *           'new' (prepare + run + score)
 */
export function buildPlan({ arms, tasksByArm, tasksSpec = 'all', trials = 1, startTrial = 1, scored = [], state = () => 'none' }) {
  const sel = taskSelector(tasksSpec)
  const items = []
  const unavailable = []
  const wanted = new Set()
  for (const arm of arms) for (const t of tasksByArm[arm] ?? []) if (sel(taskNum(t))) wanted.add(taskNum(t))
  for (const n of [...wanted].sort((a, b) => a - b)) {
    for (const arm of arms) {
      const task = (tasksByArm[arm] ?? []).find((t) => taskNum(t) === n)
      if (!task) {
        unavailable.push({ arm, taskNum: pad(n) })
        continue
      }
      for (let k = startTrial; k < startTrial + trials; k++) {
        const name = trialName(arm, task, k)
        const done = scored.some((r) => r.task === task && r.arm === arm && r.trial === k)
        let action
        if (done) action = 'skip'
        else {
          const s = state(name)
          action = s === 'ran' ? 'score' : s === 'prepared' ? 'run' : s === 'partial' ? 'redo' : 'new'
        }
        items.push({ arm, task, trial: k, name, action })
      }
    }
  }
  return { items, unavailable }
}

/**
 * Estimate cost and time of the trials still to run, from earlier records that
 * carry usage (any results/*.json; headless records have costUsd/durationMs).
 * Per (arm, task) mean if known, else the arm mean, else the overall mean.
 * Wall time of trials without a usage record falls back to their wallSeconds.
 */
export function estimate(items, history, { concurrency = 1, overheadSec = 45 } = {}) {
  const todo = items.filter((i) => i.action !== 'skip')
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const pick = (recs, f) => recs.map(f).filter((x) => typeof x === 'number' && !Number.isNaN(x))
  const durOf = (r) => (r.durationMs != null ? r.durationMs / 1000 : r.wallSeconds)
  const lookup = (i, f) => {
    const own = pick(history.filter((r) => r.arm === i.arm && r.task === i.task), f)
    if (own.length) return { v: mean(own), basis: 'task' }
    const arm = pick(history.filter((r) => r.arm === i.arm), f)
    if (arm.length) return { v: mean(arm), basis: 'arm' }
    const all = pick(history, f)
    if (all.length) return { v: mean(all), basis: 'all' }
    return { v: null, basis: 'none' }
  }
  let cost = 0
  let costKnown = 0
  let agentSec = 0
  let secKnown = 0
  const basis = { task: 0, arm: 0, all: 0, none: 0 }
  for (const i of todo.filter((x) => x.action !== 'score')) {
    const c = lookup(i, (r) => r.costUsd)
    if (c.v != null) {
      cost += c.v
      costKnown++
    }
    basis[c.basis]++
    const s = lookup(i, durOf)
    if (s.v != null) {
      agentSec += s.v
      secKnown++
    }
  }
  const runs = todo.filter((x) => x.action !== 'score').length
  const totalSec = agentSec + runs * overheadSec + todo.length * 15
  return {
    trials: todo.length,
    agentRuns: runs,
    scoreOnly: todo.length - runs,
    costUsd: costKnown ? cost : null,
    costCoverage: runs ? costKnown / runs : 1,
    costBasis: basis,
    agentSeconds: secKnown ? agentSec : null,
    wallSeconds: Math.round(totalSec / Math.max(1, concurrency)),
  }
}
