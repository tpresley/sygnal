// End-to-end wall time of commands (process included), interleaved, median of 7.
//   node e2e.mjs <label> "<cmd>" ...
import { spawnSync } from 'node:child_process'
const [label, ...cmds] = process.argv.slice(2)
const t = cmds.map(() => [])
for (let r = 0; r < 7; r++) cmds.forEach((c, i) => { const [bin, ...args] = c.split(' '); const s = performance.now(); spawnSync(bin, args, { stdio: 'ignore' }); t[i].push(performance.now() - s) })
console.log(label)
cmds.forEach((c, i) => { const a = t[i].sort((x, y) => x - y); console.log(`  ${a[3].toFixed(0).padStart(5)} ms  ${c.replace(/\/cache\/\S*\//g, '').replace(/ \S*inputs\S*/, '')}`) })
