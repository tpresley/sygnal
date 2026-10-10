// PLAN-7 0-A: whole-project check latency (the latency gate's baseline).
//   node bench-latency.mjs <dir> [runs=7] [--strict]
// Prints cold (first check in this process), then warm medians for build (parse+model) and rules.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const SC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../sygnal-check/src')
const { buildProject, runRules } = await import(SC + '/index.js')
const { expandInputs } = await import(SC + '/files.js')
const { selectRules } = await import(SC + '/rules/index.js')

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const [dirArg, runsArg = '7'] = args.filter(a => !a.startsWith('--'))
const dir = path.resolve(dirArg)
const { files } = expandInputs([dir], { cwd: dir })
const rules = selectRules({ strict })
const med = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const b = [], r = []
let diags = 0
for (let i = 0; i < +runsArg; i++) {
  let t = performance.now(); const p = buildProject(files, { cwd: dir }); b.push(performance.now() - t)
  t = performance.now(); diags = runRules(p, rules).length; r.push(performance.now() - t)
}
const tot = b.map((x, i) => x + r[i])
console.log(JSON.stringify({ dir: path.basename(dir), files: files.length, strict, diags,
  coldMs: Math.round(tot[0]), warmMs: Math.round(med(tot.slice(1))), warmBuildMs: Math.round(med(b.slice(1))), warmRulesMs: Math.round(med(r.slice(1))) }))
