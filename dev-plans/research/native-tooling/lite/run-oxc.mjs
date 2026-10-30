// The lite rules over oxc-parser (napi, raw transfer) in one process: the "native parse, JS rules"
// hybrid. node run-oxc.mjs <npmDir with oxc-parser> <dir> [--json] [--time]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileFacts, rules } from './facts-estree.mjs'
import { listSources, lineCol, compact } from './common.mjs'
const [npmDir, dirArg, ...flags] = process.argv.slice(2)
const oxc = createRequire(path.join(path.resolve(npmDir), 'x.js'))('oxc-parser')
const dir = path.resolve(dirArg)
const t0 = performance.now()
const files = listSources(dir)
const facts = new Map(), texts = new Map()
let parseMs = 0, factsMs = 0
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  texts.set(f, text)
  let t = performance.now()
  const r = oxc.parseSync(f, text, { experimentalRawTransfer: true })
  parseMs += performance.now() - t
  if (r.errors.some(e => e.severity === 'Error')) continue
  t = performance.now()
  facts.set(f, fileFacts(r.program))
  factsMs += performance.now() - t
}
const t1 = performance.now()
const found = rules(facts)
const rulesMs = performance.now() - t1
const out = compact(found.map(d => ({ code: d.code, file: path.relative(dir, d.file), ...lineCol(texts.get(d.file), d.node.start) })))
if (flags.includes('--time')) console.error(JSON.stringify({ files: files.length, totalMs: +(performance.now() - t0).toFixed(1), parseMs: +parseMs.toFixed(1), factsMs: +factsMs.toFixed(1), rulesMs: +rulesMs.toFixed(1) }))
console.log(flags.includes('--json') ? JSON.stringify(out) : out.join('\n'))
