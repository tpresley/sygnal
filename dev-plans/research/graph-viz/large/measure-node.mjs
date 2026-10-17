#!/usr/bin/env node
/**
 * S-1: layout measurements in Node (no browser): per corpus × strategy × engine, the projected
 * graph size, layout time, render-edge crossings, drawing area, the zoom that fits a 1440×900
 * window, and layout stability when one component is added.
 *
 *   node measure-node.mjs [--sizes 50,200,500,2000] [--json out.json] [--skip-elk-above 2000]
 *
 * Run `node gen.mjs --all` first (corpus/*.json).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildModel, groupOf, project, layout, metrics, displacement } from './model.mjs'
import { generate, addOne } from './gen.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const libs = { d3: require('d3-hierarchy'), dagre: require('@dagrejs/dagre'), ELK: require('elkjs/lib/elk.bundled.js') }
const args = process.argv.slice(2)
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const sizes = get('--sizes', '50,200,500,2000').split(',').map(Number)
const elkMax = +get('--skip-elk-above', 2000)

// --extra label=/path/graph.json: a corpus kept outside the repo (a private app); its page is written next to it
const extra = (() => { const i = process.argv.indexOf('--extra'); if (i < 0) return null; const [label, file] = process.argv[i + 1].split('='); return { label, file } })()
const corpusFile = (name) => extra && name === extra.label ? extra.file : path.join(here, 'corpus', name + '.json')
const pageFile = (name) => extra && name === extra.label ? path.join(path.dirname(extra.file), name + '.html') : path.join(here, 'out', name + '.html')
const load = (name) => JSON.parse(fs.readFileSync(corpusFile(name), 'utf8'))
const corpora = [...sizes.map(n => ['syn-' + n, load('syn-' + n)]), ['examples', load('examples')], ...(extra ? [[extra.label, load(extra.label)]] : [])]

const CONFIGS = {
  'flat (spike: islands, no groups)': { grouping: 'none', events: 'pairs' },
  'dir groups, open': { grouping: 'dir', events: 'pairs' },
  'dir groups, folded': { grouping: 'dir', foldedGroups: 'all', events: 'pairs' },
  'dir groups, folded, bus': { grouping: 'dir', foldedGroups: 'all', events: 'bus' },
  'community, folded': { grouping: 'community', foldedGroups: 'all', events: 'pairs' },
  'entry, folded': { grouping: 'entry', foldedGroups: 'all', events: 'pairs' },
  'subtrees folded at depth 3': { grouping: 'dir', autoFoldDepth: 3, events: 'pairs' },
  'subtrees folded at depth 4': { grouping: 'dir', autoFoldDepth: 4, events: 'pairs' },
  'focus Checkout (depth 2)': { grouping: 'none', focus: 'Checkout', focusDepth: 2, events: 'pairs' },
  'bus (where it saves edges), open groups': { grouping: 'dir', events: 'bus' },
  'bus per type, open groups': { grouping: 'dir', events: 'bus-all' },
}
const ENGINE_CONFIGS = ['flat (spike: islands, no groups)', 'dir groups, open', 'dir groups, folded', 'subtrees folded at depth 4']
const rows = []
const t = (ms) => ms < 10 ? ms.toFixed(1) : Math.round(ms)

for (const [name, G] of corpora) {
  const M = buildModel(G)
  const groupsCache = {}
  for (const [cname, cfg0] of Object.entries(CONFIGS)) {
    const cfg = { ...cfg0 }
    if (cfg.focus) { const c = M.comps.find(x => x.name === cfg.focus) ?? M.comps.find(x => !x.ghost && M.childrenOf.get(x.id).length); cfg.focus = c.id }
    const g0 = performance.now()
    cfg.groups = groupsCache[cfg.grouping] ??= groupOf(M, cfg.grouping)
    const groupMs = performance.now() - g0
    const p0 = performance.now(); const V = project(M, cfg); const projMs = performance.now() - p0
    const engines = ENGINE_CONFIGS.includes(cname) ? ['layered', 'layered-wrap', 'tidy', 'dagre', 'elk'] : ['layered', 'layered-wrap']
    for (const engine of engines) {
      if (engine === 'elk' && G.components.length > elkMax) continue
      let L
      try { L = await layout(V, engine, libs) } catch (e) { rows.push({ corpus: name, config: cname, engine, error: String(e.message).slice(0, 80) }); continue }
      const m = metrics(V, L)
      const groups = new Set([...cfg.groups.values()]).size
      rows.push({ corpus: name, n: G.components.length, config: cname, engine, groups, groupMs: +groupMs.toFixed(1), projectMs: +projMs.toFixed(1), ...m })
      process.stderr.write(`${name} · ${cname} · ${engine}: ${m.nodes} nodes, ${m.renderEdges} edges, ${t(L.ms)} ms, ${m.crossings} crossings, fit k ${m.fitK}\n`)
    }
  }
}

// stability: one component added (gen.addOne), same strategy, layout again
const stab = []
for (const n of sizes) {
  const G = generate(n, 1)
  const { graph: G2 } = addOne(G, 1)
  for (const [cname, cfg0] of Object.entries({ 'flat': { grouping: 'none', events: 'off' }, 'dir groups, open': { grouping: 'dir', events: 'off' }, 'dir groups, folded': { grouping: 'dir', foldedGroups: 'all', events: 'off' } })) {
    for (const engine of ['layered', 'layered-wrap', 'tidy', 'dagre', 'elk']) {
      if (engine === 'elk' && n > elkMax) continue
      const M1 = buildModel(G), M2 = buildModel(G2)
      const L1 = await layout(project(M1, { ...cfg0, groups: groupOf(M1, cfg0.grouping) }), engine, libs)
      const L2 = await layout(project(M2, { ...cfg0, groups: groupOf(M2, cfg0.grouping) }), engine, libs)
      const d = displacement(L1, L2)
      stab.push({ n, config: cname, engine, ...d })
      process.stderr.write(`stability ${n} · ${cname} · ${engine}: ${d.movedPct}% moved > 20px, median ${d.median}, p90 ${d.p90}\n`)
    }
  }
}

const out = get('--json'); if (out) fs.writeFileSync(out, JSON.stringify({ rows, stab }, null, 1))
const md = (list, cols) => ['| ' + cols.join(' | ') + ' |', '|' + cols.map(() => '---').join('|') + '|', ...list.map(r => '| ' + cols.map(c => r[c] ?? '').join(' | ') + ' |')].join('\n')
console.log(md(rows, ['corpus', 'config', 'engine', 'nodes', 'renderEdges', 'eventEdges', 'contextEdges', 'layoutMs', 'crossings', 'eventCrossings', 'w', 'h', 'fitK', 'error']))
console.log()
console.log(md(stab, ['n', 'config', 'engine', 'common', 'movedPct', 'median', 'p90', 'max']))
