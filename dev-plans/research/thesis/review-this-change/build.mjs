// Regenerates data.json: for each change and each app, the real git diff, the real checker
// output and which behaviour checks fail. Run from the repo root, after `npm run build`:
//   node dev-plans/research/thesis/review-this-change/build.mjs
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const here = import.meta.dirname
const repo = resolve(here, '../../../..')
const changes = JSON.parse(readFileSync(join(here, 'changes/changes.json'), 'utf8'))
const adversarial = JSON.parse(readFileSync(join(here, 'changes/adversarial/adversarial.json'), 'utf8'))
const REPORT_COMMIT = 'caabfc3e' // claude/modest-almeida-601fe1: the --report prototype, not merged
const ARMS = ['react', 'sygnal']

const work = mkdtempSync(join(tmpdir(), 'sygnal-thesis-'))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 })

// the report prototype lives on another branch: unpack it next to the work, sharing node_modules
function reportTool() {
  const dir = join(work, 'report-tool')
  mkdirSync(dir)
  const tar = execFileSync('git', ['archive', REPORT_COMMIT, 'sygnal-check'], { cwd: repo, maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', dir], { input: tar })
  symlinkSync(join(repo, 'sygnal-check/node_modules'), join(dir, 'sygnal-check/node_modules'))
  return join(dir, 'sygnal-check/bin/sygnal-check.js')
}
const report = reportTool()
const checker = join(repo, 'sygnal-check/bin/sygnal-check.js')

function timed(cmd, args, cwd) {
  const start = performance.now()
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 })
  return { out: (r.stdout ?? '').trimEnd(), err: (r.stderr ?? '').trimEnd(), status: r.status, ms: Math.round(performance.now() - start) }
}

function initRepo(arm) {
  const dir = join(work, arm)
  cpSync(join(here, 'apps', arm), dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'demo@example.com')
  git(dir, 'config', 'user.name', 'demo')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'empty')
  git(dir, 'tag', 'empty')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'base')
  return dir
}

function behaviour(arm, dir, variant) {
  const out = join(work, `${arm}-${variant}.json`)
  const r = spawnSync('npx', ['vitest', 'run', '--config', join(here, 'checks/vitest.config.mjs'), '--reporter=json', `--outputFile=${out}`], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, ARM: arm, APP_DIR: dir, VARIANT: variant },
  })
  if (!existsSync(out)) throw new Error(`no results for ${arm}/${variant}: ${r.stderr}`)
  const tests = JSON.parse(readFileSync(out, 'utf8')).testResults.flatMap((f) => f.assertionResults).filter((t) => t.status !== 'skipped' && t.status !== 'pending')
  if (!tests.length) throw new Error(`no tests ran for ${arm}/${variant}: ${readFileSync(out, 'utf8').slice(0, 800)}`)
  return { total: tests.length, failed: tests.filter((t) => t.status === 'failed').map((t) => t.title) }
}

function reactSearch(dir) {
  const grep = (pattern) => {
    const r = spawnSync('grep', ['-rnE', pattern, 'src'], { cwd: dir, encoding: 'utf8' })
    return r.stdout.trimEnd().split('\n').filter(Boolean)
  }
  return { requests: grep('fetch\\(|request\\('), handlers: grep('on[A-Z][a-zA-Z]+=\\{'), state: grep('useState\\(|set[A-Z][a-zA-Z]+\\(') }
}

function toRow(component, a) {
  const sinks = a.sinks ?? []
  return {
    component,
    action: a.name,
    trigger: a.sources?.length ? a.sources.join(', ') : a.triggerKind,
    writes: sinks.flatMap((s) => s.writes?.head ?? []),
    requests: sinks.flatMap((s) => s.requests?.added ?? []),
    guards: sinks.flatMap((s) => s.guards?.added ?? []),
  }
}

const dirs = Object.fromEntries(ARMS.map((a) => [a, initRepo(a)]))
const graphOut = timed('node', [checker, '--graph', '--no-config', '.'], dirs.sygnal)
// the report against an empty commit lists everything as added: the app's whole inventory
const inventory = timed('node', [report, '--report', '--json', '--no-config', '--base', 'empty', '.'], dirs.sygnal)
const data = {
  generatedFrom: { reportPrototype: REPORT_COMMIT },
  base: Object.fromEntries(ARMS.map((a) => [a, behaviour(a, dirs[a], 'base')])),
  inventory: {
    graph: graphOut,
    ms: inventory.ms,
    actions: JSON.parse(inventory.out).components.flatMap((c) => c.actions.map((a) => toRow(c.name, a))),
    react: reactSearch(dirs.react),
  },
  adversarial: [],
  changes: [],
}

for (const change of changes) {
  const entry = { ...change, arms: {} }
  for (const arm of ARMS) {
    const dir = dirs[arm]
    git(dir, 'checkout', '-q', '-b', change.id, 'main')
    cpSync(join(here, 'changes', change.id, arm), dir, { recursive: true })
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', change.title)
    const diff = git(dir, 'diff', '--no-color', '-M', 'main', change.id)
    const stat = git(dir, 'diff', '--shortstat', '-M', 'main', change.id).trim()
    const result = { diff, stat, checks: behaviour(arm, dir, change.id) }
    if (arm === 'sygnal') {
      result.graph = timed('node', [checker, '--graph', '--no-config', '--base', 'main', '.'], dir)
      result.report = timed('node', [report, '--report', '--no-config', '--base', 'main', '.'], dir)
    }
    entry.arms[arm] = result
    git(dir, 'checkout', '-q', 'main')
  }
  data.changes.push(entry)
}

for (const item of adversarial) {
  const dir = dirs.sygnal
  git(dir, 'checkout', '-q', '-b', item.id, 'main')
  cpSync(join(here, 'changes/adversarial', item.id, 'sygnal'), dir, { recursive: true })
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', item.id)
  data.adversarial.push({
    ...item,
    graph: timed('node', [checker, '--graph', '--no-config', '--base', 'main', '.'], dir).out,
    report: timed('node', [report, '--report', '--no-config', '--base', 'main', '.'], dir).out,
    check: timed('node', [checker, '--strict', '--no-config', '.'], dir).out,
  })
  git(dir, 'checkout', '-q', 'main')
}

rmSync(work, { recursive: true, force: true })
writeFileSync(join(here, 'data.json'), JSON.stringify(data, null, 1) + '\n')
const template = readFileSync(join(here, 'template.html'), 'utf8')
writeFileSync(join(here, 'index.html'), template.replace('/*DATA*/null', JSON.stringify(data).replace(/</g, '\\u003c')))
for (const c of data.changes) {
  console.log(`\n=== ${c.id}`)
  for (const arm of ARMS) console.log(`${arm}: ${c.arms[arm].stat}; fails ${JSON.stringify(c.arms[arm].checks.failed)} of ${c.arms[arm].checks.total}`)
}
