// One-file edits re-checked with a check session (incremental: model reuse + per-file rule memo)
// vs with only the parse cache; asserts the findings are identical.
//   node session-edit.mjs <dir> [edits=15] [--leaf|--root|--mid]   which file is edited
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const check = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../sygnal-check/src')
const { checkFiles, createParseCache, createCheckSession } = await import(pathToFileURL(path.join(check, 'index.js')))
const { expandInputs } = await import(pathToFileURL(path.join(check, 'files.js')))
const args = process.argv.slice(2)
const dir = path.resolve(args[0]); const n = +(args[1] && !args[1].startsWith('--') ? args[1] : 15)
const files = expandInputs([dir], { cwd: dir }).files
const pick = args.includes('--root') ? files.find(f => /C0\.jsx$|RootComponent|App\.jsx$/.test(f)) || files[0] : args.includes('--leaf') ? files[files.length - 1] : files[files.length >> 1]
const text = fs.readFileSync(pick, 'utf8')
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const run = (opts) => { const out = []; let last; for (let i = 0; i < n + 3; i++) { const t = performance.now(); last = checkFiles(files, { cwd: dir, strict: true, ...opts, sources: new Map([[pick, text + `\n// ${i % 2 ? 'x' : 'y'}\nconst __e${i} = ${i}\n`]]) }); if (i >= 3) out.push(performance.now() - t) } return [median(out), last] }
const [plain, a] = run({ cache: createParseCache() })
const session = createCheckSession()
const [incr, b] = run({ cache: createParseCache(), session })
const same = JSON.stringify(a) === JSON.stringify(b)
console.log(JSON.stringify({ dir: path.basename(dir), edited: path.relative(dir, pick), rebuilt: session.previous.rebuilt?.size, files: files.length, cacheOnlyMs: +plain.toFixed(1), sessionMs: +incr.toFixed(1), identical: same }))
if (!same) process.exitCode = 1
