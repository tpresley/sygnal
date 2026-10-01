#!/usr/bin/env node
// One command for a whole eval run: pack Sygnal once, then for every
// (task, arm, trial): prepare the trial dir, run the agent headless, compute
// transcript stats, score the hidden tests; N trials at a time. Then analyze.
//
// Usage:
//   node evals/agent-ergonomics/orchestrate.mjs --run <name>
//        [--arms sygnal,react]          default: both
//        [--tasks all]                  all | tier1 | tier2 | tier3 | 03 | 01-05 | comma list
//        [--trials 1]                   trials per (task, arm); ids start at --start-trial (1)
//        [--concurrency 2]              trials in flight at once
//        [--model claude-opus-5-5]      trial model (default claude-opus-5-5). Aliases (opus, sonnet, haiku)
//                                       are resolved by the installed CLI, which may map them to an older
//                                       model; the run stops if the model used differs from the one meant
//        [--no-preflight]               skip the tiny claude -p call that checks auth + model before any trial
//        [--preflight]                  with --dry-run: also make that call, to show the resolved model
//        [--effort high]                trial effort level; default: the CLI's default
//        [--timeout-min 30]             per-trial limit; a timed-out trial is scored as is
//        [--max-budget-usd N]           per-trial spend cap passed to claude
//        [--trials-root /tmp/sygnal-evals/trials]   trial dirs go to <root>/<run>/<arm>-<NN>-t<k>
//        [--tarball <sygnal.tgz>]       default: build + pack this checkout once per run
//        [--verify]                     run verify.mjs against the tarball before any trial
//        [--dry-run]                    print the plan and the estimate; run nothing
//        [--no-analyze] [--no-check]    skip analyze.mjs / sygnal-check inside it
//        [--allow-mixed]                resume a run with a different model/effort/tarball, or accept a model mismatch
//        [--claude-bin claude] [--permission-mode acceptEdits] [--tools Bash,Read,...]
//
// Resumable: trials that already have a record in results/<run>.json are
// skipped; a trial whose agent finished but wasn't scored is only scored; a
// trial that was prepared but never started is run; a partial trial (crashed,
// auth failure, interrupted) is moved aside to <dest>.stale-<time> and redone.
// Results: results/<run>.json (score.mjs), results/transcripts/<run>.tsv (trial
// map, source "headless"), results/analysis/<run>.{json,md} (analyze.mjs).
// The run's tarball, model, CLI version and git sha are in <root>/<run>/manifest.json.
//
// A trial whose agent never ran (auth failure, is_error result, no API time, no
// model turn) is not scored and leaves no analysis entry; its dir stays
// prepared (the failed attempt's sidecars are renamed *.notrun-<time>) so the
// next invocation retries it. An auth failure or a model mismatch stops the run.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { EVAL_ROOT, REPO_ROOT, ARMS, listTasks, parseArgs, packSygnal } from './lib/common.mjs'
import { buildPlan, estimate } from './lib/plan.mjs'
import { runTrial } from './lib/runner.mjs'
import { trialFiles, DEFAULT_TIMEOUT_MIN, DEFAULT_MODEL, resolveModel } from './lib/headless.mjs'
import { preflight } from './lib/runner.mjs'
import { transcriptStats } from './lib/transcript.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
const str = (k, d) => (typeof args[k] === 'string' ? args[k] : d)
const usage = () => {
  console.error('usage: orchestrate.mjs --run <name> [--arms sygnal,react] [--tasks all|tier1|01-05|...] [--trials N] [--concurrency N] [--model M] [--effort E] [--timeout-min N] [--max-budget-usd N] [--trials-root dir] [--tarball f.tgz] [--verify] [--dry-run] [--no-analyze] [--no-check]')
  process.exit(2)
}
const run = str('run')
if (!run || !/^[\w.-]+$/.test(run)) usage()
const arms = str('arms', ARMS.join(',')).split(',').map((s) => s.trim()).filter(Boolean)
for (const a of arms) if (!ARMS.includes(a)) usage()
const trials = Number(str('trials', '1'))
const startTrial = Number(str('start-trial', '1'))
const concurrency = Math.max(1, Number(str('concurrency', '2')))
const timeoutMin = Number(str('timeout-min', String(DEFAULT_TIMEOUT_MIN)))
const model = str('model', DEFAULT_MODEL)
const expectedModel = resolveModel(model)
const claudeBin = str('claude-bin', 'claude')
const claudeVersion = (() => {
  const r = spawnSync(claudeBin, ['--version'], { encoding: 'utf8', timeout: 20000 })
  return r.status === 0 ? r.stdout.trim() : null
})()
const effort = str('effort')
const dryRun = !!args['dry-run']

/** realpath of a path that may not exist yet (macOS: /tmp -> /private/tmp; agents see the resolved cwd). */
function resolveReal(p) {
  const abs = path.resolve(p)
  let head = abs
  const tail = []
  while (!fs.existsSync(head)) {
    tail.unshift(path.basename(head))
    head = path.dirname(head)
  }
  return path.join(fs.realpathSync(head), ...tail)
}
const trialsRoot = resolveReal(str('trials-root', process.env.EVAL_TRIALS_ROOT ?? path.join('/tmp', 'sygnal-evals', 'trials')))
const runDir = path.join(trialsRoot, run)
if ((runDir + path.sep).startsWith(REPO_ROOT + path.sep)) {
  console.error(`--trials-root must be outside the repository (${REPO_ROOT})`)
  process.exit(2)
}
const resultsFile = path.join(EVAL_ROOT, 'results', `${run}.json`)
const readScored = () => (fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : [])

// ---- trial state on disk
function readMeta(dest) {
  try {
    return JSON.parse(fs.readFileSync(trialFiles(dest).meta, 'utf8'))
  } catch {
    return null
  }
}
function trialState(name) {
  const dest = path.join(runDir, name)
  const f = trialFiles(dest)
  if (!fs.existsSync(dest) || fs.readdirSync(dest).length === 0) return fs.existsSync(f.transcript) ? 'partial' : 'none'
  const meta = readMeta(dest)
  // Metas from before agentRan existed: a completed run without is_error counts.
  const ran = meta && (meta.agentRan ?? (meta.completed && !meta.isError))
  if (ran && meta.modelCheck?.ok !== false) return 'ran'
  if (!meta && !fs.existsSync(f.transcript) && fs.existsSync(f.prompt) && fs.existsSync(path.join(dest, 'node_modules'))) return 'prepared'
  return 'partial'
}

// ---- plan
const tasksByArm = Object.fromEntries(arms.map((a) => [a, listTasks(a)]))
const plan = buildPlan({ arms, tasksByArm, tasksSpec: str('tasks', 'all'), trials, startTrial, scored: readScored(), state: trialState })
const history = fs
  .readdirSync(path.join(EVAL_ROOT, 'results'))
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => {
    try {
      const recs = JSON.parse(fs.readFileSync(path.join(EVAL_ROOT, 'results', f), 'utf8'))
      return Array.isArray(recs) ? recs.filter((r) => !model || !r.model || r.model.includes(model) || r.modelRequested === model) : []
    } catch {
      return []
    }
  })
const est = estimate(plan.items, history, { concurrency })

const fmtDur = (s) => (s == null ? '?' : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`)
console.log(`Run "${run}" → ${runDir}`)
console.log(`  arms: ${arms.join(', ')} · tasks: ${str('tasks', 'all')} · trials per task/arm: ${trials} (ids ${startTrial}..${startTrial + trials - 1}) · concurrency: ${concurrency}`)
console.log(`  model: ${model}${expectedModel !== model ? ` (alias; must resolve to ${expectedModel})` : ''}${effort ? ` · effort: ${effort}` : ''} · timeout: ${timeoutMin} min per trial`)
console.log(`  claude CLI: ${claudeVersion ?? `not found (${claudeBin})`} · a preflight call checks auth and the resolved model before the first trial${args['no-preflight'] ? ' (disabled: --no-preflight)' : ''}`)
const byAction = {}
for (const i of plan.items) (byAction[i.action] ??= []).push(i.name)
for (const [a, names] of Object.entries(byAction)) {
  const shown = args.verbose || names.length <= 16 ? names.join(' ') : `${names.slice(0, 12).join(' ')} … (+${names.length - 12} more; --verbose lists all)`
  console.log(`  ${a.padEnd(5)} ${String(names.length).padStart(3)}: ${shown}`)
}
if (plan.unavailable.length) console.log(`  not in that arm (skipped): ${plan.unavailable.map((u) => `${u.arm}-${u.taskNum}`).join(' ')}`)
console.log(
  `  estimate: ${est.agentRuns} agent run(s) + ${est.scoreOnly} score-only; ` +
    `cost ${est.costUsd == null ? 'unknown (no earlier records with costUsd)' : `≈ $${est.costUsd.toFixed(2)}${est.costCoverage < 1 ? ` for ${Math.round(est.costCoverage * 100)}% of runs with cost data` : ''}`}; ` +
    `wall ≈ ${fmtDur(est.wallSeconds)} at concurrency ${concurrency}` +
    (est.agentSeconds == null ? ' (no duration history; overhead only)' : '')
)
if (arms.includes('sygnal')) {
  const installed = path.join(os.homedir(), '.claude', 'skills', 'sygnal-dev', 'SKILL.md')
  const repo = path.join(REPO_ROOT, 'skills', 'sygnal-dev', 'SKILL.md')
  if (!fs.existsSync(installed)) console.log(`  WARNING: no installed sygnal-dev skill at ${installed}; Sygnal-arm agents are told to use it.`)
  else if (fs.existsSync(repo) && fs.readFileSync(installed, 'utf8') !== fs.readFileSync(repo, 'utf8')) console.log('  WARNING: the installed sygnal-dev skill differs from skills/sygnal-dev in this checkout (PLAN-1 D35: re-sync before an eval run).')
}
if (dryRun && args.preflight) {
  const pf = await preflight({ model, effort, claudeBin })
  console.log(`  preflight: ${pf.ok ? 'ok' : `FAILED: ${pf.reason}`} · resolved model: ${pf.model ?? '?'}${pf.modelCheck.ok ? '' : ` (MISMATCH: expected ${pf.modelCheck.expected})`}`)
}
if (dryRun) process.exit(0)

const todo = plan.items.filter((i) => i.action !== 'skip')
if (!todo.length) {
  console.log('Nothing to do.')
} else {
  // ---- manifest + tarball (once per run)
  fs.mkdirSync(runDir, { recursive: true })
  const manifestFile = path.join(runDir, 'manifest.json')
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  const mixed = manifest && ((manifest.model ?? null) !== (model ?? null) || (manifest.effort ?? null) !== (effort ?? null))
  if (mixed && !args['allow-mixed']) {
    console.error(`This run started with model=${manifest.model ?? 'default'} effort=${manifest.effort ?? 'default'}; pass the same, or --allow-mixed.`)
    process.exit(2)
  }
  if (manifest?.claudeVersion && claudeVersion && manifest.claudeVersion !== claudeVersion) console.log(`WARNING: this run started with claude ${manifest.claudeVersion}; now ${claudeVersion}. Trials in one run should use one CLI version.`)
  if (!args['no-preflight']) {
    process.stdout.write(`Preflight: claude -p on ${model} ... `)
    const pf = await preflight({ model, effort, claudeBin })
    console.log(pf.ok ? `ok (${pf.model}, ${(pf.wallMs / 1000).toFixed(0)} s)` : 'FAILED')
    if (!pf.ok) {
      console.error(`Preflight failed: ${pf.reason}. No trial was started.`)
      process.exit(1)
    }
    if (!pf.modelCheck.ok && !args['allow-mixed']) {
      console.error(`Preflight: --model ${model} ran on ${pf.model}, not ${pf.modelCheck.expected}. Pass the full model id, update the CLI, or pass --allow-mixed. No trial was started.`)
      process.exit(1)
    }
  }
  let tarball = manifest?.tarball
  if (arms.includes('sygnal') && todo.some((i) => i.arm === 'sygnal' && i.action !== 'score')) {
    if (str('tarball')) tarball = path.resolve(str('tarball'))
    else if (!tarball || !fs.existsSync(tarball)) {
      console.log('Building and packing Sygnal once for this run ...')
      tarball = packSygnal(path.join(runDir, '_pack'), { build: true })
    }
    if (manifest?.tarballSha256 && sha256(tarball) !== manifest.tarballSha256 && !args['allow-mixed']) {
      console.error(`The tarball differs from the one this run started with (${manifest.tarball}); pass --allow-mixed to continue anyway.`)
      process.exit(2)
    }
    if (args.verify) {
      console.log('verify.mjs ...')
      const v = spawnSync(process.execPath, [path.join(HERE, 'verify.mjs'), '--tarball', tarball], { stdio: 'inherit' })
      if (v.status !== 0) process.exit(1)
    }
  }
  const gitSha = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || null
  fs.writeFileSync(
    manifestFile,
    JSON.stringify({ ...(manifest ?? {}), run, createdAt: manifest?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), method: 'headless', model: manifest?.model ?? model ?? null, modelExpected: manifest?.modelExpected ?? expectedModel, claudeVersion: manifest?.claudeVersion ?? claudeVersion, claudeVersions: [...new Set([...(manifest?.claudeVersions ?? (manifest?.claudeVersion ? [manifest.claudeVersion] : [])), claudeVersion].filter(Boolean))], effort: manifest?.effort ?? effort ?? null, tarball: tarball ?? null, tarballSha256: tarball ? sha256(tarball) : null, gitSha: manifest?.gitSha ?? gitSha }, null, 2) + '\n'
  )

  // ---- run the pool
  const logFile = path.join(runDir, 'orchestrate.log.jsonl')
  const log = (o) => fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n')
  const live = new Set()
  let aborted = null
  const stop = (sig) => {
    aborted = `interrupted (${sig})`
    for (const pid of live) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {}
    }
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  let notRunStreak = 0
  let scoring = Promise.resolve()
  const serially = (fn) => {
    const p = scoring.then(fn, fn)
    scoring = p.catch(() => {})
    return p
  }
  const summary = []
  let done = 0
  const queue = [...todo]

  async function doTrial(item) {
    const dest = path.join(runDir, item.name)
    const tag = `[${item.name}]`
    const t0 = Date.now()
    if (item.action === 'redo') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      for (const p of [dest, ...Object.values(trialFiles(dest))]) if (fs.existsSync(p)) fs.renameSync(p, `${p}.stale-${stamp}`)
      console.log(`${tag} partial earlier attempt moved aside (*.stale-${stamp})`)
    }
    if (item.action === 'new' || item.action === 'redo') {
      const pa = ['--arm', item.arm, '--task', item.task, '--dest', dest]
      if (item.arm === 'sygnal') pa.push('--tarball', tarball)
      const r = await node(path.join(HERE, 'prepare.mjs'), pa)
      if (r.code !== 0) throw new Error(`prepare failed: ${r.stderr.slice(-1500)}`)
    }
    if (aborted) return { name: item.name, status: 'not run', reason: aborted }
    let meta = readMeta(dest)
    if (item.action !== 'score') {
      console.log(`${tag} running agent (${model}) ...`)
      meta = await runTrial({
        dest, model, effort, timeoutMin,
        maxBudgetUsd: str('max-budget-usd') ? Number(str('max-budget-usd')) : undefined,
        permissionMode: str('permission-mode'), tools: str('tools'), claudeBin,
        onSpawn: (child) => live.add(child.pid), onExit: (child) => live.delete(child.pid),
      })
      log({ trial: item.name, event: 'ran', ok: meta.ok, agentRan: meta.agentRan, notRunReason: meta.notRunReason, timedOut: meta.timedOut, exitCode: meta.exitCode, costUsd: meta.costUsd, tokens: meta.tokens, wallMs: meta.wallMs, model: meta.model })
      if (!meta.agentRan) {
        const kept = setAsideNotRun(dest, meta)
        if (meta.authFailed) aborted = 'the trial agent could not authenticate (401); log in again or set ANTHROPIC_API_KEY, then re-run this command'
        else if (++notRunStreak >= 2) aborted = `two trials in a row did not run (${meta.notRunReason})`
        return { name: item.name, status: 'not run', reason: `${meta.notRunReason}${kept ? '; trial dir left prepared for a retry' : '; the trial will be redone'}` }
      }
      notRunStreak = 0
      if (!meta.modelCheck?.ok && !args['allow-mixed']) {
        aborted = `trial ran on ${meta.model}, not ${meta.modelCheck?.expected}; not scored (pass the full model id, or --allow-mixed)`
        return { name: item.name, status: 'not run', reason: aborted }
      }
    }
    const stats = transcriptStats(fs.readFileSync(trialFiles(dest).transcript, 'utf8'), dest)
    const notes = [meta?.timedOut ? `timed out after ${timeoutMin} min` : null, stats.audit.length ? `AUDIT: ${stats.audit.length} flagged call(s), review before trusting (run.md step 3)` : null].filter(Boolean).join('; ')
    const sa = ['--dir', dest, '--task', item.task, '--arm', item.arm, '--trial', String(item.trial), '--run', run, '--method', 'headless', '--iterations', String(stats.iterations), '--edit-rounds', String(stats.editRounds)]
    const wall = meta?.wallMs != null ? Math.round(meta.wallMs / 1000) : stats.wallSeconds
    if (wall != null) sa.push('--wall-seconds', String(wall))
    const opt = { 'duration-ms': meta?.durationMs, tokens: meta?.tokens, 'output-tokens': meta?.outputTokens, 'cost-usd': meta?.costUsd, model: meta?.model ?? model }
    for (const [k, v] of Object.entries(opt)) if (v != null) sa.push(`--${k}`, String(v))
    if (meta?.timedOut) sa.push('--category', 'other')
    if (notes) sa.push('--notes', notes)
    const sr = await serially(() => node(path.join(HERE, 'score.mjs'), sa))
    if (sr.code !== 0 && !sr.stdout.trim().startsWith('{')) throw new Error(`score failed: ${sr.stderr.slice(-1500)}`)
    const rec = JSON.parse(sr.stdout)
    updateMap(item.name)
    log({ trial: item.name, event: 'scored', pass: rec.pass, testsPassed: rec.testsPassed, testsTotal: rec.testsTotal, audit: stats.audit.length })
    return { name: item.name, status: rec.pass ? 'pass' : 'FAIL', tests: `${rec.testsPassed}/${rec.testsTotal}`, wall: rec.wallSeconds, costUsd: rec.costUsd, tokens: rec.tokens, iterations: rec.iterations, audit: stats.audit.length, secs: Math.round((Date.now() - t0) / 1000) }
  }

  async function worker() {
    while (queue.length) {
      const item = queue.shift()
      if (aborted) {
        summary.push({ name: item.name, status: 'not run', reason: aborted })
        continue
      }
      let r
      try {
        r = await doTrial(item)
      } catch (e) {
        r = { name: item.name, status: 'error', reason: e.message.split('\n')[0] }
        log({ trial: item.name, event: 'error', error: e.message })
      }
      summary.push(r)
      done++
      console.log(`[${done}/${todo.length}] ${r.name}: ${r.status}${r.tests ? ` ${r.tests}` : ''}${r.wall != null ? ` · ${r.wall} s` : ''}${r.costUsd != null ? ` · $${r.costUsd.toFixed(2)}` : ''}${r.tokens != null ? ` · ${(r.tokens / 1000).toFixed(0)}k tokens` : ''}${r.audit ? ` · AUDIT ${r.audit}` : ''}${r.reason ? ` · ${r.reason}` : ''}`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))

  const ran = summary.filter((s) => s.status === 'pass' || s.status === 'FAIL')
  const notRun = summary.filter((s) => s.status === 'not run')
  const cost = ran.reduce((a, s) => a + (s.costUsd ?? 0), 0)
  console.log(`\nDone: ${ran.length} scored (${ran.filter((s) => s.status === 'pass').length} pass), ${summary.filter((s) => s.status === 'error').length} error(s), ${notRun.length} not run (not scored; re-run the command to retry them). Cost this invocation: $${cost.toFixed(2)}.`)
  if (aborted) console.log(`Stopped early: ${aborted}`)
  if (ran.some((s) => s.status === 'FAIL')) console.log('Failed trials need a category: score.mjs --classify (run.md step 5).')
  if (ran.some((s) => s.audit)) console.log('Some trials have audit hits: read them (transcript-stats.mjs <transcript> --dir <trial>) before using the results.')
  if (aborted || notRun.length) process.exitCode = 1
}

// ---- analyze
if (!args['no-analyze'] && readScored().length) {
  const aa = ['--run', run, '--trials-root', trialsRoot]
  if (args['no-check']) aa.push('--no-check')
  const r = spawnSync(process.execPath, [path.join(HERE, 'analysis', 'analyze.mjs'), ...aa], { encoding: 'utf8' })
  process.stdout.write(r.stdout)
  if (r.status !== 0) process.stderr.write(r.stderr)
}

// ---- helpers
/**
 * A run whose agent never took a turn left the trial dir untouched: rename its
 * sidecars (*.notrun-<time>) so the dir reads as 'prepared' and is retried. If
 * the agent did take turns before failing, the dir may be modified: keep the
 * sidecars, so the next invocation redoes the trial from scratch.
 */
function setAsideNotRun(dest, meta) {
  if ((meta.turns ?? 0) > 0) return false
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const f = trialFiles(dest)
  for (const p of [f.transcript, f.meta, f.stderr]) if (fs.existsSync(p)) fs.renameSync(p, `${p}.notrun-${stamp}`)
  return true
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function node(script, argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/** results/transcripts/<run>.tsv: trial -> "headless" (analyze.mjs finds the transcript next to the trial dir). */
function updateMap(name) {
  const f = path.join(EVAL_ROOT, 'results', 'transcripts', `${run}.tsv`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [`# ${run}: headless trials (orchestrate.mjs); transcripts are <trials-root>/${run}/<trial>.transcript.jsonl`]
  const rows = lines.filter((l) => !l.startsWith('#') && l.split('\t')[0] !== name)
  rows.push(`${name}\theadless`)
  fs.writeFileSync(f, [...lines.filter((l) => l.startsWith('#')), ...rows.sort()].join('\n') + '\n')
}
