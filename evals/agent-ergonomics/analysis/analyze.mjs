#!/usr/bin/env node
// Friction analyzer: explains where agent time goes in one eval run.
//
// Usage:
//   node evals/agent-ergonomics/analysis/analyze.mjs --run baseline \
//        [--map results/transcripts/baseline.tsv]   trial name -> agentId (default: that path)
//        [--transcripts <dir>]                        dir holding agent-<id>.jsonl
//        [--trials-root <dir>]                        dir holding <run>/<trial>/ final code (repeatable via comma)
//        [--skill-dir <dir>]                          installed sygnal-dev skill (default ~/.claude/skills/sygnal-dev)
//        [--no-check]                                 skip sygnal-check
//        [--only sygnal-05-t2]                        analyze a subset (regex on trial name)
//
// Writes results/analysis/<run>.json (one record per trial plus aggregates)
// and results/analysis/<run>.md (the human report). Trials whose transcript
// or final code is missing are analyzed as far as possible and flagged.
// Re-run it as more trials arrive; it is deterministic for a fixed input.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, resolveTask, armPaths, EVAL_ROOT, REPO_ROOT } from '../lib/common.mjs'
import { parseTranscriptFile } from './lib/parse.mjs'
import { buildTimeline } from './lib/timeline.mjs'
import { loadSkill, skillUsage, SKILL_DIR_DEFAULT } from './lib/skill.mjs'
import { diffAgainstStarter, canonicalForms, sourceText, keptTests, testApproach, runSygnalCheck, driverCatchWorkaround } from './lib/code.mjs'
import { selfReportedIssues } from './lib/selfreport.mjs'
import { matchReport, matchWorkaround, trackerStatus } from './catalog.mjs'
import { isTestPath, EDIT_TOOLS } from './lib/classify.mjs'
import { aggregate } from './lib/aggregate.mjs'
import { renderMarkdown } from './lib/report.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
if (!args.run || args.run === true) {
  console.error('usage: analyze.mjs --run <name> [--map <tsv>] [--transcripts <dir>] [--trials-root <dir>] [--skill-dir <dir>] [--no-check] [--only <re>]')
  process.exit(2)
}
const run = String(args.run)

// Defaults for this machine's eval session; override with flags or env.
const SESSION = 'd809df86-1837-4e39-86a8-a7278972fd84'
const DEFAULT_TRANSCRIPTS = process.env.EVAL_TRANSCRIPTS ?? path.join(process.env.HOME ?? '', '.claude/projects/-Users-troy-Documents-Displera-sygnal--claude-worktrees-agent-ergonomics', SESSION, 'subagents')
const SCRATCH = process.env.EVAL_SCRATCH ?? `/private/tmp/claude-501/-Users-troy-Documents-Displera-sygnal/${SESSION}/scratchpad`
const DEFAULT_TRIAL_ROOTS = [path.join(SCRATCH, 'runs'), path.join(SCRATCH, 'evals', 'trials')]

const mapFile = path.resolve(EVAL_ROOT, typeof args.map === 'string' ? args.map : `results/transcripts/${run}.tsv`)
const transcriptsDir = typeof args.transcripts === 'string' ? args.transcripts : DEFAULT_TRANSCRIPTS
const trialRoots = typeof args['trials-root'] === 'string' ? args['trials-root'].split(',') : DEFAULT_TRIAL_ROOTS
const skillDir = typeof args['skill-dir'] === 'string' ? args['skill-dir'] : SKILL_DIR_DEFAULT
const checkBin = path.join(REPO_ROOT, 'sygnal-check', 'bin', 'sygnal-check.js')
const doCheck = !args['no-check'] && fs.existsSync(checkBin) && fs.existsSync(path.join(REPO_ROOT, 'sygnal-check', 'node_modules'))
const trackerFile = path.join(REPO_ROOT, 'dev-plans', 'PLAN-1-status.md')

if (!fs.existsSync(mapFile)) {
  console.error(`No trial map at ${mapFile}`)
  process.exit(2)
}
const resultsFile = path.join(EVAL_ROOT, 'results', `${run}.json`)
const scored = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : []
const skill = loadSkill(skillDir)
const tracker = trackerStatus(trackerFile)

const mapRows = fs
  .readFileSync(mapFile, 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => l.split('\t'))
  .filter((r) => !args.only || new RegExp(args.only).test(r[0]))

function findTrialDir(trial) {
  for (const root of trialRoots) {
    const p = path.join(root, run, trial)
    if (fs.existsSync(path.join(p, 'package.json'))) return p
  }
  return null
}

const records = []
for (const [trial, agentId] of mapRows) {
  const m = trial.match(/^(sygnal|react)-(\d\d)-t(\d+)$/)
  if (!m) {
    console.error(`skip: unrecognized trial name ${trial}`)
    continue
  }
  const [, arm, taskNum, trialNo] = m
  let task
  try {
    task = resolveTask(arm, taskNum)
  } catch (e) {
    console.error(`skip ${trial}: ${e.message}`)
    continue
  }
  const rec = { trial, run, arm, task, trialNo: Number(trialNo), agentId, flags: [] }
  const score = scored.find((r) => r.task === task && r.arm === arm && r.trial === Number(trialNo))
  rec.scored = score ? { pass: score.pass, testsPassed: score.testsPassed, testsTotal: score.testsTotal, wallSeconds: score.wallSeconds, iterations: score.iterations, editRounds: score.editRounds } : null
  if (!score) rec.flags.push('not scored yet')

  const tfile = path.join(transcriptsDir, `agent-${agentId}.jsonl`)
  if (!fs.existsSync(tfile)) {
    rec.flags.push('transcript missing')
    records.push(rec)
    continue
  }
  const parsed = parseTranscriptFile(tfile)
  const reportIds = matchReport(parsed.finalReport, arm)
  const tl = buildTimeline(parsed, { arm, reportIds })

  // a. tokens
  rec.tokens = parsed.usage
  // b. tool calls by type
  const toolCalls = {}
  for (const c of parsed.calls) toolCalls[c.name] = (toolCalls[c.name] ?? 0) + 1
  rec.toolCalls = { total: parsed.calls.length, byTool: toolCalls }
  // c. phases
  rec.wallSeconds = tl.wallSeconds
  rec.phases = tl.phases
  rec.attributedShare = tl.attributedShare
  rec.iterations = tl.iterations
  rec.effectiveIterations = tl.effectiveIterations
  rec.edits = tl.edits
  rec.editRounds = tl.editRounds
  // d. failures
  rec.failures = tl.failures.map((f) => ({ ...f, t: Math.round((f.ts - parsed.firstTs) / 1000), ts: undefined }))
  rec.episodes = tl.episodes.map((e) => ({ ...e, t: Math.round((e.startTs - parsed.firstTs) / 1000), startTs: undefined, endTs: undefined }))
  rec.frictionSeconds = tl.friction
  rec.learnSeconds = tl.learn
  // e. catalog hits (results, report, workarounds in tool inputs)
  const resultHits = [...new Set(tl.failures.flatMap((f) => f.catalog ?? []))]
  const inputText = parsed.calls.filter((c) => EDIT_TOOLS.has(c.name) || c.name === 'Bash').map((c) => JSON.stringify(c.input)).join('\n')
  const workaroundHits = matchWorkaround(inputText.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'"), arm)
  rec.catalog = { result: resultHits, report: reportIds, workaround: workaroundHits }
  // f. skill/docs usage
  rec.skill = skillUsage(parsed, skill)
  // h. self-reported issues
  rec.selfReported = selfReportedIssues(parsed.finalReport)
  // test authoring from the transcript
  const testWrites = parsed.calls.filter((c) => (EDIT_TOOLS.has(c.name) && isTestPath(c.input.file_path)) || (c.name === 'Bash' && c.base === 'test-authoring'))
  rec.wroteTest = testWrites.length > 0

  // g. final code
  const dir = findTrialDir(trial)
  if (!dir) rec.flags.push('final code missing')
  else {
    rec.trialDir = dir
    const starter = path.join(armPaths(arm).tasks, task, 'starter')
    rec.diff = diffAgainstStarter(dir, starter)
    const srcDir = path.join(dir, 'src')
    const src = sourceText(srcDir)
    rec.keptTests = keptTests(dir)
    rec.testApproach = testApproach(dir)
    if (arm === 'sygnal') {
      rec.canonical = canonicalForms(src)
      if (doCheck) rec.sygnalCheck = runSygnalCheck(checkBin, srcDir)
      if (driverCatchWorkaround(src) && !rec.catalog.workaround.includes('B-005')) rec.catalog.workaround.push('B-005')
      // Workarounds that survive in kept tests
      const testsText = rec.keptTests.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
      for (const id of matchWorkaround(testsText, arm)) if (!rec.catalog.workaround.includes(id)) rec.catalog.workaround.push(id)
    }
  }
  rec.finalReportChars = parsed.finalReport.length
  if (rec.attributedShare < 0.9) rec.flags.push(`attributed share ${rec.attributedShare}`)
  records.push(rec)
}

records.sort((a, b) => a.task.localeCompare(b.task) || a.arm.localeCompare(b.arm) || a.trialNo - b.trialNo)
const agg = aggregate(records, { tracker })
const outDir = path.join(EVAL_ROOT, 'results', 'analysis')
fs.mkdirSync(outDir, { recursive: true })
const meta = {
  run,
  generatedAt: new Date().toISOString(),
  trialsInMap: mapRows.length,
  trialsAnalyzed: records.filter((r) => r.phases).length,
  trialsScored: records.filter((r) => r.scored).length,
  skillDir,
  sygnalCheck: doCheck,
}
fs.writeFileSync(path.join(outDir, `${run}.json`), JSON.stringify({ meta, aggregates: agg, trials: records }, null, 2) + '\n')
fs.writeFileSync(path.join(outDir, `${run}.md`), renderMarkdown({ meta, agg, records, tracker, skill }))
console.log(`analyzed ${meta.trialsAnalyzed}/${meta.trialsInMap} trials of ${run} -> ${path.relative(process.cwd(), path.join(outDir, run))}.{json,md}`)
const low = records.filter((r) => r.attributedShare != null && r.attributedShare < 0.9)
if (low.length) console.log(`warning: ${low.length} trial(s) below 90% attributed: ${low.map((r) => r.trial).join(', ')}`)
