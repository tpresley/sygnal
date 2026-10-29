// Where does sygnal-check's time go? Phases on one input set, in one process:
//   node profile.mjs <dir> [--runs=7] [--json]
// read:   readFileSync of every source file
// parse:  @babel/parser (parseSource) of every file
// index:  the parent WeakMap + suppressions (the rest of Project._parse)
// model:  buildProject() with a warm ParseCache (every file a hit: components, intent/model/view
//         analysis, imports, events, injected JSX)
// rules:  runRules() over that project (--strict rule set), with the slowest rules listed
// cold:   the first checkFiles() in the process (JIT cold, no cache); warm: checkFiles() without a
//         cache once warm (what the CLI does per file set, minus startup); edit: a one-file edit
//         with the warm cache (what the language server does per keystroke)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const check = process.env.SYGNAL_CHECK_SRC ? path.resolve(process.env.SYGNAL_CHECK_SRC) : path.resolve(here, '../../../../sygnal-check/src')
const t0 = performance.now()
const { checkFiles, createParseCache, runRules } = await import(pathToFileURL(path.join(check, 'index.js')))
const { expandInputs } = await import(pathToFileURL(path.join(check, 'files.js')))
const { buildProject } = await import(pathToFileURL(path.join(check, 'model/project.js')))
const { parseSource, indexParents } = await import(pathToFileURL(path.join(check, 'ast.js')))
const { selectRules } = await import(pathToFileURL(path.join(check, 'rules/index.js')))
const importMs = performance.now() - t0

const args = process.argv.slice(2)
const dir = path.resolve(args.find(a => !a.startsWith('--')))
const runs = +(args.find(a => a.startsWith('--runs='))?.slice(7) || 7)
const asJson = args.includes('--json')
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const time = fn => { const t = performance.now(); const r = fn(); return [performance.now() - t, r] }

const files = expandInputs([dir], { cwd: dir }).files
const opts = { cwd: dir, strict: true }

const [cold] = time(() => checkFiles(files, opts))

const texts = new Map()
const read = [], parse = [], index = [], model = [], rules = [], warm = [], edit = []
for (let r = 0; r < runs; r++) read.push(time(() => { for (const f of files) texts.set(f, fs.readFileSync(f, 'utf8')) })[0])
let lines = 0, bytes = 0
for (const t of texts.values()) { lines += t.split('\n').length; bytes += Buffer.byteLength(t) }
for (let r = 0; r < runs; r++) {
  const asts = []
  parse.push(time(() => { for (const [f, t] of texts) { try { asts.push(parseSource(t, f)) } catch {} } })[0])
  index.push(time(() => { for (const a of asts) { const m = new WeakMap(); indexParents(a.program, m) } })[0])
}
const cache = createParseCache()
buildProject(files, { cwd: dir, cache })
const ruleList = selectRules({ strict: true })
const perRule = new Map()
for (let r = 0; r < runs; r++) {
  const [m, project] = time(() => buildProject(files, { cwd: dir, cache }))
  model.push(m)
  const timed = ruleList.map(rule => ({ ...rule, run(p, report) { const t = performance.now(); rule.run(p, report); const ms = performance.now() - t; perRule.set(rule.id, [...(perRule.get(rule.id) || []), ms]) } }))
  rules.push(time(() => runRules(project, timed))[0])
  warm.push(time(() => checkFiles(files, opts))[0])
}
const edited = files[files.length >> 1]
const original = texts.get(edited)
for (let r = 0; r < runs + 3; r++) {
  const ms = time(() => checkFiles(files, { ...opts, cache, sources: new Map([[edited, original + `\n// edit ${r}\n`]]) }))[0]
  if (r >= 3) edit.push(ms)
}
const top = [...perRule].map(([id, a]) => [id, median(a)]).sort((a, b) => b[1] - a[1])
const out = {
  dir: path.basename(dir), files: files.length, lines, kb: Math.round(bytes / 1024), importMs: +importMs.toFixed(1),
  cold: +cold.toFixed(1),
  read: +median(read).toFixed(1), parse: +median(parse).toFixed(1), index: +median(index).toFixed(1),
  model: +median(model).toFixed(1), rules: +median(rules).toFixed(1),
  warm: +median(warm).toFixed(1), edit: +median(edit).toFixed(1),
  topRules: top.slice(0, 6).map(([id, ms]) => `${id} ${ms.toFixed(1)}`),
}
if (asJson) console.log(JSON.stringify(out))
else console.log(out)
