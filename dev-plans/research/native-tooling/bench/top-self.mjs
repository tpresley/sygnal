// Self time by function (and by sygnal-check file) from a .cpuprofile: node top-self.mjs <file> [n=25]
import fs from 'node:fs'
const [f, n = '25'] = process.argv.slice(2)
const p = JSON.parse(fs.readFileSync(f, 'utf8'))
const byId = new Map(p.nodes.map(x => [x.id, x]))
const self = new Map(); const byFile = new Map()
const dt = p.timeDeltas; let total = 0
for (let i = 0; i < p.samples.length; i++) {
  const node = byId.get(p.samples[i]); const ms = (dt[i] || 0) / 1000; total += ms
  const cf = node.callFrame; const file = (cf.url || '').replace(/.*\/(sygnal-check\/src\/|node_modules\/)/, '$1')
  const key = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`
  self.set(key, (self.get(key) || 0) + ms)
  const fk = file.startsWith('sygnal-check/src/') ? file : file.includes('@babel/parser') ? '@babel/parser' : cf.url ? 'other js' : cf.functionName || '(native)'
  byFile.set(fk, (byFile.get(fk) || 0) + ms)
}
const pct = ms => `${(100 * ms / total).toFixed(1)}%`
console.log(`total ${total.toFixed(0)} ms`)
console.log('-- by file'); for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(pct(v).padStart(6), k)
console.log('-- by function'); for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, +n)) console.log(pct(v).padStart(6), k)
