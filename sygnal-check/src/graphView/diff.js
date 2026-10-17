/**
 * The app graph compared with a git ref (PLAN-10 C-3, V-6): `sygnal-check --graph --base <ref>`.
 * Components are matched by `key` ('file#name', D521), never by `id` (ids carry line numbers). A
 * renamed or moved file is a removal plus an addition (the key holds the file).
 *
 *   graphDiff(base, head, { base?: ref, head?: label, commit? }) → GraphDiff (the --json output)
 *     {
 *       base: 'HEAD~1', head: 'working tree', commit?: '<sha of the ref>',
 *       added:   ['src/New.jsx#New', …],            component keys only in head
 *       removed: ['src/Old.jsx#Old', …],            component keys only in base
 *       changed: [{ key, fields: { <field>: { added: [], removed: [] } | { base, head } } }],
 *       events:  { added: ['TYPE', …], removed: […] }   EVENTS types (graph.events keys)
 *     }
 *     Lists are sorted; `fields` holds only what changed. List fields (strings):
 *       actions (names), sinks ('ACTION:SINK'), stateKeys, calculated, stateReads, contextProvides,
 *       contextConsumes, eventsEmitted, eventsSelected, selectors (the selector, or 'control Name'),
 *       children (the child's key, else its name, `package:Name` for a package component, with
 *       ' (collection)' / ' (switchable)' / ' (slot)' / ' (layout)' when not a plain tag),
 *       diagnostics ('SYG110 message': no line, so moved code isn't a change)
 *     Scalar fields ({ base, head }): kind, entry, route
 *   diffIsEmpty(diff), formatDiff(diff) → text ('+ Name  file', '- Name  file', '~ Name: +action X, -event Y')
 *   keyParts(key) → { file, name }
 *
 *   diffModel(V, base, head) → { M, headModel, diff, status, fieldsOf, removedIds }
 *     The page's model of the head graph with the diff on it (V: the page namespace, for
 *     buildModel). The base's removed components are added as cards (id 'base:<base id>',
 *     `diff: 'removed'`, no diagnostics, context or entry: ghosts of what was there), added and
 *     changed components get `diff: 'added' | 'changed'`. Edges get `diff: 'added' | 'removed'`:
 *     render and EVENTS edges of the base that are gone are added to the model (from / to a
 *     removed card, or between cards that are still there); context and PARENT edges are marked
 *     'added' only (a removed one isn't drawn). headModel: the head alone (health and counts).
 *   diffMermaid(V, base, head, { events }) → the Mermaid flowchart with classes added / removed /
 *     changed and linkStyle on the added / removed edges
 *
 * The page (page.js calls these when META.base is set):
 *   diffNodeClass(c), diffEdgeClass(route), diffGroupCount(DX, members)
 *   diffSummaryHtml(DX, { esc, byId }) the sidebar section (counts, the list: buttons data-goto)
 *   diffDetailHtml(DX, c, { esc }) the detail panel's "Changes" section
 *
 * Pure: no DOM, no imports (html.js inlines it; see model.js).
 */

const LIST_FIELDS = ['actions', 'sinks', 'stateKeys', 'calculated', 'stateReads', 'contextProvides', 'contextConsumes', 'eventsEmitted', 'eventsSelected', 'children', 'selectors', 'diagnostics']
const SCALAR_FIELDS = ['kind', 'entry', 'route']

/** 'src/a/Item.jsx#Item#2' → { file: 'src/a/Item.jsx', name: 'Item#2' } */
export function keyParts(key) {
  const i = key.indexOf('#', key.lastIndexOf('/') + 1)
  return i < 0 ? { file: key, name: key } : { file: key.slice(0, i), name: key.slice(i + 1) }
}

const keyOfComp = (c) => c.key ?? `${c.file}#${c.name}`
const uniq = (xs) => [...new Set(xs)].sort()

/** A component's comparable lists (strings). */
function facets(c, keyById) {
  const via = (v) => !v || v === 'tag' ? '' : ` (${v})`
  return {
    actions: uniq((c.actions || []).map(a => a.name)),
    sinks: uniq((c.actions || []).flatMap(a => (a.sinks || []).map(s => `${a.name}:${s}`))),
    stateKeys: uniq(c.stateKeys || []),
    calculated: uniq(c.calculated || []),
    stateReads: uniq(c.stateReads || []),
    contextProvides: uniq(c.contextProvides || []),
    contextConsumes: uniq(c.contextConsumes || []),
    eventsEmitted: uniq(c.eventsEmitted || []),
    eventsSelected: uniq(c.eventsSelected || []),
    children: uniq((c.children || []).map(ch => ((ch.id != null && keyById.get(ch.id)) || (ch.external ? `${ch.external}:${ch.name}` : ch.name)) + via(ch.via))),
    selectors: uniq((c.selectors || []).map(s => s.control ? `control ${s.control}` : String(s.selector))),
    diagnostics: uniq((c.diagnostics || []).map(d => `${d.code} ${d.message}`)),
  }
}

const scalar = (c, f) => f === 'entry' ? (c.entry ?? false) : f === 'route' ? (c.route ?? null) : c[f] ?? null

function listDiff(a, b) {
  const A = new Set(a), B = new Set(b)
  return { added: b.filter(x => !A.has(x)), removed: a.filter(x => !B.has(x)) }
}

export function graphDiff(base, head, opts = {}) {
  const idx = (g) => {
    const comps = g?.components || []
    return { byKey: new Map(comps.map(c => [keyOfComp(c), c])), keyById: new Map(comps.map(c => [c.id, keyOfComp(c)])) }
  }
  const B = idx(base), H = idx(head)
  const out = { base: opts.base ?? 'base', head: opts.head ?? 'working tree' }
  if (opts.commit) out.commit = opts.commit
  out.added = [...H.byKey.keys()].filter(k => !B.byKey.has(k)).sort()
  out.removed = [...B.byKey.keys()].filter(k => !H.byKey.has(k)).sort()
  out.changed = []
  for (const [key, h] of H.byKey) {
    const b = B.byKey.get(key)
    if (!b) continue
    const fb = facets(b, B.keyById), fh = facets(h, H.keyById)
    const fields = {}
    for (const f of SCALAR_FIELDS) { const x = scalar(b, f), y = scalar(h, f); if (JSON.stringify(x) !== JSON.stringify(y)) fields[f] = { base: x, head: y } }
    // an added or removed action's sinks are not listed again under `sinks`
    const acts = listDiff(fb.actions, fh.actions), moved = new Set([...acts.added, ...acts.removed])
    for (const f of LIST_FIELDS) {
      const d = f === 'actions' ? acts : listDiff(fb[f], fh[f])
      if (f === 'sinks') { d.added = d.added.filter(x => !moved.has(x.slice(0, x.lastIndexOf(':')))); d.removed = d.removed.filter(x => !moved.has(x.slice(0, x.lastIndexOf(':')))) }
      if (d.added.length || d.removed.length) fields[f] = d
    }
    if (Object.keys(fields).length) out.changed.push({ key, fields })
  }
  out.changed.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  const be = Object.keys(base?.events || {}), he = Object.keys(head?.events || {})
  out.events = { added: he.filter(t => !be.includes(t)).sort(), removed: be.filter(t => !he.includes(t)).sort() }
  return out
}

export function diffIsEmpty(d) {
  return !d.added.length && !d.removed.length && !d.changed.length && !d.events.added.length && !d.events.removed.length
}

const WORD = {
  actions: 'action', sinks: 'sink', stateKeys: 'state', calculated: 'calculated', stateReads: 'reads', contextProvides: 'provides',
  contextConsumes: 'context', eventsEmitted: 'emits', eventsSelected: 'selects', children: 'child', selectors: 'selector', diagnostics: 'diagnostic',
}

/**
 * How a changed field's entries read: a child by its name, with its file when the same name is both
 * added and removed (a moved or renamed file).
 */
export function childLabel(f, d) {
  if (f !== 'children') return (x) => x
  const names = (xs) => new Set(xs.map(x => keyParts(x).name))
  const a = names(d.added), r = names(d.removed)
  return (x) => {
    const p = keyParts(x)
    if (!(a.has(p.name) && r.has(p.name)) || p.file === x) return p.name
    const via = / \([a-z]+\)$/.exec(p.name)?.[0] ?? ''
    return `${p.name.slice(0, p.name.length - via.length)}${via} in ${p.file}`
  }
}

/** One changed component's fields in words: '+action SAVE, -emits SAVED, kind child → root'. */
export function fieldsText(fields) {
  const parts = []
  for (const f of SCALAR_FIELDS) if (fields[f]) parts.push(`${f} ${JSON.stringify(fields[f].base)} → ${JSON.stringify(fields[f].head)}`)
  for (const f of LIST_FIELDS) {
    const d = fields[f]
    if (!d) continue
    const show = childLabel(f, d)
    for (const x of d.added) parts.push(`+${WORD[f]} ${show(x)}`)
    for (const x of d.removed) parts.push(`-${WORD[f]} ${show(x)}`)
  }
  return parts.join(', ')
}

export function formatDiff(d) {
  const lines = [`app graph: ${d.base}${d.commit ? ` (${d.commit.slice(0, 10)})` : ''} → ${d.head}`]
  if (diffIsEmpty(d)) return lines.concat('no changes').join('\n')
  const show = (key) => { const p = keyParts(key); return `${p.name}  ${p.file}` }
  for (const k of d.added) lines.push(`+ ${show(k)}`)
  for (const k of d.removed) lines.push(`- ${show(k)}`)
  for (const c of d.changed) lines.push(`~ ${keyParts(c.key).name}: ${fieldsText(c.fields)}  ${keyParts(c.key).file}`)
  if (d.events.added.length || d.events.removed.length) lines.push(`EVENTS: ${[...d.events.added.map(t => '+' + t), ...d.events.removed.map(t => '-' + t)].join(', ')}`)
  const n = (x, w) => `${x} ${w}`
  lines.push(`${n(d.added.length, 'added')}, ${n(d.removed.length, 'removed')}, ${n(d.changed.length, 'changed')}`)
  return lines.join('\n')
}

// ───────────── the model with the diff on it (the page, Mermaid) ─────────────

export function diffModel(V, base, head, opts = {}) {
  const diff = graphDiff(base, head, opts)
  const status = new Map()
  for (const k of diff.added) status.set(k, 'added')
  for (const k of diff.removed) status.set(k, 'removed')
  const fieldsOf = new Map(diff.changed.map(c => [c.key, c.fields]))
  for (const k of fieldsOf.keys()) status.set(k, 'changed')

  const baseComps = base?.components || []
  const headKeys = new Set((head?.components || []).map(keyOfComp))
  const headIdOf = new Map((head?.components || []).map(c => [keyOfComp(c), c.id]))
  const baseKeyById = new Map(baseComps.map(c => [c.id, keyOfComp(c)]))
  // a base id in the merged graph: the head card with its key, else the removed card
  const mapId = (id) => { const k = baseKeyById.get(id); return k == null ? null : headKeys.has(k) ? headIdOf.get(k) : 'base:' + id }
  const removedIds = new Set()
  const removed = baseComps.filter(c => !headKeys.has(keyOfComp(c))).map(c => {
    const id = 'base:' + c.id
    removedIds.add(id)
    const { entry: _e, childSelects: _cs, ...rest } = c
    return {
      ...rest, id, key: keyOfComp(c), diff: 'removed', diagnostics: [], contextProvides: [], contextConsumes: [],
      children: (c.children || []).filter(ch => ch.id != null && mapId(ch.id)).map(ch => ({ ...ch, id: mapId(ch.id) })),
    }
  })
  const merged = {
    ...head,
    components: [...(head?.components || []).map(c => status.has(keyOfComp(c)) ? { ...c, diff: status.get(keyOfComp(c)) } : c), ...removed],
  }
  const M = V.buildModel(merged)
  const headModel = V.buildModel(head)
  const baseModel = V.buildModel(base)

  // edges by the keys of their ends (stable across the two graphs)
  const ek = (Mx, e, extra) => `${Mx.byId.get(e.from)?.key}>${Mx.byId.get(e.to)?.key}|${extra}`
  const set = (Mx, list, f) => new Set(list.map(e => ek(Mx, e, f(e))))
  const kinds = [
    ['renderEdges', (e) => e.via], ['eventEdges', (e) => e.type],
    ['contextEdges', (e) => e.fields.join(',')], ['parentEdges', (e) => (e.actions || []).join(',')],
  ]
  for (const [name, f] of kinds) {
    const inBase = set(baseModel, baseModel[name] || [], f)
    const inHead = set(headModel, headModel[name] || [], f)
    for (const e of M[name] || []) {
      const k = ek(M, e, f(e))
      if (removedIds.has(e.from) || removedIds.has(e.to)) e.diff = 'removed'
      else if (inHead.has(k) && !inBase.has(k)) e.diff = 'added'
    }
  }
  // the base's render and EVENTS edges that are gone, between cards that are drawn
  const idByKey = (k) => M.byKey.get(k) ?? null
  const have = new Set((M.renderEdges).map(e => ek(M, e, e.via)))
  for (const e of baseModel.renderEdges) {
    const from = idByKey(baseModel.byId.get(e.from)?.key), to = idByKey(baseModel.byId.get(e.to)?.key)
    if (from == null || to == null) continue
    const x = { from, to, via: e.via, label: e.label, diff: 'removed' }
    const k = ek(M, x, x.via)
    if (have.has(k)) continue
    have.add(k)
    M.renderEdges.push(x)
    if (!M.parentsOf.get(to).includes(from)) M.parentsOf.get(to).push(from)
    if (!M.childrenOf.get(from).includes(to)) M.childrenOf.get(from).push(to)
  }
  const haveEv = new Set(M.eventEdges.map(e => ek(M, e, e.type)))
  for (const e of baseModel.eventEdges) {
    const from = idByKey(baseModel.byId.get(e.from)?.key), to = idByKey(baseModel.byId.get(e.to)?.key)
    if (from == null || to == null) continue
    const x = { from, to, type: e.type, diff: 'removed' }
    const k = ek(M, x, x.type)
    if (haveEv.has(k)) continue
    haveEv.add(k)
    M.eventEdges.push(x)
  }
  return { M, headModel, baseModel, diff, status, fieldsOf, removedIds }
}

export function diffMermaid(V, base, head, opts = {}) {
  const DX = diffModel(V, base, head, opts)
  return V.toMermaid(DX.M, {
    events: opts.events !== false,
    classOf: (c) => c.diff || null,
    edgeClassOf: (e) => e.diff || null,
    classDefs: {
      added: 'stroke:#15803d,stroke-width:2px',
      removed: 'stroke:#c81e1e,stroke-dasharray:5 5,opacity:0.6',
      changed: 'stroke:#a14a07,stroke-width:2px',
    },
    linkStyles: { added: 'stroke:#15803d,stroke-width:2px', removed: 'stroke:#c81e1e,stroke-dasharray:5 5' },
  })
}

// ───────────── the page ─────────────

export const diffNodeClass = (c) => c?.diff ? ' diff-' + c.diff : ''

/** An edge route's class (edgePaths output): only between components (a bundle to a group mixes edges). */
export function diffEdgeClass(r) {
  const d = r.edge?.diff
  if (!d || String(r.from).startsWith('grp:') || String(r.to).startsWith('grp:') || String(r.from).startsWith('bus:') || String(r.to).startsWith('bus:')) return ''
  return ' diff-' + d
}

/** How many of a folded group's members changed (added, removed or changed). */
export function diffGroupCount(DX, members, byId) {
  let n = 0
  for (const id of members) if (byId.get(id)?.diff) n++
  return n
}

const SIGN = { added: '+', removed: '−', changed: '~' }

export function diffSummaryHtml(DX, { esc, byId }) {
  const d = DX.diff
  const counts = [['added', d.added.length], ['removed', d.removed.length], ['changed', d.changed.length]]
  const ev = d.events.added.length + d.events.removed.length
  const items = []
  const idOf = (k, s) => s === 'removed' ? [...DX.removedIds].find(id => byId.get(id)?.key === k) : DX.M.byKey.get(k)
  for (const [s, list] of [['added', d.added], ['removed', d.removed], ['changed', d.changed.map(c => c.key)]]) {
    for (const k of list) {
      const id = idOf(k, s)
      if (id == null) continue
      const p = keyParts(k)
      const why = s === 'changed' ? fieldsText(DX.fieldsOf.get(k)) : p.file
      items.push(`<li><button type="button" class="diff-item d-${s}" data-goto="${esc(id)}" title="${esc(why)}"><span class="dsign" aria-hidden="true">${SIGN[s]}</span><span class="t">${esc(p.name)}<small>${esc(why)}</small></span><span class="sr-only">, ${s}</span></button></li>`)
    }
  }
  const evs = [...d.events.added.map(t => `<span class="chip d-added" title="EVENTS type added">+${esc(t)}</span>`), ...d.events.removed.map(t => `<span class="chip d-removed" title="EVENTS type removed">−${esc(t)}</span>`)]
  return `<div class="diff-head">Compared with <code>${esc(d.base)}</code>${d.commit ? ` <span class="unk">${esc(d.commit.slice(0, 8))}</span>` : ''}</div>`
    + `<div class="diff-counts">${counts.map(([s, n]) => `<span class="dc d-${s}"><b>${n}</b> ${s}</span>`).join('')}${ev ? `<span class="dc"><b>${ev}</b> event type${ev === 1 ? '' : 's'}</span>` : ''}</div>`
    + (items.length ? `<ul class="plain diff-list">${items.join('')}</ul>` : '<div class="empty">No component changed</div>')
    + (evs.length ? `<div class="chips" style="margin-top:6px">${evs.join('')}</div>` : '')
}

const LABEL = {
  kind: 'kind', entry: 'entry', route: 'route', actions: 'actions', sinks: 'sinks', stateKeys: 'state keys', calculated: 'calculated',
  stateReads: 'state reads', contextProvides: 'context provided', contextConsumes: 'context read', eventsEmitted: 'EVENTS emitted',
  eventsSelected: 'EVENTS selected', children: 'children', selectors: 'DOM selectors', diagnostics: 'diagnostics',
}

export function diffDetailHtml(DX, c, { esc }) {
  if (!c?.diff) return ''
  const ref = esc(DX.diff.base)
  if (c.diff === 'added') return `<section class="dsec diff-sec d-added"><h3>Changes</h3><div>Added since <code>${ref}</code>.</div></section>`
  if (c.diff === 'removed') return `<section class="dsec diff-sec d-removed"><h3>Changes</h3><div>Removed: in <code>${ref}</code>, not in the ${esc(DX.diff.head)}. What it had there is shown below.</div></section>`
  const f = DX.fieldsOf.get(c.key) || {}
  const rows = []
  for (const k of SCALAR_FIELDS) if (f[k]) rows.push(`<div class="r"><span class="lbl">${LABEL[k]}</span><span>${esc(JSON.stringify(f[k].base))} → ${esc(JSON.stringify(f[k].head))}</span></div>`)
  for (const k of LIST_FIELDS) {
    const d = f[k]
    if (!d) continue
    const show = childLabel(k, d)
    rows.push(`<div class="r"><span class="lbl">${LABEL[k]}</span><span class="chips">${d.added.map(x => `<span class="chip d-added" title="added">+ ${esc(show(x))}</span>`).join('')}${d.removed.map(x => `<span class="chip d-removed" title="removed">− ${esc(show(x))}</span>`).join('')}</span></div>`)
  }
  return `<section class="dsec diff-sec d-changed"><h3>Changes <span class="n">since ${ref}</span></h3><div class="rel">${rows.join('')}</div></section>`
}
