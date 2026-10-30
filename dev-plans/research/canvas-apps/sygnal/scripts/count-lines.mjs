// Non-blank, non-comment lines per concern, counted exactly as the React baseline's
// scripts/count-lines.mjs counts (so the two tables compare). `node scripts/count-lines.mjs`
import {readFileSync} from 'node:fs'

function count(file) {
  let inBlock = false, n = 0
  for (const raw of readFileSync(new URL('../' + file, import.meta.url), 'utf8').split('\n')) {
    const line = raw.trim()
    if (inBlock) { if (line.includes('*/')) inBlock = false; continue }
    if (!line || line.startsWith('//')) continue
    if (line.startsWith('/*')) { if (!line.includes('*/')) inBlock = true; continue }
    n++
  }
  return n
}
const canvas = ['lib/canvas/Canvas.ts', 'lib/canvas/paint.ts', 'lib/canvas/router.ts', 'lib/canvas/geometry.ts', 'lib/canvas/gesture.ts', 'lib/canvas/pointer.ts', 'lib/canvas/snap.ts', 'lib/canvas/svg.ts', 'lib/canvas/index.ts']
const versions = {
  'built (app/ + lib/canvas, what an app writes today)': {
    'Document (tree ops, stress)': ['app/doc.ts', 'app/seed.ts'],
    'Model: every reducer (tools, snapping, undo, commands, layers, props)': ['app/model.ts'],
    'View + intents + panels': ['app/App.tsx', 'app/LayerRow.tsx'],
    'Canvas machinery (lib/canvas: island, painter, hit test, router, camera, geometry, snap, SVG)': canvas,
    'App shell + bench hook': ['app/main.tsx', 'app/bench.ts', 'app/styles.css'],
  },
  'proposed (app-proposed/ on sygnal/canvas + its kit)': {
    'Document (tree ops, stress)': ['app/doc.ts', 'app/seed.ts'],
    'Model': ['app-proposed/model.ts'],
    'View + intents + panels': ['app-proposed/App.tsx', 'app/LayerRow.tsx'],
    'App shell + bench hook': ['app/main.tsx', 'app/bench.ts', 'app/styles.css'],
  },
}
for (const [v, concerns] of Object.entries(versions)) {
  let total = 0
  console.log(`\n${v}\n| Concern | Files | Lines |\n|---|---|---:|`)
  for (const [name, files] of Object.entries(concerns)) {
    const n = files.reduce((a, f) => a + count(f), 0)
    total += n
    console.log(`| ${name} | ${files.map(f => '`' + f + '`').join(', ')} | ${n} |`)
  }
  console.log(`| **Total app** | | **${total}** |`)
}
console.log(`\nsygnal/canvas itself: core ${canvas.reduce((a, f) => a + count(f), 0)} + kit ${count('lib/canvas/kit.tsx')} lines`)
console.log(`research only: app/ShapeNode.tsx ${count('app/ShapeNode.tsx')}; tests ${count('test/app.test.tsx')}; perf/run.mjs ${count('perf/run.mjs')}`)
