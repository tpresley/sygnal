#!/usr/bin/env node
/**
 * S-3 probe: how long does a graph rebuild take after a one-file edit, with and without the
 * parse cache (sygnal-check/src/cache.js)? Simulates the edit through the `sources` overlay
 * (no file on disk is touched).
 *
 *   node dev-plans/research/graph-viz/live/rebuild-timing.mjs examples/plan5-showcase [file-to-edit] [--runs=N]
 *
 * Prints: cold build (no cache), warm rebuild with an unchanged tree (all cache hits), warm
 * rebuild after a one-line edit of one file (one re-parse), and the phases of the edited
 * rebuild: expand (file list), buildProject (parse + model), rules, buildGraph, JSON.stringify.
 */
import path from 'node:path'
import fs from 'node:fs'
import { performance } from 'node:perf_hooks'
import { graph } from '../../../../sygnal-check/src/graph.js'
import { createParseCache } from '../../../../sygnal-check/src/cache.js'
import { resolveOptions } from '../../../../sygnal-check/src/config.js'
import { expandInputs } from '../../../../sygnal-check/src/files.js'
import { buildProject } from '../../../../sygnal-check/src/model/project.js'
import { selectRules } from '../../../../sygnal-check/src/rules/index.js'
import { runRules } from '../../../../sygnal-check/src/run.js'
import { buildGraph } from '../../../../sygnal-check/src/graph.js'

const args = process.argv.slice(2)
const runsArg = args.find(a => a.startsWith('--runs='))
const runs = runsArg ? Number(runsArg.slice(7)) : 7
const [rootArg, editArg] = args.filter(a => !a.startsWith('--'))
const root = path.resolve(rootArg)
const { options } = resolveOptions({ cwd: root })
const { files } = expandInputs(options.paths, { cwd: root, includeTests: options.includeTests })
const edit = editArg ? path.resolve(root, editArg) : files.find(f => /\.jsx$/.test(f)) || files[0]
const text = fs.readFileSync(edit, 'utf8')
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const time = (fn) => { const t = performance.now(); const r = fn(); return [performance.now() - t, r] }

const cold = [], warmSame = [], warmEdit = []
let comps = 0, bytes = 0
for (let i = 0; i < runs; i++) {
  const [tc, g] = time(() => graph(null, { cwd: root }))
  cold.push(tc); comps = g.components.length; bytes = JSON.stringify(g).length
  const cache = createParseCache()
  graph(null, { cwd: root, cache })
  warmSame.push(time(() => graph(null, { cwd: root, cache }))[0])
  const sources = new Map([[edit, text + `\n// edit ${i}\n`]])
  warmEdit.push(time(() => graph(null, { cwd: root, cache, sources }))[0])
}

// the phases of one edited rebuild (warm cache)
const phases = { expand: [], buildProject: [], rules: [], buildGraph: [], stringify: [] }
{
  const cache = createParseCache()
  graph(null, { cwd: root, cache })
  for (let i = 0; i < runs; i++) {
    const sources = new Map([[edit, text + `\n// phase ${i}\n`]])
    const [te, ex] = time(() => expandInputs(options.paths, { cwd: root, includeTests: options.includeTests, sources }))
    const [tp, project] = time(() => buildProject(ex.files, { cwd: root, sources, cache }))
    const [tr, diags] = time(() => runRules(project, selectRules({ strict: options.strict, a11y: options.a11y })))
    const [tg, g] = time(() => buildGraph(project, diags))
    const [ts] = time(() => JSON.stringify(g))
    phases.expand.push(te); phases.buildProject.push(tp); phases.rules.push(tr); phases.buildGraph.push(tg); phases.stringify.push(ts)
  }
}

const ms = (x) => `${x.toFixed(1)} ms`
console.log(JSON.stringify({
  root: path.relative(process.cwd(), root), files: files.length, components: comps, graphBytes: bytes,
  edited: path.relative(root, edit), runs,
  coldMedian: ms(median(cold)), warmUnchangedMedian: ms(median(warmSame)), warmOneFileEditMedian: ms(median(warmEdit)),
  editedPhasesMedian: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, ms(median(v))])),
}, null, 2))
