// Shared plumbing for prepare.mjs, score.mjs and verify.mjs.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const EVAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The Sygnal checkout whose build is under test. Defaults to the repo that
// contains this harness; override to measure a different checkout.
export const REPO_ROOT = process.env.SYGNAL_EVAL_REPO_ROOT
  ? path.resolve(process.env.SYGNAL_EVAL_REPO_ROOT)
  : path.resolve(EVAL_ROOT, '..', '..')

export const ARMS = ['sygnal', 'react']
export const FAILURE_CATEGORIES = ['wiring', 'isolation', 'reducer-shape', 'stream-operator', 'other', 'none']
export const HIDDEN_DIR_NAME = '__hidden__'

export function armPaths(arm) {
  if (arm === 'sygnal') {
    return {
      tasks: path.join(EVAL_ROOT, 'tasks'),
      hidden: path.join(EVAL_ROOT, 'hidden'),
      support: path.join(EVAL_ROOT, 'hidden', '_support'),
    }
  }
  if (arm === 'react') {
    return {
      tasks: path.join(EVAL_ROOT, 'react', 'tasks'),
      hidden: path.join(EVAL_ROOT, 'react', 'hidden'),
      support: path.join(EVAL_ROOT, 'react', 'hidden', '_support'),
    }
  }
  throw new Error(`Unknown arm "${arm}" (expected one of ${ARMS.join(', ')})`)
}

/**
 * Extra devDependencies of the TypeScript task starters (tasks 18-21, tier `ts`), on top of
 * the arm's JS dependency set. A starter with a tsconfig.json is a TypeScript starter;
 * verify.mjs checks its package.json against the JS set plus these.
 */
export const TS_EXTRA_DEV_DEPENDENCIES = {
  sygnal: { typescript: '^5.9.3' },
  react: { '@types/react': '^18.3.31', '@types/react-dom': '^18.3.7', typescript: '^5.9.3' },
}

/**
 * Extra dependencies of single task starters, on top of the arm's dependency set (PLAN-3 5-6;
 * PLAN-5 4-E for 30-34): the React arm's library for the task, as a real project would already
 * have it installed, and a library both arms use (zod, Chart.js).
 * verify.mjs checks each starter's package.json against the set plus its task's extras, and
 * installs the union in its shared node_modules.
 */
export const TASK_EXTRA_DEPENDENCIES = {
  // PLAN-5 4-E (p5 tier): libraries both arms would have (zod for 30's schema, Chart.js for 32).
  sygnal: {
    '30-checkout-form': { zod: '^4.6.5' },
    '32-sales-chart': { 'chart.js': '^4.5.1' },
  },
  react: {
    '24-list-detail-cache': { '@tanstack/react-query': '^5.104.1' },
    '25-router-spa': { 'react-router': '^7.18.4' },
    '30-checkout-form': { '@hookform/resolvers': '^5.9.1', 'react-hook-form': '^7.89.0', zod: '^4.6.5' },
    '31-command-menu': { cmdk: '^1.1.1' },
    '32-sales-chart': { 'chart.js': '^4.5.1' },
    '33-virtual-list': { '@tanstack/react-virtual': '^3.14.13' },
    '34-sortable-playlist': { '@dnd-kit/core': '^6.3.1', '@dnd-kit/sortable': '^10.0.0', '@dnd-kit/utilities': '^3.2.2' },
  },
}

export function isTsStarter(starterDir) {
  return fs.existsSync(path.join(starterDir, 'tsconfig.json'))
}

export function listTasks(arm) {
  const { tasks } = armPaths(arm)
  return fs
    .readdirSync(tasks, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
    .map((d) => d.name)
    .sort()
}

/** Accepts "01", "1", or the full "01-clear-completed" and returns the task dir name. */
export function resolveTask(arm, id) {
  const all = listTasks(arm)
  if (all.includes(id)) return id
  const n = String(id).padStart(2, '0')
  const hit = all.find((t) => t.startsWith(n + '-'))
  if (!hit) throw new Error(`No ${arm} task matching "${id}". Available: ${all.join(', ')}`)
  return hit
}

export function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=')
      if (inline !== undefined) args[k] = inline
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[k] = argv[++i]
      else args[k] = true
    } else args._.push(a)
  }
  return args
}

const SKIP = new Set(['node_modules', 'dist', HIDDEN_DIR_NAME, '.vite'])

/** Recursive copy that skips build output, installed deps and hidden tests. */
export function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (p) => !SKIP.has(path.basename(p)),
  })
}

export function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (opts.check !== false && res.status !== 0) {
    const out = `${res.stdout || ''}\n${res.stderr || ''}`.trim()
    throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(' ')}\n${out.slice(-4000)}`)
  }
  return res
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

export function npm(args, cwd, opts = {}) {
  return run(npmCmd, args, { cwd, ...opts })
}

/**
 * Build (if needed) and `npm pack` the Sygnal package from this repo.
 * Returns the absolute tarball path inside `outDir`.
 */
export function packSygnal(outDir, { build = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true })
  const distEntry = path.join(REPO_ROOT, 'dist', 'index.esm.js')
  if (build || !fs.existsSync(distEntry)) {
    console.error(`[evals] building sygnal in ${REPO_ROOT} ...`)
    npm(['run', 'build'], REPO_ROOT)
  }
  const res = npm(['pack', '--json', '--pack-destination', outDir], REPO_ROOT)
  const info = JSON.parse(res.stdout.slice(res.stdout.indexOf('[')))
  return path.join(outDir, info[0].filename)
}

/**
 * Copy a locally packed tarball into <dir>/vendor/ under a content-hashed name
 * and return the `file:` spec to depend on (G-179). `npm pack` always names the
 * tarball <name>-<version>.tgz, and npm does not re-extract a `file:` tarball
 * whose path is unchanged, so a reused install dir would keep a stale build.
 * A new content gets a new path, which npm reinstalls; the same content keeps
 * the same spec, so an unchanged reused dir stays a no-op install. Older
 * vendored copies of the same package are removed.
 */
export function vendorTarball(tarball, dir, name) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex').slice(0, 16)
  const base = name.replace(/[@/]/g, '_')
  const vendor = path.join(dir, 'vendor')
  fs.mkdirSync(vendor, { recursive: true })
  const file = `${base}-${hash}.tgz`
  for (const f of fs.readdirSync(vendor)) {
    if (f !== file && f.startsWith(`${base}-`) && /^[0-9a-f]{16}\.tgz$/.test(f.slice(base.length + 1))) fs.rmSync(path.join(vendor, f))
  }
  const dest = path.join(vendor, file)
  if (!fs.existsSync(dest)) fs.copyFileSync(tarball, dest)
  return `file:vendor/${file}`
}

/** Copy the arm's support files and the task's *.hidden.* tests into <dir>/__hidden__. */
export function installHidden(dir, arm, task) {
  const { hidden, support } = armPaths(arm)
  const target = path.join(dir, HIDDEN_DIR_NAME)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  for (const f of fs.readdirSync(support)) fs.copyFileSync(path.join(support, f), path.join(target, f))
  const taskHidden = path.join(hidden, task)
  const tests = fs.readdirSync(taskHidden).filter((f) => /\.hidden\.[jt]sx?$/.test(f))
  if (tests.length === 0) throw new Error(`No *.hidden.* tests in ${taskHidden}`)
  for (const f of tests) fs.copyFileSync(path.join(taskHidden, f), path.join(target, f))
  return target
}

/** Overlay a task's reference solution onto a starter copy. */
export function applySolution(dir, arm, task, name = 'solution') {
  const sol = path.join(armPaths(arm).hidden, task, name)
  if (!fs.existsSync(sol)) throw new Error(`No reference solution at ${sol}`)
  fs.cpSync(sol, dir, { recursive: true })
}

/**
 * Run the hidden suite in <dir>. Node resolution walks up from <dir>, so the
 * deps can live in <dir>/node_modules (a trial) or a parent (verify.mjs).
 */
export function runHidden(dir) {
  const require = createRequire(path.join(dir, 'package.json'))
  let vitestBin
  try {
    const pkgPath = require.resolve('vitest/package.json')
    vitestBin = path.join(path.dirname(pkgPath), 'vitest.mjs')
  } catch {
    throw new Error(`vitest is not installed for ${dir} (run npm install there first)`)
  }
  const outFile = path.join(dir, HIDDEN_DIR_NAME, 'result.json')
  fs.rmSync(outFile, { force: true })
  const started = Date.now()
  const res = run(
    process.execPath,
    [vitestBin, 'run', '--config', `${HIDDEN_DIR_NAME}/vitest.config.mjs`, '--reporter=json', `--outputFile=${outFile}`],
    { cwd: dir, check: false, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } }
  )
  const result = {
    exitCode: res.status,
    durationMs: Date.now() - started,
    testsPassed: 0,
    testsTotal: 0,
    failures: [],
    output: `${res.stdout || ''}\n${res.stderr || ''}`.trim(),
  }
  if (fs.existsSync(outFile)) {
    const json = JSON.parse(fs.readFileSync(outFile, 'utf8'))
    result.testsPassed = json.numPassedTests ?? 0
    result.testsTotal = json.numTotalTests ?? 0
    for (const file of json.testResults || []) {
      if (file.status === 'failed' && (!file.assertionResults || file.assertionResults.length === 0)) {
        result.failures.push({ test: path.basename(file.name), message: firstLine(file.message) })
      }
      for (const a of file.assertionResults || []) {
        if (a.status !== 'passed') {
          result.failures.push({ test: a.fullName || a.title, message: firstLine((a.failureMessages || []).join('\n')) })
        }
      }
    }
  }
  result.pass = result.exitCode === 0 && result.testsTotal > 0 && result.testsPassed === result.testsTotal
  return result
}

function firstLine(s) {
  return String(s || '').split('\n').find((l) => l.trim()) || ''
}

/**
 * Leak check: a prepared trial dir must not contain hidden tests or point back
 * into this repo (where hidden/ lives). Returns a list of problems.
 */
export function leakCheck(dir) {
  const problems = []
  const needles = [REPO_ROOT, 'agent-ergonomics', '.hidden.']
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'vendor') continue
      const p = path.join(d, e.name)
      if (e.name === HIDDEN_DIR_NAME) problems.push(`hidden test dir present: ${p}`)
      if (e.isSymbolicLink()) problems.push(`symlink (may point outside the trial): ${p}`)
      else if (e.isDirectory()) walk(p)
      else {
        if (/\.hidden\.[jt]sx?$/.test(e.name)) problems.push(`hidden test file present: ${p}`)
        const text = fs.readFileSync(p, 'utf8')
        for (const n of needles) if (text.includes(n)) problems.push(`${p} mentions "${n}"`)
      }
    }
  }
  walk(dir)
  const nm = path.join(dir, 'node_modules', 'sygnal')
  if (fs.existsSync(nm) && fs.lstatSync(nm).isSymbolicLink()) {
    problems.push(`node_modules/sygnal is a symlink to ${fs.realpathSync(nm)} (install from the tarball instead)`)
  }
  return problems
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
