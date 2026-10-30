// A language-server-shaped loop for --cpu-prof: N one-file edits re-checked with a warm cache.
//   node --cpu-prof --cpu-prof-dir=<dir> edit-loop.mjs <dir> [edits=40]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const check = process.env.SYGNAL_CHECK_SRC ? path.resolve(process.env.SYGNAL_CHECK_SRC) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../sygnal-check/src')
const { checkFiles, createParseCache } = await import(pathToFileURL(path.join(check, 'index.js')))
const { expandInputs } = await import(pathToFileURL(path.join(check, 'files.js')))
const [d, n = '40'] = process.argv.slice(2)
const dir = path.resolve(d)
const files = expandInputs([dir], { cwd: dir }).files
const cache = createParseCache()
const edited = files[files.length >> 1]
const original = fs.readFileSync(edited, 'utf8')
checkFiles(files, { cwd: dir, strict: true, cache })
const t = performance.now()
for (let i = 0; i < +n; i++) checkFiles(files, { cwd: dir, strict: true, cache, sources: new Map([[edited, original + `\n// ${i}\n`]]) })
console.log(`${n} edits: ${((performance.now() - t) / +n).toFixed(1)} ms each`)
