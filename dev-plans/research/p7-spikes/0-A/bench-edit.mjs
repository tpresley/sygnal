// PLAN-7 C-3: whole-project check latency after a one-file edit, with and without the parse cache.
//   node bench-edit.mjs <dir> [runs=9] [--strict]
// cold:      the first check in this process (no cache)
// warm:      median of re-checks without a cache (every file parsed again)
// warmEdit:  median of re-checks with a warm ParseCache after changing one file's text through
//            `sources` (the editor case); parsesPerEdit should be 1
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
const SC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../sygnal-check/src')
const { checkFiles, createParseCache } = await import(SC + '/index.js')
const { expandInputs } = await import(SC + '/files.js')

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const [dirArg, runsArg = '9'] = args.filter(a => !a.startsWith('--'))
const dir = path.resolve(dirArg)
const { files } = expandInputs([dir], { cwd: dir })
const runs = +runsArg
const med = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t }
const lines = files.reduce((n, f) => n + fs.readFileSync(f, 'utf8').split('\n').length, 0)

const cold = time(() => checkFiles(files, { cwd: dir, strict }))
const warm = []
for (let i = 0; i < runs; i++) warm.push(time(() => checkFiles(files, { cwd: dir, strict })))

const cache = createParseCache()
const edited = files[files.length >> 1]
const original = fs.readFileSync(edited, 'utf8')
checkFiles(files, { cwd: dir, strict, cache }) // prime
const edit = []
const before = cache.stats.parses
for (let i = 0; i < runs; i++) {
  const sources = new Map([[edited, original + `\n// edit ${i}\n`]])
  edit.push(time(() => checkFiles(files, { cwd: dir, strict, cache, sources })))
}
console.log(JSON.stringify({
  dir: path.basename(dir), files: files.length, lines, strict,
  coldMs: Math.round(cold), warmMs: Math.round(med(warm)), warmEditMs: Math.round(med(edit)),
  parsesPerEdit: (cache.stats.parses - before) / runs,
}))
