// PLAN-9 C (compose.llm) test helpers. `catalog()` is a STAND-IN for worker A's defineCatalog
// (src/extra/ai/compose/catalog.ts): just the normalized shape of the phase-1 contract that llm.ts
// reads (parts, containers with the built-in page and row, limits, guidance, examples, get). The
// coordinator swaps it for the real defineCatalog after merging.
//
// Also: the research catalogs (dev-plans/research/ai-compose/llm, structure, params-edits) in that
// shape, a compact layout notation for expectations, and a scorer.

const ROW = { description: 'Row: shows its parts side by side, left to right', slots: { default: null }, direction: 'row' }

/** the contract's normalized catalog (stand-in) */
export function catalog({ parts = {}, containers = {}, limits = {}, guidance, examples } = {}) {
  const c = {
    parts: Object.fromEntries(Object.entries(parts).map(([id, p]) => [id, { maxUses: 1, in: ['page'], params: {}, ...p }])),
    containers: { page: { slots: { default: null } }, row: ROW, ...containers },
    limits: { maxParts: 12, maxDepth: 4, ...limits },
    guidance,
    examples,
  }
  c.get = (id) => c.parts[id] || c.containers[id]
  return c
}

/** a research catalog (llm-composer.mjs declaration) → the contract shape */
export function fromResearch(rc) {
  const parts = {}, containers = {}
  const paramsOf = (p) => {
    const params = {}
    for (const [n, d] of Object.entries(p.params || {})) {
      if (d.options) params[n] = { options: d.options, default: d.default, label: d.description }
      else if (d.text) params[n] = { type: 'text', maxLength: d.text.maxLength, default: d.default, label: d.description }
    }
    return params
  }
  // the research has no `in`: every part may go in every (non-row) container
  const boxes = rc.parts.filter((p) => p.container && p.container.direction !== 'row').map((p) => p.id)
  for (const p of rc.parts) {
    if (p.container) {
      const d = p.container.slots.default || {}
      containers[p.id] = {
        description: p.description, slots: Object.fromEntries(Object.keys(p.container.slots).map((s) => [s, null])), direction: p.container.direction,
        params: paramsOf(p),
        // beyond the contract's Container (llm.ts reads them when present): slot limits, leaves only
        ...(p.container.direction !== 'row' && { min: d.min, max: d.max, accepts: d.accepts }),
      }
      continue
    }
    parts[p.id] = { description: p.description, params: paramsOf(p), in: ['page', ...boxes] }
  }
  // the research catalogs declare `row` themselves; keep their wording
  return catalog({ parts, containers, limits: { maxDepth: rc.maxDepth ?? 2 } })
}

/** 'row(a,b) c{range=quarter}' → contract Tree */
export function tree(s) {
  let i = 0
  const ws = () => { while (s[i] === ' ' || s[i] === ',') i++ }
  const ident = () => { const m = /^[A-Za-z0-9_:-]+/.exec(s.slice(i)); i += m[0].length; return m[0] }
  const node = () => {
    const n = { part: ident() }
    if (s[i] === '{') {
      const end = s.indexOf('}', i)
      n.params = Object.fromEntries(s.slice(i + 1, end).split(',').filter(Boolean).map((kv) => kv.split('=')))
      i = end + 1
    }
    if (s[i] === '(') {
      i++
      const kids = []
      while (s[i] !== ')') { ws(); kids.push(node()); ws() }
      i++
      n.children = kids
    }
    return n
  }
  const kids = []
  ws()
  while (i < s.length) { kids.push(node()); ws() }
  return kids
}

/** a layout → the compact notation (page children; params as stored: non-default only, text params dropped with `enumOnly`) */
export function str(cat, layout, { enumOnly = true } = {}) {
  if (!layout) return ''
  const go = (key) => {
    const n = layout.nodes[key]
    const def = cat.get(n.part)
    const ps = Object.entries(n.params || {}).filter(([k, v]) => (!enumOnly || def?.params?.[k]?.options) && v !== def?.params?.[k]?.default)
    const p = ps.length ? `{${ps.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',')}}` : ''
    const kids = n.slots ? `(${Object.values(n.slots).flat().map(go).join(',')})` : ''
    return `${n.part}${p}${kids}`
  }
  return layout.nodes[layout.root].slots.default.map(go).join(' ')
}

/** the expected notation, canonical: params equal to their default dropped */
export function want(cat, s) {
  const go = (n) => {
    const def = cat.get(n.part)
    const ps = Object.entries(n.params || {}).filter(([k, v]) => def?.params?.[k]?.options && String(v) !== String(def.params[k].default))
    const p = ps.length ? `{${ps.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',')}}` : ''
    return `${n.part}${p}${n.children ? `(${n.children.map(go).join(',')})` : ''}`
  }
  return tree(s).map(go).join(' ')
}

const RESEARCH = new URL('../dev-plans/research/ai-compose/', import.meta.url)

/** the research sets the live check and the recorded-answer test use: base (11), a1-dashboard (15), a2-params (20) */
export async function researchSets() {
  const { BASE, BASE_CASES } = await import(new URL('llm/evals/cases.mjs', RESEARCH))
  const { CATALOGS } = await import(new URL('structure/evals/catalogs.mjs', RESEARCH))
  const { PARAM_CASES } = await import(new URL('params-edits/evals/cases.mjs', RESEARCH))
  const { toCatalog, blocksToString } = await import(new URL('llm/evals/a2.mjs', RESEARCH))
  const fromA1 = (s) => !s ? '' : s.replace(/^page\(/, '').replace(/\)$/, '').replace(/\(([^()]*)\)/g, (_, x) => `(${x.trim().split(/\s+/).join(',')})`)
  const ROWR = { id: 'row', description: 'Row: shows its parts side by side, left to right', container: { direction: 'row', slots: { default: { min: 2, max: 4, accepts: 'leaves' } } } }
  const d = CATALOGS.dashboard
  const dash = fromResearch({ root: 'page', maxDepth: 2, parts: [...d.parts.map(({ id, description }) => ({ id, description })), ROWR] })
  const base = fromResearch(BASE)
  const a2 = new Map()
  const a2cat = (c) => { if (!a2.has(c)) a2.set(c, fromResearch(toCatalog(c))); return a2.get(c) }
  return [
    { set: 'base', cases: BASE_CASES.map((k) => ({ id: k.id, prompt: k.prompt, want: k.want, catalog: base })) },
    { set: 'a1-dashboard', cases: d.cases.map(([prompt, w], i) => ({ id: `a1-dashboard-${i + 1}`, prompt, want: fromA1(w), catalog: dash })) },
    { set: 'a2-params', cases: PARAM_CASES.map(([c, prompt, w], i) => ({ id: `a2-params-${i + 1}`, prompt, want: blocksToString(w), catalog: a2cat(c) })) },
  ]
}

export const names = { ok: 'page.REPLY', error: 'page.FAILED', delta: 'page.DELTA', key: 'compose' }
