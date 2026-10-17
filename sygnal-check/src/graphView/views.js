/**
 * The page's views that are not the drawing (PLAN-10 V-4, D536): the search results list, the
 * outline (the sidebar's directory tree) and the EVENTS table. Pure data; page.js turns it into DOM.
 *
 *   searchResults(model, q, opts?) → { comps: [{ id, name, why, where, score }], events: [{ type, why }], count }
 *     every component whose search text has `q` (ranked: the exact name, a name prefix, a name
 *     part, then anything else, with *why* it matched: 'emits NAVIGATE', 'action ADD', 'state cart',
 *     'reads currency', 'code SYG110', 'file'); the event types whose name has `q` (up to 8)
 *     opts: { hay?: Map id → searchText (the page's cache), limit? (40) }
 *   where(model, comp) → the directory that tells same-named components apart ('' when the name is
 *     unique; a trailing components/ skipped)
 *   dirTree(model, groupOf?) → the outline: { path, name, dirs: [node], comps: [id], group?, count }
 *     directories nested by path segment (a directory with no components and one subdirectory is
 *     merged into it: 'src/features'); components sorted entry first, then by name; ghosts under
 *     '(not scanned)', package components under their package; `group`: the directory group key
 *     (groups.js) the node stands for, so the outline and the drawing fold together
 *   eventsTable(model, { q?, sort? }) → [{ type, emitters: [id], selectors: [id] }]
 *     one row per EVENTS type; `q` matches the type or a component name; sort 'type' (default),
 *     'emitters' or 'selectors' (most first)
 *
 * Pure: no DOM, no imports (html.js inlines it; see model.js).
 */

const lc = (s) => String(s ?? '').toLowerCase()

function whyMatch(c, q) {
  const lists = [
    ['emits', c.eventsEmitted], ['selects', c.eventsSelected], ['action', c.actions.map(a => a.name)],
    ['state', [...c.stateKeys, ...(c.calculated || [])]], ['reads', c.contextConsumes], ['provides', c.contextProvides],
    ['selector', c.selectors.map(s => s.selector)], ['control', (c.controls || []).map(x => x.name)], ['code', c.diagnostics.map(d => d.code)],
  ]
  for (const [label, list] of lists) { const hit = (list || []).find(x => lc(x).includes(q)); if (hit) return `${label} ${hit}` }
  return lc(c.file).includes(q) ? 'file' : ''
}

export function where(model, c) {
  if (!c || c.ghost || (model.byName.get(c.name)?.length ?? 0) < 2) return ''
  const p = (c.dir || '').split('/')
  if (p.length > 1 && p[p.length - 1] === 'components') p.pop()
  return p.slice(-2).join('/')
}

export function searchResults(model, query, opts = {}) {
  const q = lc(query).trim()
  if (!q) return { comps: [], events: [], count: 0 }
  const hay = opts.hay
  const text = (c) => hay?.get(c.id) ?? [c.name, c.file, ...c.actions.map(a => a.name), ...c.stateKeys, ...c.contextConsumes, ...c.eventsEmitted, ...c.eventsSelected].join('\n').toLowerCase()
  const hits = model.comps.filter(c => text(c).includes(q))
  const comps = hits.map(c => {
    const n = lc(c.name)
    const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3
    return { id: c.id, name: c.name, why: score < 3 ? '' : whyMatch(c, q), where: where(model, c) || (c.ghost ? (c.external ?? 'not scanned') : c.dir), score }
  }).sort((a, b) => a.score - b.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const events = Object.keys(model.events || {}).filter(t => lc(t).includes(q)).sort().slice(0, 8).map(type => {
    const e = model.events[type]
    return { type, why: `EVENTS · ${(e.emitters || []).length} → ${(e.selectors || []).length}` }
  })
  return { comps: comps.slice(0, opts.limit ?? 40), events, count: hits.length }
}

export function dirTree(model, groupOf) {
  const root = { path: '', name: '', dirs: [], comps: [], count: 0 }
  const node = (parent, seg) => {
    let n = parent.dirs.find(d => d.name === seg)
    if (!n) parent.dirs.push(n = { path: parent.path ? parent.path + '/' + seg : seg, name: seg, dirs: [], comps: [], count: 0, chain: [] })
    return n
  }
  const groupPaths = new Set(groupOf ? groupOf.values() : [])
  for (const c of model.comps) {
    const d = c.external ? c.external : c.ghost ? '(not scanned)' : model.runtime ? (c.dir || '.') : (c.dir || '.')
    // runtime apps and package names are one segment; files' directories nest
    const parts = c.external || c.ghost || model.runtime ? [d] : d.split('/')
    let n = root
    for (const s of parts) { n = node(n, s); n.count++ }
    n.comps.push(c.id)
  }
  const byName = (a, b) => a < b ? -1 : a > b ? 1 : 0
  const sortComps = (ids) => ids.sort((a, b) => {
    const x = model.byId.get(a), y = model.byId.get(b)
    return Number(y.entry === true) - Number(x.entry === true) || byName(x.name, y.name) || byName(a, b)
  })
  const finish = (n) => {
    // merge a directory with no components and one subdirectory into it
    while (n !== root && !n.comps.length && n.dirs.length === 1) {
      const only = n.dirs[0]
      n.chain = [...(n.chain || []), n.path]
      n.name = n.name + '/' + only.name
      n.path = only.path
      n.comps = only.comps
      n.dirs = only.dirs
    }
    const all = [...(n.chain || []), n.path]
    const g = all.find(p => groupPaths.has(p))
    if (g != null && n !== root) n.group = g
    delete n.chain
    sortComps(n.comps)
    n.dirs.sort((a, b) => Number(a.name.startsWith('(')) - Number(b.name.startsWith('(')) || byName(a.name, b.name))
    n.dirs.forEach(finish)
    return n
  }
  return finish(root)
}

export function eventsTable(model, opts = {}) {
  const q = lc(opts.q).trim()
  const ids = (list, names) => {
    if (Array.isArray(list)) return [...new Set(list.filter(id => model.byId.has(id)))]
    const out = []
    for (const x of names || []) for (const c of model.byName.get(typeof x === 'string' ? x : x?.name) || []) if (!out.includes(c.id)) out.push(c.id)
    return out
  }
  const name = (id) => lc(model.byId.get(id).name)
  let rows = Object.entries(model.events || {}).map(([type, e]) => ({ type, emitters: ids(e.emitterIds, e.emitters), selectors: ids(e.selectorIds, e.selectors) }))
  if (q) rows = rows.filter(r => lc(r.type).includes(q) || [...r.emitters, ...r.selectors].some(id => name(id).includes(q)))
  const s = opts.sort
  return rows.sort((a, b) => (s === 'emitters' ? b.emitters.length - a.emitters.length : s === 'selectors' ? b.selectors.length - a.selectors.length : 0) || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
}
