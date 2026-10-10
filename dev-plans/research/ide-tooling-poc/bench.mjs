import { check } from '../../../sygnal-check/src/index.js'
for (const dir of process.argv.slice(2)) {
  const t = []
  for (let i = 0; i < 6; i++) { const s = performance.now(); const d = check([dir], { strict: true }); t.push(performance.now() - s); if (i === 0) process.stdout.write(`${dir}: ${d.length} diags; `) }
  console.log(`cold ${t[0].toFixed(0)} ms, warm median ${t.slice(1).sort((a,b)=>a-b)[2].toFixed(0)} ms`)
}
