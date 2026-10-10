#!/usr/bin/env node
// The operability check (PLAN-6 4-E; tasks 45 and 47): a local model operates the app through the
// tools it built, on a few fixed tasks, and success is judged on the final state the user sees.
// Opt-in, free (Ollama on this machine), and never part of scoring.
//
//   node evals/agent-ergonomics/analysis/operability.mjs --task 47 --arm sygnal --reference
//   node evals/agent-ergonomics/analysis/operability.mjs --task 45 --dir /tmp/sygnal-evals/trials/<run>/react-45-t1
//   node evals/agent-ergonomics/analysis/operability.mjs --run <run> [--trials-root <dir>] [--tasks 45,47]
//
// --task 45|47       which check (45: the in-app assistant, through a stand-in /api/chat that asks the
//                    model with the route's tool definitions; 47: the WebMCP tools, called directly)
// --arm sygnal|react the arm (for --reference; read from the dir name for --dir / --run)
// --reference        check the task's reference solution: its starter + solution overlay, copied under
//                    <work>/<arm>/ (the dependencies of a verify.mjs run there: run verify.mjs with the
//                    same --work first)
// --dir <trial>      check a finished trial dir (its own node_modules)
// --run <run>        every 45/47 trial of a run under --trials-root (default /tmp/sygnal-evals/trials)
// --work <dir>       verify.mjs's work dir (default $TMPDIR/sygnal-evals-verify)
// --runs <n>         runs per fixed task (default 3)
// --model qwen3:8b   the Ollama model; --ollama http://localhost:11434
// --json <file>      write every result as JSON
//
// How: the arm's hidden-test harness (dom.js, queries.js, aiserver.js) and analysis/operability/
// (<task>.op.jsx, ollama.js) are copied into <dir>/__operability__/, and vitest runs them there with
// the arm's acceptance config (jsdom), so the app is mounted exactly as the hidden tests mount it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { armPaths, resolveTask, parseArgs, copyDir, applySolution } from '../lib/common.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OP_DIR = path.join(HERE, 'operability')
const OP = '__operability__'
const CHECKS = ['45', '47']

const args = parseArgs(process.argv.slice(2))
const runs = Math.max(1, Number(args.runs) || 3)
const model = typeof args.model === 'string' ? args.model : 'qwen3:8b'
const ollama = typeof args.ollama === 'string' ? args.ollama : 'http://localhost:11434'
const work = path.resolve(typeof args.work === 'string' ? args.work : path.join(os.tmpdir(), 'sygnal-evals-verify'))

function usage(msg) {
  if (msg) console.error(msg)
  console.error('usage: operability.mjs --task 45|47 (--arm sygnal|react --reference | --dir <trial>) | --run <run> [--runs 3] [--model qwen3:8b] [--json out.json]')
  process.exit(2)
}

/** the targets: [{ task, arm, dir, label }] */
function targets() {
  if (args.run) {
    const root = path.resolve(typeof args['trials-root'] === 'string' ? args['trials-root'] : '/tmp/sygnal-evals/trials', String(args.run))
    const want = String(args.tasks || CHECKS.join(',')).split(',').map((t) => t.trim())
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name.match(/^(sygnal|react)-(\d\d)-t(\d+)$/))
      .filter((m) => m && want.includes(m[2]))
      .map((m) => ({ task: m[2], arm: m[1], dir: path.join(root, m[0]), label: m[0] }))
  }
  const task = String(args.task || '')
  if (!CHECKS.includes(task)) usage(`--task must be one of ${CHECKS.join(', ')}`)
  if (args.dir) {
    const dir = path.resolve(String(args.dir))
    const arm = args.arm || (path.basename(dir).match(/^(sygnal|react)-/) || [])[1]
    if (!arm) usage('--arm sygnal|react (it is not in the dir name)')
    return [{ task, arm, dir, label: path.basename(dir) }]
  }
  if (!args.reference) usage('one of --reference, --dir or --run')
  const arms = !args.arm || args.arm === 'both' ? ['sygnal', 'react'] : [String(args.arm)]
  return arms.map((arm) => {
    const name = resolveTask(arm, task)
    const armDir = path.join(work, arm)
    if (!fs.existsSync(path.join(armDir, 'node_modules'))) usage(`${armDir}/node_modules is missing: run verify.mjs --arm ${arm} --task ${task} --work ${work} first`)
    const dir = path.join(armDir, `${name}--operability`)
    fs.rmSync(dir, { recursive: true, force: true })
    copyDir(path.join(armPaths(arm).tasks, name, 'starter'), dir)
    applySolution(dir, arm, name)
    return { task, arm, dir, label: `${arm} reference` }
  })
}

/** copy the harness and the check into <dir>/__operability__ and run it; returns the parsed result */
function check({ task, arm, dir }) {
  const target = path.join(dir, OP)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  const support = armPaths(arm).support
  for (const f of ['dom.js', 'queries.js', 'aiserver.js']) fs.copyFileSync(path.join(support, f), path.join(target, f))
  fs.copyFileSync(path.join(OP_DIR, 'ollama.js'), path.join(target, 'ollama.js'))
  fs.copyFileSync(path.join(OP_DIR, `${task}.op.jsx`), path.join(target, `${task}.op.jsx`))
  const config = fs.readFileSync(path.join(support, 'vitest.config.mjs'), 'utf8')
    .replace(/include: \[[^\]]*\]/, `include: ['${OP}/**/*.op.{js,jsx}']`)
    .replace(/testTimeout: \d+/, 'testTimeout: 3600000')
  fs.writeFileSync(path.join(target, 'vitest.config.mjs'), config)
  const out = path.join(target, 'result.json')
  const require = createRequire(path.join(dir, 'package.json'))
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
  // vitest's output goes straight to the terminal: the [operability] lines show progress (a run takes minutes)
  const res = spawnSync(process.execPath, [vitest, 'run', '--config', `${OP}/vitest.config.mjs`], {
    cwd: dir, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', OP_RUNS: String(runs), OP_MODEL: model, OP_OLLAMA: ollama, OP_OUT: out },
  })
  if (!fs.existsSync(out)) return { error: `the check did not finish (exit ${res.status}; vitest's output is above)`, output: '' }
  return JSON.parse(fs.readFileSync(out, 'utf8'))
}

async function main() {
  try {
    const r = await fetch(`${ollama.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) })
    const tags = await r.json()
    if (!tags.models?.some((m) => m.name === model || m.name === `${model}:latest`)) usage(`Ollama at ${ollama} has no ${model} (ollama pull ${model})`)
  } catch {
    usage(`no Ollama at ${ollama} (start it, or pass --ollama)`)
  }
  const all = []
  for (const t of targets()) {
    console.log(`\n== ${t.task} ${t.label} (${model}, ${runs} runs per task)`)
    const r = check(t)
    all.push({ ...t, ...r })
    if (r.error) {
      console.log(`   ERROR ${r.error}\n${r.output}`)
      continue
    }
    let ok = 0
    let n = 0
    for (const x of r.results) {
      ok += x.success
      n += x.runs
      console.log(`   ${x.task.padEnd(9)} ${x.success}/${x.runs}   tool calls ${x.toolCalls}, ${x.seconds} s`)
      for (const e of x.episodes.filter((e) => !e.ok).slice(0, 2)) console.log(`      fail: ${e.error ? e.error + '; ' : ''}${e.trace.join(' | ').slice(0, 400)} -> ${e.end.join('; ')}`)
    }
    console.log(`   total     ${ok}/${n}`)
  }
  if (typeof args.json === 'string') fs.writeFileSync(path.resolve(args.json), JSON.stringify(all, null, 2))
}

main()
