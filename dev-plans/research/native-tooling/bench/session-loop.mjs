// session-edit.mjs's incremental loop alone, for --cpu-prof, with per-rule medians (TOP=n).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const check = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../sygnal-check/src')
const { checkFiles, createParseCache, createCheckSession } = await import(pathToFileURL(path.join(check, 'index.js')))
const { selectRules } = await import(pathToFileURL(path.join(check, 'rules/index.js')))
const { expandInputs } = await import(pathToFileURL(path.join(check, 'files.js')))
const dir = path.resolve(process.argv[2]); const n = +(process.argv[3] || 30)
const files = expandInputs([dir], { cwd: dir }).files
const pick = files[files.length >> 1]; const text = fs.readFileSync(pick, 'utf8')
const per = new Map()
const rules = selectRules({ strict: true }).map(r => ({ ...r, run(p, rep) { const t = performance.now(); r.run(p, rep); per.set(r.id, [...(per.get(r.id) || []), performance.now() - t]) } }))
const session = createCheckSession(), cache = createParseCache()
const t0 = performance.now()
for (let i = 0; i < n; i++) checkFiles(files, { cwd: dir, rules, cache, session, sources: new Map([[pick, text + `\n// ${i}\n`]]) })
console.log(`${n} edits: ${((performance.now() - t0) / n).toFixed(1)} ms each`)
const med = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const top = [...per].map(([id, a]) => [id, med(a.slice(2))]).sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP || 15))
for (const [id, ms] of top) console.log(ms.toFixed(2).padStart(7), id)
