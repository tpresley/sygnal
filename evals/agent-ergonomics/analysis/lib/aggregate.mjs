// Aggregates over per-trial analysis records (see analyze.mjs).
import { CATALOG, CATALOG_BY_ID } from '../catalog.mjs'

export const PHASE_ORDER = ['orient', 'learn', 'implement', 'test-authoring', 'verify', 'debug', 'tooling-friction', 'think', 'report', 'other']

const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10)
const r2 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100)
export function mean(xs) {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
export function median(xs) {
  const v = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const mm = (xs) => ({ mean: r1(mean(xs)), median: r1(median(xs)) })
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000)
const mm3 = (xs) => ({ mean: r3(mean(xs)), median: r3(median(xs)) })

/** Summary stats for a group of trial records. */
export function groupStats(recs) {
  const a = recs.filter((r) => r.phases)
  const phases = {}
  for (const p of PHASE_ORDER) phases[p] = r1(mean(a.map((r) => r.phases[p] ?? 0)))
  const friction = {}
  for (const id of new Set(a.flatMap((r) => Object.keys(r.frictionSeconds ?? {})))) friction[id] = r1(mean(a.map((r) => r.frictionSeconds?.[id] ?? 0)))
  const learn = {}
  for (const t of new Set(a.flatMap((r) => Object.keys(r.learnSeconds ?? {})))) learn[t] = r1(mean(a.map((r) => r.learnSeconds?.[t] ?? 0)))
  return {
    n: a.length,
    pass: recs.filter((r) => r.scored?.pass).length,
    scored: recs.filter((r) => r.scored).length,
    wall: mm(a.map((r) => r.wallSeconds)),
    peakContext: mm(a.map((r) => r.tokens?.peakContext)),
    cacheCreation: mm(a.map((r) => r.tokens?.cacheCreation)),
    cacheRead: mm(a.map((r) => r.tokens?.cacheRead)),
    messages: mm(a.map((r) => r.tokens?.messages)),
    // Usage the harness recorded (headless result event or score.mjs flags); null for PLAN-1 runs.
    costUsd: mm3(a.map((r) => r.usage?.costUsd)),
    billedTokens: mm(a.map((r) => r.usage?.tokens)),
    outputTokens: mm(a.map((r) => r.usage?.outputTokens)),
    durationSeconds: mm(a.map((r) => (r.usage?.durationMs == null ? null : r.usage.durationMs / 1000))),
    iterations: mm(a.map((r) => r.iterations)),
    effectiveIterations: mm(a.map((r) => r.effectiveIterations)),
    editRounds: mm(a.map((r) => r.editRounds)),
    toolCalls: mm(a.map((r) => r.toolCalls?.total)),
    failedRuns: mm(a.map((r) => r.failures.filter((f) => f.kind === 'verify' && f.cause !== 'harness').length)),
    episodes: mm(a.map((r) => r.episodes.length)),
    locAdded: mm(a.filter((r) => r.diff).map((r) => r.diff.added)),
    locRemoved: mm(a.filter((r) => r.diff).map((r) => r.diff.removed)),
    wroteTest: a.filter((r) => r.wroteTest).length,
    keptTest: a.filter((r) => r.keptTests?.length).length,
    attributedShareMin: r2(Math.min(...a.map((r) => r.attributedShare))),
    attributedShareMean: r2(mean(a.map((r) => r.attributedShare))),
    phases,
    friction,
    learn,
  }
}

/**
 * Sygnal - React delta on the tasks both arms have, task-matched: for each
 * shared task, (Sygnal task mean - React task mean); then averaged over tasks.
 * Items: every phase except learn and tooling-friction, plus learn split by
 * topic and tooling-friction split by catalog ID. They sum to the wall-time
 * delta.
 */
export function deltaItems(records) {
  const tasks = sharedTasks(records)
  if (!tasks.length) return { tasks, wallDelta: null, items: [] }
  const keys = new Set()
  for (const r of records) {
    for (const p of Object.keys(r.phases ?? {})) if (p !== 'tooling-friction' && p !== 'learn') keys.add(`phase:${p}`)
    for (const id of Object.keys(r.frictionSeconds ?? {})) keys.add(`friction:${id}`)
    for (const t of Object.keys(r.learnSeconds ?? {})) keys.add(`learn:${t}`)
  }
  const val = (r, k) => {
    const [kind, name] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
    if (kind === 'phase') return r.phases?.[name] ?? 0
    if (kind === 'learn') return r.learnSeconds?.[name] ?? 0
    return r.frictionSeconds?.[name] ?? 0
  }
  const per = {}
  let wallDelta = 0
  for (const t of tasks) {
    const s = records.filter((r) => r.task === t && r.arm === 'sygnal' && r.phases)
    const re = records.filter((r) => r.task === t && r.arm === 'react' && r.phases)
    wallDelta += mean(s.map((r) => r.wallSeconds)) - mean(re.map((r) => r.wallSeconds))
    for (const k of keys) {
      const e = (per[k] ??= { sygnal: 0, react: 0 })
      e.sygnal += mean(s.map((r) => val(r, k)))
      e.react += mean(re.map((r) => val(r, k)))
    }
  }
  const n = tasks.length
  const items = Object.entries(per)
    .map(([k, v]) => ({ item: k, sygnal: r1(v.sygnal / n), react: r1(v.react / n), delta: r1((v.sygnal - v.react) / n) }))
    .sort((a, b) => b.delta - a.delta)
  const wd = wallDelta / n
  for (const it of items) it.shareOfDelta = wd ? r2(it.delta / wd) : null
  const buckets = {}
  for (const it of items) {
    const b = bucketOf(it.item)
    const e = (buckets[b] ??= { bucket: b, sygnal: 0, react: 0, delta: 0, items: [] })
    e.sygnal += it.sygnal
    e.react += it.react
    e.delta += it.delta
    e.items.push(it.item)
  }
  const bucketList = Object.values(buckets)
    .map((b) => ({ ...b, sygnal: r1(b.sygnal), react: r1(b.react), delta: r1(b.delta), shareOfDelta: wd ? r2(b.delta / wd) : null }))
    .sort((a, b) => b.delta - a.delta)
  return { tasks, wallDelta: r1(wd), items, buckets: bucketList }
}

// Groups for the "where does the delta come from" summary.
const TESTING_IDS = new Set(['B-007', 'B-006', 'G-015', 'G-016', 'G-018', 'NEW-TEST-RECIPE'])
export function bucketOf(item) {
  const [kind, name] = [item.slice(0, item.indexOf(':')), item.slice(item.indexOf(':') + 1)]
  if (kind === 'friction') {
    if (name === 'HARNESS-GUARD') return 'eval harness (worktree guard refusals)'
    if (TESTING_IDS.has(name)) return 'self-testing: framework/tooling defects'
    return 'other known defects'
  }
  if (kind === 'learn') {
    if (name === 'testing-utility' || name === 'vite-plugin' || name === 'run-mount-api') return 'self-testing: learning the test tooling'
    if (name === 'skill-load' || name === 'skill-reference') return 'learning: skill'
    return 'learning: framework API and source'
  }
  if (name === 'test-authoring') return 'self-testing: writing tests'
  if (name === 'verify') return 'build/test runs'
  if (name === 'debug') return 'debugging own mistakes'
  if (name === 'implement') return 'implementation'
  if (name === 'orient') return 'orientation'
  if (name === 'report') return 'final report'
  return 'other'
}

export function sharedTasks(records) {
  const s = new Set(records.filter((r) => r.arm === 'sygnal' && r.phases).map((r) => r.task))
  const re = new Set(records.filter((r) => r.arm === 'react' && r.phases).map((r) => r.task))
  return [...s].filter((t) => re.has(t)).sort()
}

/** Catalog hit table. */
export function catalogTable(records, tracker) {
  const out = []
  for (const e of CATALOG) {
    const byResult = records.filter((r) => r.catalog?.result.includes(e.id))
    const byReport = records.filter((r) => r.catalog?.report.includes(e.id))
    const byWork = records.filter((r) => r.catalog?.workaround.includes(e.id))
    const byInput = records.filter((r) => r.catalog?.input?.includes(e.id))
    const withFriction = records.filter((r) => (r.frictionSeconds?.[e.id] ?? 0) > 0)
    const any = new Set([...byResult, ...byReport, ...byWork, ...byInput].map((r) => r.trial))
    if (!any.size) continue
    const secs = withFriction.map((r) => r.frictionSeconds[e.id])
    const armCount = (arm) => [...any].filter((t) => t.startsWith(arm)).length
    const armTrials = (arm) => records.filter((r) => r.arm === arm && r.phases).length
    out.push({
      id: e.id,
      title: e.title,
      kind: e.kind,
      status: tracker[e.id]?.status ?? (e.id.startsWith('NEW') || e.id.startsWith('HARNESS') ? 'untracked' : e.id === 'ISOLATION' || e.id === 'RXJS' ? 'pitfall (diagnostics: SYG104 / strict mode)' : 'open'),
      trialsAffected: any.size,
      sygnal: `${armCount('sygnal')}/${armTrials('sygnal')}`,
      react: e.arms.includes('react') ? `${armCount('react')}/${armTrials('react')}` : '—',
      inResults: byResult.length,
      inReports: byReport.length,
      workarounds: byWork.length,
      inInputs: byInput.length,
      frictionTrials: withFriction.length,
      frictionSecondsTotal: r1(secs.reduce((a, b) => a + b, 0)),
      frictionSecondsPerAffected: r1(mean(secs)),
      frictionSecondsPerSygnalTrial: r1(withFriction.filter((r) => r.arm === 'sygnal').reduce((a, r) => a + r.frictionSeconds[e.id], 0) / Math.max(1, armTrials('sygnal'))),
      frictionSecondsPerReactTrial: r1(withFriction.filter((r) => r.arm === 'react').reduce((a, r) => a + r.frictionSeconds[e.id], 0) / Math.max(1, armTrials('react'))),
      trials: [...any].sort(),
    })
  }
  return out.sort((a, b) => b.frictionSecondsTotal - a.frictionSecondsTotal || b.trialsAffected - a.trialsAffected)
}

/** Skill section heatmap and library-reading summary (Sygnal arm), plus React docs reading. */
export function skillTable(records) {
  const sy = records.filter((r) => r.arm === 'sygnal' && r.skill)
  const sections = {}
  for (const r of sy) for (const s of new Set(r.skill.sections)) sections[s] = (sections[s] ?? 0) + 1
  const files = {}
  for (const r of sy)
    for (const [f, v] of Object.entries(r.skill.files)) {
      const e = (files[f] ??= { trials: 0, linesSeen: [], bytes: [], how: {} })
      e.trials++
      e.linesSeen.push(v.linesSeen)
      e.bytes.push(v.bytes)
      for (const h of v.how) e.how[h] = (e.how[h] ?? 0) + 1
      e.fileLines = v.fileLines
    }
  const lib = { sygnal: {}, react: {} }
  for (const r of records.filter((x) => x.skill)) {
    for (const [pkg, fl] of Object.entries(r.skill.library)) {
      const e = (lib[r.arm][pkg] ??= { trials: 0, files: {} })
      e.trials++
      for (const f of fl) e.files[f] = (e.files[f] ?? 0) + 1
    }
  }
  return {
    sygnalTrials: sy.length,
    skillInvoked: sy.filter((r) => r.skill.skillInvoked).length,
    skillBytes: mm(sy.map((r) => r.skill.skillBytes)),
    files: Object.fromEntries(Object.entries(files).map(([f, e]) => [f, { trials: e.trials, fileLines: e.fileLines, linesSeen: mm(e.linesSeen), bytes: mm(e.bytes), how: e.how }])),
    sections: Object.entries(sections).sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ section: s, trials: n })),
    library: lib,
    libraryBytes: { sygnal: mm(records.filter((r) => r.arm === 'sygnal' && r.skill).map((r) => r.skill.libraryBytes)), react: mm(records.filter((r) => r.arm === 'react' && r.skill).map((r) => r.skill.libraryBytes)) },
    libraryReaders: { sygnal: records.filter((r) => r.arm === 'sygnal' && r.skill && r.skill.libraryBytes > 0).length, react: records.filter((r) => r.arm === 'react' && r.skill && r.skill.libraryBytes > 0).length },
  }
}

/** PLAN-5 4-D: failed trials by category ({ arm: { category: { manual, auto } } }), and other skills used. */
export function failureCategoryTable(records) {
  const out = { sygnal: {}, react: {} }
  for (const r of records) {
    const f = r.failureAuto
    if (!f || !out[r.arm]) continue
    const e = (out[r.arm][f.category] ??= { manual: 0, auto: 0, trials: [] })
    e[f.source === 'manual' ? 'manual' : 'auto']++
    e.trials.push(r.trial)
  }
  return out
}

export function otherSkillTable(records) {
  const out = { sygnal: {}, react: {} }
  for (const r of records) for (const n of new Set(r.skill?.otherSkills ?? [])) if (out[r.arm]) out[r.arm][n] = (out[r.arm][n] ?? 0) + 1
  return out
}

export function canonicalTable(records) {
  const sy = records.filter((r) => r.arm === 'sygnal' && r.canonical)
  const keys = Object.keys(sy[0]?.canonical ?? {})
  const out = {}
  for (const k of keys) out[k] = { total: sy.reduce((a, r) => a + r.canonical[k], 0), trials: sy.filter((r) => r.canonical[k] > 0).length }
  const diag = {}
  for (const r of sy) for (const d of r.sygnalCheck?.diagnostics ?? []) (diag[d.code] ??= new Set()).add(r.trial)
  return { trials: sy.length, forms: out, sygnalCheck: Object.fromEntries(Object.entries(diag).map(([k, v]) => [k, [...v].sort()])), checkErrors: sy.filter((r) => r.sygnalCheck?.error).map((r) => r.trial) }
}

export function failureTable(records) {
  const sig = {}
  for (const r of records)
    for (const f of r.failures ?? []) {
      if (f.cause === 'harness') continue
      if (f.kind !== 'verify') continue
      const k = `${r.arm}\t${f.signature}`
      const e = (sig[k] ??= { arm: r.arm, signature: f.signature, cause: f.cause, catalog: f.friction?.length ? f.friction : f.catalog, count: 0, trials: new Set() })
      e.count++
      e.trials.add(r.trial)
    }
  const episodes = { sygnal: {}, react: {} }
  for (const r of records)
    for (const e of r.episodes ?? []) {
      const k = e.friction?.[0] ?? e.cause
      const x = (episodes[r.arm][k] ??= { episodes: 0, seconds: 0, iterations: 0, unresolved: 0 })
      x.episodes++
      x.seconds += e.seconds
      x.iterations += e.iterations
      if (!e.resolved) x.unresolved++
    }
  for (const arm of Object.keys(episodes)) for (const x of Object.values(episodes[arm])) x.seconds = r1(x.seconds)
  return {
    signatures: Object.values(sig)
      .map((e) => ({ ...e, trials: e.trials.size }))
      .sort((a, b) => b.trials - a.trials || b.count - a.count),
    episodes,
  }
}

export function aggregate(records, { tracker = {} } = {}) {
  const tasks = [...new Set(records.map((r) => r.task))].sort()
  const byTask = {}
  for (const t of tasks) {
    byTask[t] = {}
    for (const arm of ['sygnal', 'react']) {
      const g = records.filter((r) => r.task === t && r.arm === arm)
      if (g.length) byTask[t][arm] = groupStats(g)
    }
  }
  const shared = sharedTasks(records)
  const overall = {}
  const overallShared = {}
  for (const arm of ['sygnal', 'react']) {
    const g = records.filter((r) => r.arm === arm)
    if (g.length) overall[arm] = groupStats(g)
    const gs = g.filter((r) => shared.includes(r.task))
    if (gs.length) overallShared[arm] = groupStats(gs)
  }
  return {
    tasks,
    sharedTasks: shared,
    byTask,
    overall,
    overallShared,
    delta: deltaItems(records),
    catalog: catalogTable(records, tracker),
    skill: skillTable(records),
    canonical: canonicalTable(records),
    failures: failureTable(records),
    failureCategories: failureCategoryTable(records),
    otherSkills: otherSkillTable(records),
  }
}

export { CATALOG_BY_ID }
