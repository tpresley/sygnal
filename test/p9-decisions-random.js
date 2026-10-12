// PLAN-9 compose.decisions(): seeded random targets over a catalog (shared by the round-trip and edit suites).
import { llmOnly } from '../src/extra/ai/compose/decisions.js'

// ---------- seeded random targets ----------
export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const pickOne = (r, list) => list[Math.floor(r() * list.length)]
export const shuffle = (r, list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
export const slotsOf = (catalog, id) => Object.keys(catalog.containers[id]?.slots || { default: null })
export function places(catalog, def) {
  const out = []
  for (const d of def.in || ['page']) {
    if (d === 'page') out.push('page:default')
    else if (d.includes(':')) out.push(d)
    else if (catalog.containers[d]) for (const s of slotsOf(catalog, d)) out.push(`${d}:${s}`)
  }
  return out
}
export const recordParam = (part) => Object.keys(part.params || {}).find((k) => part.params[k].from)

/**
 * A random target the encoding can express: parts from the selectable ones (one per group), records,
 * copies, enum / number params, places from `in`, random order, rows of 2–3 leaves in a
 * non-arranged slot (no pinned parts, no copies). Returns { target, prompt }.
 */
export function randomTarget(catalog, r, { maxLeaves = 6 } = {}) {
  const ids = Object.keys(catalog.parts).filter((id) => !catalog.parts[id].required && !llmOnly(catalog.parts[id]))
  const chosen = []
  const groups = new Set()
  const recordNames = []
  for (const id of shuffle(r, ids).slice(0, 1 + Math.floor(r() * maxLeaves))) {
    const part = catalog.parts[id]
    if (part.group != null) { if (groups.has(part.group)) continue; groups.add(part.group) }
    const params = {}
    for (const [k, p] of Object.entries(part.params || {})) {
      if (p.from || r() < 0.5) continue
      const keys = Object.keys(p.type === 'number' ? p.bins : p.options || {})
      if (!keys.length) continue
      const v = pickOne(r, keys)
      params[k] = p.type === 'number' ? Number(v) : v
    }
    const rp = recordParam(part)
    if (rp) {
      const records = shuffle(r, part.params[rp].from({})).slice(0, 1 + Math.floor(r() * 3))
      for (const rec of records) { chosen.push({ part: id, params: { ...params, [rp]: rec.value } }); recordNames.push(rec.name) }
    } else {
      const n = part.maxUses > 1 ? 1 + Math.floor(r() * part.maxUses) : 1
      for (let i = 0; i < n; i++) chosen.push({ part: id, ...(Object.keys(params).length && { params }), copy: n > 1 })
    }
  }
  for (const p of Object.values(catalog.parts)) if (p.required) chosen.push({ part: p.id })
  for (const x of [...chosen]) for (const c of catalog.parts[x.part].companions || []) if (!chosen.some((y) => y.part === c)) chosen.push({ part: c })
  // places: each leaf picks one of its places; a container used picks its own (recursively)
  const slots = new Map([['page:default', []]])
  const placed = new Set()
  const placeContainer = (id) => {
    if (placed.has(id)) return
    placed.add(id)
    const where = pickOne(r, places(catalog, catalog.containers[id]).filter((d) => d.split(':')[0] !== id))
    if (where !== 'page:default') placeContainer(where.split(':')[0])
    if (!slots.has(where)) slots.set(where, [])
    slots.get(where).push({ container: id })
    for (const s of slotsOf(catalog, id)) if (!slots.has(`${id}:${s}`)) slots.set(`${id}:${s}`, [])
  }
  for (const x of chosen) {
    const def = catalog.parts[x.part]
    const where = def.pin || x.copy ? 'page:default' : pickOne(r, places(catalog, def))
    if (where !== 'page:default') placeContainer(where.split(':')[0])
    if (!slots.has(where)) slots.set(where, [])
    slots.get(where).push({ leaf: x })
  }
  const build = (where) => {
    const list = shuffle(r, slots.get(where) || [])
    const pin = (e) => (e.leaf && catalog.parts[e.leaf.part].pin) || null
    const ordered = [...list.filter((e) => pin(e) === 'start'), ...list.filter((e) => !pin(e)), ...list.filter((e) => pin(e) === 'end')]
    let nodes = ordered.map((e) => {
      if (e.leaf) { const { copy, ...n } = e.leaf; void copy; return { node: n, rowable: !pin(e) && !e.leaf.copy } }
      const k = slotsOf(catalog, e.container)
      const children = k.length === 1 && k[0] === 'default' ? build(`${e.container}:default`) : Object.fromEntries(k.map((s) => [s, build(`${e.container}:${s}`)]))
      return { node: { part: e.container, children } }
    })
    const [c] = where.split(':')
    if (catalog.containers.row && (c === 'page' || !catalog.containers[c].arranged) && r() < 0.6) {
      const free = nodes.filter((n) => n.rowable)
      while (free.length >= 2 && r() < 0.7) {
        const size = Math.min(free.length, 2 + Math.floor(r() * 2))
        const members = free.splice(0, size)
        const at = nodes.indexOf(members[0])
        nodes = nodes.filter((n) => !members.includes(n))
        nodes.splice(at, 0, { node: { part: 'row', children: members.map((m) => m.node) } })
      }
    }
    return nodes.map((n) => n.node)
  }
  return { target: build('page:default'), prompt: `Show ${recordNames.join(' and ') || 'the page'}` }
}
