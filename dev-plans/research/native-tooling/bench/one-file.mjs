// The incremental floor: checking only the edited file (its imports still load) vs the whole
// project, both with a warm parse cache. node one-file.mjs <dir>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const check = process.env.SYGNAL_CHECK_SRC ? path.resolve(process.env.SYGNAL_CHECK_SRC) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../sygnal-check/src')
const { checkFiles, createParseCache } = await import(pathToFileURL(path.join(check, 'index.js')))
const { expandInputs } = await import(pathToFileURL(path.join(check, 'files.js')))
const dir = path.resolve(process.argv[2])
const files = expandInputs([dir], { cwd: dir }).files
const edited = files[files.length >> 1]
const text = fs.readFileSync(edited, 'utf8')
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const run = (list) => { const cache = createParseCache(); checkFiles(list, { cwd: dir, strict: true, cache }); const ms = []; for (let i = 0; i < 12; i++) { const t = performance.now(); checkFiles(list, { cwd: dir, strict: true, cache, sources: new Map([[edited, text + `\n// ${i}\n`]]) }); if (i > 2) ms.push(performance.now() - t) } return median(ms).toFixed(1) }
console.log(JSON.stringify({ dir: path.basename(dir), files: files.length, wholeProjectEditMs: +run(files), editedFileOnlyMs: +run([edited]) }))
