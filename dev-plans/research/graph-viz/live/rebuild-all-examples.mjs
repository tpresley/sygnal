#!/usr/bin/env node
/**
 * S-3 probe: rebuild time on every example's src/ together (one many-rooted graph, the S-1 "all
 * examples" corpus), after a one-file edit through the `sources` overlay, with a warm parse cache.
 *
 *   node dev-plans/research/graph-viz/live/rebuild-all-examples.mjs
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { graph } from '../../../../sygnal-check/src/graph.js'
import { createParseCache } from '../../../../sygnal-check/src/cache.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const ex = path.join(repo, 'examples')
const paths = fs.readdirSync(ex).map(d => path.join(ex, d, 'src')).filter(p => fs.existsSync(p))
let t = performance.now()
const g = graph(paths, { cwd: ex, config: false })
const first = performance.now() - t
const cache = createParseCache()
graph(paths, { cwd: ex, cache, config: false })
const f = path.join(ex, 'plan5-showcase/src/demos/browser/Dashboard.jsx')
const txt = fs.readFileSync(f, 'utf8')
const xs = []
for (let i = 0; i < 7; i++) {
  t = performance.now()
  graph(paths, { cwd: ex, cache, config: false, sources: new Map([[f, txt + '\n// ' + i]]) })
  xs.push(performance.now() - t)
}
xs.sort((a, b) => a - b)
console.log(JSON.stringify({ components: g.components.length, graphBytes: JSON.stringify(g).length, firstBuildInProcessMs: +first.toFixed(0), warmOneFileEditMedianMs: +xs[3].toFixed(1), cacheStats: cache.stats }))
