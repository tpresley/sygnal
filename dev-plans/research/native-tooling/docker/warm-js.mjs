// The JS lite rules on oxc-parser in one process, warm: the median of N whole-project runs (the Go
// and Rust binaries' -repeat equivalent). node warm-js.mjs <npmDir> <dir> [runs]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileFacts, rules } from '../lite/facts-estree.mjs'
import { listSources } from '../lite/common.mjs'
const [npmDir, dir, runs = '9'] = process.argv.slice(2)
const oxc = createRequire(path.join(path.resolve(npmDir), 'x.js'))('oxc-parser')
const files = listSources(path.resolve(dir))
const once = () => { const m = new Map(); for (const f of files) { const r = oxc.parseSync(f, fs.readFileSync(f, 'utf8'), { experimentalRawTransfer: true }); if (!r.errors.length) m.set(f, fileFacts(r.program)) } return rules(m) }
once(); once()
const ms = []
for (let i = 0; i < +runs; i++) { const t = performance.now(); once(); ms.push(performance.now() - t) }
ms.sort((a, b) => a - b)
console.log(`${path.basename(dir)} (${files.length} files)\n  js   -j 1: {"checkMs":${ms[ms.length >> 1].toFixed(1)}}`)
