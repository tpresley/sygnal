/**
 * The page's model of an InspectGraph (PLAN-10 V-1): components resolved to ids, ghost nodes for
 * rendered names that resolve to nothing, the render / EVENTS / context edges, and the health list.
 *
 *   buildModel(graph) → Model
 *     comps         the graph's components (shallow copies with `dir`, `line`, `ghost: false`) plus
 *                   ghost nodes ({ ghost: true, kind: 'ghost' }), in graph order, ghosts last
 *     byId, byName  Map id → comp, Map name → comp[]
 *     byKey         Map key → id. `key` is stable across graph updates (ids are 'file:line' and move
 *                   when lines are added above a component): the graph's `key` when it has one
 *                   (D521), else `${file}#${name}`; ghosts `ghost:${external ?? dir}#${name}`.
 *                   Selection, positions and remembered UI are kept by key; ids link within one graph
 *     parentsOf, childrenOf   Map id → id[] (render edges, deduped)
 *     renderEdges   [{ from, to, via, label }]   via: 'tag' | 'collection' | 'switchable' | 'slot'
 *     eventEdges    [{ from, to, type }]          every emitter → every selector of the type
 *     contextEdges  [{ from, to, fields }]        a read served by the nearest providing ancestor
 *     parentEdges   [{ from, to, actions, line? }] child → parent: the parent's CHILD.select(Child)
 *                   (childSelects) and the intent actions it feeds
 *     orphanReads   [{ id, field }]               context reads no scanned ancestor provides
 *     ghosts        the ghost nodes
 *     diagnostics   every diagnostic, with `compId` (null for app-wide ones nobody owns)
 *     resolve(name, from?)  a name used in `from` → comp | null
 *   healthList(model, codeTitles?) → [{ group, tone, code?, items: [{ id, event?, title, sub }] }]
 *     tone: 'err' | 'warn' | 'muted' | 'ai'; diagnostics grouped by code (errors first), then the
 *     checks only the whole graph shows, each left out when a diagnostic code already reports it
 *   searchText(comp) → lowercased text the page's search matches against
 *   worst(comp) → 'error' | 'warn' | null
 *
 * Ids are preferred wherever the graph has them (children[].id, events[type].emitterIds /
 * selectorIds (full lists, D528) or { name, id } entries, diagnostics' componentId); a child with `id: null` or
 * `external` is a ghost (one per package and name for `external`); names are the fallback,
 * resolved like an import would be: the same file, then the same directory, then the
 * longest common path.
 *
 * Pure: no DOM, no imports. html.js inlines this file into the page (see html.js), so keep to
 * top-level `export function` / `export const` declarations.
 */

export const dirOf = (file) => file && file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.'

/** The component's definition line: `line` when the graph has it, else the id's 'file:line' suffix. */
export const lineOf = (c) => c.line ?? (c.id && /:\d+$/.test(c.id) ? Number(c.id.slice(c.id.lastIndexOf(':') + 1)) : null)

const nameOf = (x) => typeof x === 'string' ? x : x?.name
const idOf = (x) => (x && typeof x === 'object' ? x.id : null) ?? null

export function buildModel(graph) {
  const comps = (graph.components || []).map(c => ({
    ...c,
    actions: c.actions || [], stateKeys: c.stateKeys || [], calculated: c.calculated || [],
    contextProvides: c.contextProvides || [], contextConsumes: c.contextConsumes || [],
    eventsEmitted: c.eventsEmitted || [], eventsSelected: c.eventsSelected || [],
    children: c.children || [], selectors: c.selectors || [], diagnostics: c.diagnostics || [],
    ghost: false, dir: dirOf(c.file), line: lineOf(c), key: c.key ?? `${c.file}#${c.name}`,
  }))
  const byId = new Map(comps.map(c => [c.id, c]))
  const byName = new Map()
  for (const c of comps) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c) }

  function resolve(name, from) {
    const list = byName.get(name)
    if (!list || !list.length) return null
    if (list.length === 1 || !from) return list[0]
    const same = list.find(c => c.file === from.file); if (same) return same
    const sameDir = list.find(c => c.dir === from.dir); if (sameDir) return sameDir
    const common = (a = '', b = '') => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
    return list.slice().sort((a, b) => common(b.file, from.file) - common(a.file, from.file))[0]
  }
  const lookup = (id, name, from) => (id != null && byId.get(id)) || resolve(name, from)

  // render edges; a name that resolves to nothing becomes one ghost per directory
  const renderEdges = []
  const ghosts = new Map()
  for (const c of comps) {
    for (const ch of c.children) {
      // `id: null` (the graph says it resolved to no node: a package, a widget, dynamic) never
      // falls back to the name; a package component is one ghost per (package, name)
      let t = ch.id === null || ch.external ? null : lookup(ch.id, ch.name, c)
      if (!t) {
        const gid = ch.external ? `external:${ch.external}:${ch.name}` : `ghost:${c.dir}:${ch.name}`
        if (!ghosts.has(gid)) {
          ghosts.set(gid, {
            id: gid, key: `ghost:${ch.external ?? c.dir}#${ch.name}`, name: ch.name, ghost: true, kind: 'ghost', file: null, dir: c.dir, line: null,
            ...(ch.external ? { external: ch.external } : {}), ...(ch.widget ? { widget: true } : {}),
            actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [],
            eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [],
          })
        }
        t = ghosts.get(gid)
      }
      const label = ch.via === 'collection' ? (ch.from ? `[${ch.from}]` : '[ ]') : ch.via === 'switchable' ? 'switch' : ch.via === 'slot' ? 'slot' : ''
      renderEdges.push({ from: c.id, to: t.id, via: ch.via || 'tag', label })
    }
  }
  for (const g of ghosts.values()) { comps.push(g); byId.set(g.id, g) }

  const parentsOf = new Map(comps.map(c => [c.id, []]))
  const childrenOf = new Map(comps.map(c => [c.id, []]))
  for (const e of renderEdges) {
    if (!parentsOf.get(e.to).includes(e.from)) parentsOf.get(e.to).push(e.from)
    if (!childrenOf.get(e.from).includes(e.to)) childrenOf.get(e.from).push(e.to)
  }

  // EVENTS: every emitter → every selector of the type (the bus is app-wide)
  const eventEdges = []
  const seenEv = new Set()
  const events = graph.events || {}
  for (const type of Object.keys(events)) {
    const e = events[type] || {}
    // D528: emitterIds / selectorIds are independent full lists (not parallel to the names):
    // when present they alone decide the components; names are the fallback when a list is absent
    const fromIds = (ids) => ids.map(id => byId.get(id)).filter(Boolean)
    const emitters = Array.isArray(e.emitterIds) ? fromIds(e.emitterIds)
      : (e.emitters || []).flatMap(x => { const id = idOf(x); return id != null && byId.has(id) ? [byId.get(id)] : byName.get(nameOf(x)) || [] })
    const selectorsFor = Array.isArray(e.selectorIds) ? (() => { const l = fromIds(e.selectorIds); return () => l })()
      : (a) => (e.selectors || []).map(x => lookup(idOf(x), nameOf(x), a))
    for (const a of emitters) {
      for (const b of selectorsFor(a)) {
        if (!b) continue
        const key = `${a.id}\u0000${b.id}\u0000${type}`
        if (seenEv.has(key)) continue
        seenEv.add(key)
        eventEdges.push({ from: a.id, to: b.id, type })
      }
    }
  }

  // context: a read is served by the nearest ancestor that provides the field
  const contextEdges = []
  const orphanReads = []
  for (const c of comps) {
    for (const field of c.contextConsumes) {
      let provider = null
      const seen = new Set()
      let frontier = [...parentsOf.get(c.id)]
      while (frontier.length && !provider) {
        const next = []
        for (const p of frontier) {
          if (seen.has(p)) continue
          seen.add(p)
          const pc = byId.get(p)
          if (pc.contextProvides.includes(field)) { provider = pc; break }
          next.push(...parentsOf.get(p))
        }
        frontier = next
      }
      if (provider) {
        const ex = contextEdges.find(x => x.from === provider.id && x.to === c.id)
        if (ex) ex.fields.push(field); else contextEdges.push({ from: provider.id, to: c.id, fields: [field] })
      } else orphanReads.push({ id: c.id, field })
    }
  }

  // PARENT: a child's PARENT sink reaches the parent's intent through CHILD.select(Child) (childSelects)
  const parentEdges = []
  for (const c of comps) {
    for (const s of c.childSelects || []) {
      const ch = lookup(s.id, s.child, c)
      if (!ch || ch.ghost) continue
      parentEdges.push({ from: ch.id, to: c.id, actions: s.actions || [], ...(s.line != null ? { line: s.line } : {}) })
    }
  }

  const diagnostics = [
    ...comps.flatMap(c => c.diagnostics.map(d => ({ ...d, compId: c.id }))),
    ...(graph.diagnostics || []).map(d => ({ ...d, compId: lookup(d.componentId, d.component)?.id ?? null })),
  ]

  const byKey = new Map()
  for (const c of comps) if (!byKey.has(c.key)) byKey.set(c.key, c.id)
  return { graph, comps, byId, byKey, byName, parentsOf, childrenOf, renderEdges, eventEdges, contextEdges, parentEdges, orphanReads, ghosts: [...ghosts.values()], diagnostics, resolve, events }
}

export function worst(c) {
  return c.diagnostics.some(d => d.severity === 'error') ? 'error' : c.diagnostics.some(d => d.severity === 'warn') ? 'warn' : null
}

/** Every ancestor of `id` through render edges. */
export function ancestors(model, id) {
  const out = new Set()
  const stack = [...(model.parentsOf.get(id) || [])]
  while (stack.length) { const p = stack.pop(); if (out.has(p)) continue; out.add(p); stack.push(...model.parentsOf.get(p)) }
  return out
}

export function healthList(model, codeTitles = {}) {
  const { comps, diagnostics, events, byId, parentsOf, resolve, orphanReads, ghosts } = model
  const out = []
  const add = (group, tone, items, code) => { if (items.length) out.push(code ? { group, tone, code, items } : { group, tone, items }) }
  const codes = new Set(diagnostics.map(d => d.code))
  const byCode = new Map()
  const ranked = diagnostics.filter(d => d.severity !== 'info').map((d, i) => [d, i])
    .sort(([x, i], [y, j]) => (x.severity === 'error' ? 0 : 1) - (y.severity === 'error' ? 0 : 1) || i - j)
  for (const [d] of ranked) { if (!byCode.has(d.code)) byCode.set(d.code, []); byCode.get(d.code).push(d) }
  for (const [code, list] of byCode) {
    const title = codeTitles[code]
    add(title ? `${code} ${title}` : code, list[0].severity === 'error' ? 'err' : 'warn',
      list.map(d => ({ id: d.compId, title: d.compId ? byId.get(d.compId).name : (d.file ?? 'app'), sub: d.message })), code)
  }
  const real = comps.filter(c => !c.ghost)
  const resolveFirst = (x) => x == null ? null : resolve(nameOf(x))?.id ?? null
  // the derived checks, each only where no diagnostic already says it
  if (!codes.has('SYG102')) {
    add('Actions nothing triggers', 'err', real.flatMap(c => c.actions.filter(a => a.trigger === 'unknown' && !a.behavior)
      .map(a => ({ id: c.id, title: a.name, sub: `${c.name} · model entry with no intent, reply, next() or agent trigger` }))))
  }
  if (!codes.has('SYG110') && !codes.has('SYG104')) {
    add('Selectors not in the view', 'err', real.flatMap(c => c.selectors.filter(s => s.matched === false)
      .map(s => ({ id: c.id, title: s.control ?? s.selector, sub: `${c.name} · ${s.isolationHit ? `matches inside child <${s.isolationHit}>` : 'the view never renders it'}` }))))
  }
  const evs = Object.entries(events)
  if (!codes.has('SYG105')) {
    add('Events nobody selects', 'warn', evs.filter(([, e]) => !(e.selectors || []).length && (e.emitters || []).length)
      .map(([t, e]) => ({ id: (e.emitterIds || []).find(x => byId.has(x)) ?? resolveFirst(e.emitters[0]), event: t, title: t, sub: `emitted by ${e.emitters.map(nameOf).join(', ')}` })))
    add('Events nobody emits', 'warn', evs.filter(([, e]) => !(e.emitters || []).length && (e.selectors || []).length)
      .map(([t, e]) => ({ id: (e.selectorIds || []).find(x => byId.has(x)) ?? resolveFirst(e.selectors[0]), event: t, title: t, sub: `selected by ${e.selectors.map(nameOf).join(', ')}` })))
  }
  add('Controls nothing listens to', 'warn', real.flatMap(c => (c.controls || []).filter(x => x.listened === false)
    .map(x => ({ id: c.id, title: x.name, sub: `${c.name} · <${x.element ?? '?'}>` }))))
  add('Context read with no provider', 'warn', orphanReads.map(o => ({ id: o.id, title: `context.${o.field}`, sub: `${byId.get(o.id).name} · no scanned ancestor provides it` })))
  add('Rendered but not scanned', 'muted', ghosts.filter(g => !g.external && !g.widget).map(g => ({ id: g.id, title: g.name, sub: `rendered by ${parentsOf.get(g.id).map(id => byId.get(id).name).join(', ')}` })))
  add('AI agent surface', 'ai', real.filter(c => c.agent).map(c => {
    const acts = c.agent.actions || []
    const ask = acts.filter(a => a.consequential).map(a => a.name)
    return { id: c.id, title: `${c.agent.tools ?? c.name}${c.agent.read ? ' (read)' : ''}`, sub: `${c.name} · ${acts.length} action${acts.length === 1 ? '' : 's'}${ask.length ? `, ${ask.join(', ')} ask first` : ''}` }
  }))
  return out
}

export function searchText(c) {
  return [
    c.name, c.file, ...c.actions.map(a => a.name), ...c.stateKeys, ...c.calculated, ...c.contextProvides,
    ...c.contextConsumes, ...c.eventsEmitted, ...c.eventsSelected, ...c.selectors.map(s => s.selector),
    ...(c.controls || []).map(x => x.name), ...c.diagnostics.map(d => d.code),
  ].filter(Boolean).join('\n').toLowerCase()
}
