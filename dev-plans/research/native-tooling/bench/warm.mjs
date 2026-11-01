// In-process steady state (what an editor or the Vite plugin pays per check, no startup): the
// median of N whole-project checks after warm-up, per route.
//   node warm.mjs <npmDir with oxc-parser> <dir> [runs=7]
// 'sygnal-check 4 rules': checkFiles with only the prototype's 4 rules (the model is still built
// in full: buildProject doesn't know which rules will run); no parse cache (a CLI-like run).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fileFacts, rules } from '../lite/facts-estree.mjs'
import { listSources } from '../lite/common.mjs'
const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(here, '../../../../sygnal-check/src')
const { checkFiles, coreRules } = await import(pathToFileURL(path.join(src, 'index.js')))
const [npmDir, dirArg, runsArg = '7'] = process.argv.slice(2)
const oxc = createRequire(path.join(path.resolve(npmDir), 'x.js'))('oxc-parser')
const dir = path.resolve(dirArg)
const files = listSources(dir)
const four = coreRules.filter(r => ['intent-without-model', 'events-counterpart', 'selector-in-view', 'xstream-default-import'].includes(r.id))
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const bench = (fn) => { fn(); fn(); const ms = []; for (let i = 0; i < +runsArg; i++) { const t = performance.now(); fn(); ms.push(performance.now() - t) } return +median(ms).toFixed(1) }
const out = { dir: path.basename(dir), files: files.length }
out['sygnal-check all (strict)'] = bench(() => checkFiles(files, { cwd: dir, strict: true }))
out['sygnal-check 4 rules'] = bench(() => checkFiles(files, { cwd: dir, rules: four }))
out['lite JS on oxc-parser'] = bench(() => { const m = new Map(); for (const f of files) { const r = oxc.parseSync(f, fs.readFileSync(f, 'utf8'), { experimentalRawTransfer: true }); if (!r.errors.length) m.set(f, fileFacts(r.program)) } rules(m) })
console.log(JSON.stringify(out))
