// Self time of functions matching <re>, attributed to the nearest caller outside them: node callers.mjs <file> <re> [n=20]
import fs from 'node:fs'
const [f, re, n = '20'] = process.argv.slice(2)
const rx = new RegExp(re)
const p = JSON.parse(fs.readFileSync(f, 'utf8'))
const byId = new Map(p.nodes.map(x => [x.id, x])); const parent = new Map()
for (const x of p.nodes) for (const c of x.children || []) parent.set(c, x)
const name = x => `${x.callFrame.functionName || '(anon)'} ${(x.callFrame.url || '').replace(/.*sygnal-check\/src\//, '')}:${x.callFrame.lineNumber + 1}`
const out = new Map(); let total = 0, all = 0
for (let i = 0; i < p.samples.length; i++) {
  const ms = (p.timeDeltas[i] || 0) / 1000; all += ms
  let x = byId.get(p.samples[i])
  if (!rx.test(name(x))) continue
  total += ms
  while (x && (rx.test(name(x)) || /^\(anon\)/.test(name(x)))) x = parent.get(x.id)
  const k = x ? name(x) : '?'
  out.set(k, (out.get(k) || 0) + ms)
}
console.log(`${re}: ${(100 * total / all).toFixed(1)}% of ${all.toFixed(0)} ms`)
for (const [k, v] of [...out].sort((a, b) => b[1] - a[1]).slice(0, +n)) console.log(`${(100 * v / all).toFixed(1)}%`.padStart(6), k)
