#!/usr/bin/env node
/**
 * S-2 throwaway prototype: the spike page (../template.html) taught to render a runtime inspect()
 * graph. Applies a list of small patches to a copy of the template (so the changes the real V-3 /
 * P-1 need are explicit), writes runtime/template-runtime.html, and renders a page per sample:
 *
 *   node dev-plans/research/graph-viz/runtime/make-runtime-page.mjs
 *     → runtime/out/<sample>.html            instances grouped ×N (the recommended mapping)
 *     → runtime/out/<sample>.instances.html  one card per instance (the alternative, to compare)
 *
 * A sample is <name>.runtime.json (inspect({ actions })) plus an optional <name>.state.json
 * ({ [instanceId]: state }: inspect() has no state values; devtools has them).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let page = fs.readFileSync(path.join(here, '..', 'template.html'), 'utf8')

const ADAPTER = String.raw`
/**
 * S-2: a runtime graph (source: 'runtime': one entry per live instance, parentId links, no file or
 * line) mapped onto the page's component model.
 *   mode 'group' (default): one card per (parent card, component name): the instances a Collection,
 *     a Switchable or repeated tags make are one card "×N"; root instances group by name (two
 *     run() apps of the same root component are one card ×2)
 *   mode 'instances': one card per instance (id = the instance id)
 * Each card keeps rt = { count, instances: [ids], states: { id: state }, keys: { id: item key },
 * actions: { name: count } } for the detail panel; children carry the target card's id (A-3) and
 * events carry emitterIds / selectorIds, so nothing is resolved by name.
 */
function fromRuntime(g, meta, mode) {
  const byInst = new Map(g.components.map(c => [c.id, c]))
  const groupOf = new Map() // instance id → card key
  const keyOf = (c) => {
    if (groupOf.has(c.id)) return groupOf.get(c.id)
    const parent = c.parentId != null && byInst.get(c.parentId)
    const k = mode === 'instances' ? 'i' + c.id : (parent ? keyOf(parent) + '>' : '') + c.name
    groupOf.set(c.id, k)
    return k
  }
  const cards = new Map()
  const union = (a, b) => { for (const x of b) if (!a.includes(x)) a.push(x); return a }
  const RANK = { intent: 5, reply: 4, next: 3, agent: 3, builtin: 2, unknown: 0 }
  for (const c of g.components) {
    const k = keyOf(c)
    let d = cards.get(k)
    if (!d) {
      d = { name: c.name, id: 'rt:' + k, parentId: null, kind: c.kind, actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [],
        eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [],
        rt: { count: 0, instances: [], states: {}, keys: {}, actions: {}, parentKey: c.parentId != null && byInst.get(c.parentId) ? keyOf(byInst.get(c.parentId)) : null } }
      if (c.resources) d.resources = c.resources
      cards.set(k, d)
    }
    d.rt.count++; d.rt.instances.push(c.id)
    const st = meta.states && meta.states[c.id]
    if (st !== undefined) { d.rt.states[c.id] = st; if (st && typeof st === 'object' && 'id' in st) d.rt.keys[c.id] = st.id }
    for (const a of c.actions) {
      const have = d.actions.find(x => x.name === a.name)
      if (!have) d.actions.push({ ...a, sinks: [...a.sinks] })
      else { if ((RANK[a.trigger] ?? 0) > (RANK[have.trigger] ?? 0)) have.trigger = a.trigger; union(have.sinks, a.sinks) }
    }
    union(d.stateKeys, c.stateKeys); union(d.calculated, c.calculated); union(d.contextProvides, c.contextProvides)
    union(d.eventsEmitted, c.eventsEmitted); union(d.eventsSelected, c.eventsSelected)
    for (const s of c.selectors) {
      const have = d.selectors.find(x => x.selector === s.selector)
      // runtime matched:false = not in the latest render of that instance, so any instance's true wins
      if (!have) d.selectors.push({ ...s }); else if (s.matched) have.matched = true
    }
    for (const x of c.diagnostics) if (!d.diagnostics.some(y => y.code === x.code && y.message === x.message)) d.diagnostics.push(x)
    if (c.controls) d.controls = union(d.controls || [], c.controls)
  }
  for (const d of cards.values()) {
    const parent = d.rt.parentKey && cards.get(d.rt.parentKey)
    if (!parent) continue
    const VIA = { root: 'tag', child: 'tag', 'collection-item': 'collection', switchable: 'switchable' }
    parent.children.push({ name: d.name, via: VIA[d.kind] || 'tag', id: d.id, count: d.rt.count })
  }
  for (const a of g.recentActions || []) {
    const k = groupOf.get(a.instance)
    if (k) cards.get(k).rt.actions[a.type] = (cards.get(k).rt.actions[a.type] || 0) + 1
  }
  const events = {}
  for (const [type, e] of Object.entries(g.events || {})) {
    const ids = (list) => [...cards.values()].filter(d => list(d).includes(type)).map(d => d.id)
    events[type] = { ...e, emitterIds: ids(d => d.eventsEmitted), selectorIds: ids(d => d.eventsSelected) }
  }
  return { ...g, components: [...cards.values()], events, groupOf: Object.fromEntries(groupOf) }
}
`

const patches = [
  // the graph through the adapter when it is a runtime graph
  [`const G = JSON.parse(document.getElementById('graph-data').textContent)
const META = JSON.parse(document.getElementById('graph-meta').textContent)`,
   `const META = JSON.parse(document.getElementById('graph-meta').textContent)
const RAW = JSON.parse(document.getElementById('graph-data').textContent)
const RUNTIME = RAW.source === 'runtime'
${ADAPTER}
const G = RUNTIME ? fromRuntime(RAW, META, /instances/.test(location.hash) || META.mode === 'instances' ? 'instances' : 'group') : RAW`],
  // no file / line at runtime
  [`const lineOf = (c) => c.id.split(':').pop()`, `const lineOf = (c) => c.file ? c.id.split(':').pop() : ''`],
  // A-3: a child entry's id wins over the name
  [`let t = resolve(ch.name, c)`, `let t = (ch.id && byId.get(ch.id)) || resolve(ch.name, c)`],
  // A-3: events by id
  [`for (const [type, e] of Object.entries(G.events || {})) {
  for (const en of e.emitters) for (const sn of e.selectors) {`,
   `for (const [type, e] of Object.entries(G.events || {})) {
  if (e.emitterIds) { for (const a of e.emitterIds) for (const b of e.selectorIds) eventEdges.push({ from: a, to: b, type }); continue }
  for (const en of e.emitters) for (const sn of e.selectors) {`],
  // runtime: 'unknown' = not seen yet, matched:false = not in the latest render, events = seen so
  // far: the static health checks would be false alarms
  [/if \(!codes\.has\(/g, `if (!RUNTIME && !codes.has(`],
  [`H('AI agent surface'`, `if (RUNTIME) {
  H('Actions not seen yet', 'var(--faint)', comps.flatMap(c => c.actions.filter(a => a.trigger === 'unknown' && !a.behavior).map(a => ({ comp: c, title: a.name, sub: c.name + ' · no intent, reply or next() seen for it yet (static: sygnal-check)' }))))
  H('EVENTS selected, not emitted yet', 'var(--faint)', Object.entries(G.events || {}).filter(([, e]) => !e.emitters.length).map(([t, e]) => ({ comp: resolve(e.selectors[0]), event: t, title: t, sub: 'selected by ' + e.selectors.join(', ') })))
}
H('AI agent surface'`],
  // the card: ×N and instance ids instead of file:line
  [`name.textContent = c.name.length > 22 ? c.name.slice(0, 21) + '…' : c.name`,
   `{ const nm = c.rt && c.rt.count > 1 ? c.name.slice(0, 17) + ' ×' + c.rt.count : c.name; name.textContent = nm.length > 22 ? nm.slice(0, 21) + '…' : nm }`],
  [/const file = c\.ghost \? '([^']*)' : `\$\{c\.file\.split\('\/'\)\.pop\(\)\}:\$\{lineOf\(c\)\}`/,
   (m, ghostText) => `const file = c.ghost ? '${ghostText}' : c.rt ? 'instance' + (c.rt.count > 1 ? 's #' : ' #') + c.rt.instances.join(' #') : \`\${c.file.split('/').pop()}:\${lineOf(c)}\``],
  [`title.textContent = c.ghost ? \`\${c.name}: rendered, but not found in the scanned files\` : \`\${c.name}\\n\${c.file}:\${lineOf(c)}\``,
   `title.textContent = c.ghost ? \`\${c.name}: rendered, but not found in the scanned files\` : c.rt ? \`\${c.name} ×\${c.rt.count}\` : \`\${c.name}\\n\${c.file}:\${lineOf(c)}\``],
  // detail panel: no file link at runtime; instances with state; recent actions
  [`(href ? \`<a href="\${esc(href)}">\${esc(c.file)}:\${lineOf(c)}</a>\` : \`<span class="mono">\${esc(c.file)}:\${lineOf(c)}</span>\`)`,
   `(href ? \`<a href="\${esc(href)}">\${esc(c.file)}:\${lineOf(c)}</a>\` : c.rt ? \`<span class="mono">runtime · \${c.rt.count} instance\${c.rt.count === 1 ? '' : 's'}</span>\` : \`<span class="mono">\${esc(c.file)}:\${lineOf(c)}</span>\`)`],
  [`$('dinner').innerHTML = out.join('')`, `if (c.rt) out.splice(1, 0, runtimeSections(c))
  $('dinner').innerHTML = out.join('')`],
  [`function renderDetail(c) {`, `function runtimeSections(c) {
  const out = []
  const acts = Object.entries(c.rt.actions).sort((a, b) => b[1] - a[1])
  if (acts.length) out.push(\`<div class="dsec"><h4>Recent actions <span class="n">\${acts.reduce((n, a) => n + a[1], 0)}</span></h4><div class="chips">\${acts.map(([t, n]) => chip(t + ' ×' + n, \`data-trace-action="\${esc(t)}"\`, 'link')).join('')}</div></div>\`)
  const rows = c.rt.instances.map(id => {
    const st = c.rt.states[id]
    const text = st === undefined ? '(no state sample)' : JSON.stringify(st, null, 1)
    const key = c.rt.keys[id] !== undefined ? \` <small>key \${esc(c.rt.keys[id])}</small>\` : ''
    return \`<details class="behav" \${c.rt.count === 1 ? 'open' : ''}><summary>#\${esc(id)}\${key}</summary><pre class="mono" style="white-space:pre-wrap;font-size:11px;max-height:220px;overflow:auto;margin:4px 0">\${esc(text.length > 3000 ? text.slice(0, 3000) + '…' : text)}</pre></details>\`
  })
  out.push(\`<div class="dsec"><h4>Instances <span class="n">\${c.rt.count}</span></h4>\${rows.join('')}</div>\`)
  return out.join('')
}

function renderDetail(c) {`],
  // a flash when an action runs (P-1: the devtools ACTIONS message; here: replay recentActions)
  [`</style>`, `.node.flash .box { animation: sygflash .9s ease-out; }
@keyframes sygflash { 0% { stroke: var(--ev); stroke-width: 4; filter: drop-shadow(0 0 8px var(--ev)); } 100% { stroke-width: 1; filter: none; } }
@media (prefers-reduced-motion: reduce) { .node.flash .box { animation: none; stroke: var(--ev); stroke-width: 3; } }
</style>`],
  [`fit(undefined, false)
const first`, `// host API (P-1): the devtools panel calls action(record) for each new action
function flash(cardId) { const n = nodeEls.get(cardId); if (!n) return; n.classList.remove('flash'); void n.getBBox(); n.classList.add('flash') }
window.__sygnalGraph = { action(r) { const k = G.groupOf && G.groupOf[r.instance]; if (k) flash('rt:' + k) }, replay(speed = 4) { const list = RAW.recentActions || []; if (!list.length) return 0; const t0 = list[0].at; for (const r of list) setTimeout(() => window.__sygnalGraph.action(r), (r.at - t0) / speed); return list.length } }
fit(undefined, false)
const first`],
]

for (const [from, to] of patches) {
  const before = page
  page = typeof from === 'string' ? page.replace(from, () => to) : page.replace(from, to)
  if (page === before) throw new Error('patch did not apply: ' + String(from).slice(0, 80))
}
fs.writeFileSync(path.join(here, 'template-runtime.html'), page)

fs.mkdirSync(path.join(here, 'out'), { recursive: true })
const inline = (v) => JSON.stringify(v).replace(/</g, '\\u003c')
for (const f of fs.readdirSync(here).filter(f => f.endsWith('.runtime.json'))) {
  const name = f.replace('.runtime.json', '')
  const g = JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
  let states
  try { states = JSON.parse(fs.readFileSync(path.join(here, name + '.state.json'), 'utf8')) } catch { /* none */ }
  if (states && states.root !== undefined) states = { 0: states.root } // the kanban probe's shape
  for (const mode of ['group', 'instances']) {
    const meta = { title: name + ' (runtime)', subtitle: `runtime inspect() · ${g.components.length} instances`, root: '', codes: {}, states, mode }
    const html = page.replace('__TITLE__', meta.title).replace('__GRAPH__', () => inline(g)).replace('__META__', () => inline(meta))
    fs.writeFileSync(path.join(here, 'out', name + (mode === 'group' ? '' : '.instances') + '.html'), html)
  }
}
console.log('wrote runtime/template-runtime.html and runtime/out/*.html')
