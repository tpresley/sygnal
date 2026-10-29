// Parse-only throughput: @babel/parser (as sygnal-check calls it) vs oxc-parser (napi; eager JS
// objects, raw transfer, lazy) vs @swc/core (napi, JSON) vs meriyah/acorn (pure JS, JSX).
//   NODE_PATH-free: node parsers.mjs <npmDir with the parsers installed> <dir> [runs=5]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
const [npmDir, dir, runsArg = '5'] = process.argv.slice(2)
const req = createRequire(path.join(path.resolve(npmDir), 'x.js'))
const check = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../sygnal-check/src')
const { parseSource } = await import(pathToFileURL(path.join(check, 'ast.js')))
const { expandInputs } = await import(pathToFileURL(path.join(check, 'files.js')))
const oxc = req('oxc-parser'); const swc = req('@swc/core'); const meriyah = req('meriyah')
const files = expandInputs([path.resolve(dir)], { cwd: path.resolve(dir) }).files.map(f => [f, fs.readFileSync(f, 'utf8')])
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1]
const isTs = f => /\.(c|m)?tsx?$/.test(f)
const P = {
  babel: (f, t) => parseSource(t, f),
  'oxc eager': (f, t) => oxc.parseSync(f, t).program,
  'oxc raw': (f, t) => oxc.parseSync(f, t, { experimentalRawTransfer: true }).program,
  'oxc lazy': (f, t) => { const r = oxc.parseSync(f, t, { experimentalLazy: true }); const p = r.program; r.dispose?.(); return p },
  'swc json': (f, t) => swc.parseSync(t, { syntax: isTs(f) ? 'typescript' : 'ecmascript', jsx: !isTs(f) || /x$/.test(f), tsx: /\.tsx$/.test(f) }),
  meriyah: (f, t) => isTs(f) ? null : meriyah.parse(t, { module: true, jsx: true, next: true, loc: true, ranges: true }),
}
const res = {}
for (const [name, fn] of Object.entries(P)) {
  let fail = 0
  for (const [f, t] of files) { try { fn(f, t) } catch { fail++ } } // warm-up
  const ms = []
  for (let r = 0; r < +runsArg; r++) { const t0 = performance.now(); for (const [f, t] of files) { try { fn(f, t) } catch {} } ms.push(performance.now() - t0) }
  res[name] = `${median(ms).toFixed(1)} ms${fail ? ` (${fail} failed)` : ''}`
}
console.log(JSON.stringify({ dir: path.basename(dir), files: files.length, ...res }))
