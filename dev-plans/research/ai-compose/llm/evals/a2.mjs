// Adapter: a2-params-edits' param cases and edit cases on the OPS / SHOP catalogs (read-only import).
// The records (PM) cases are left out: parts from records are a2's topic.
const A2 = new URL('../../a2-params-edits/evals/', import.meta.url)
const ROW = { id: 'row', description: 'Row: shows its parts side by side, left to right', container: { direction: 'row', slots: { default: { min: 2, max: 4, accepts: 'leaves' } } } }

export function toCatalog(c) {
  return {
    root: 'page', maxDepth: 2, name: c.id,
    parts: [...c.parts.map((p) => ({ id: p.id, description: p.description, ...(p.params && { params: Object.fromEntries(Object.entries(p.params).map(([n, d]) => [n, { description: d.label, options: d.options, default: d.default }])) }) })), ROW],
  }
}
const item = (b) => typeof b === 'string' ? b : Array.isArray(b) ? `row(${b.map(item).join(',')})` : `${b.part}${b.params ? `{${Object.entries(b.params).map(([k, v]) => `${k}=${v}`).join(',')}}` : ''}`
export const blocksToString = (list) => list.map(item).join(' ')

export async function loadA2(which) {
  const { PARAM_CASES, EDIT_CASES } = await import(new URL('cases.mjs', A2))
  const cache = new Map()
  const cat = (c) => { if (!cache.has(c)) cache.set(c, toCatalog(c)); return cache.get(c) }
  if (which === 'params') return PARAM_CASES.map(([c, prompt, want], i) => ({ id: `a2-params-${i + 1}`, catalog: cat(c), prompt, want: blocksToString(want) }))
  return EDIT_CASES.filter(([, , , want]) => want).map(([c, prev, prompt, want], i) => ({ id: `a2-edit-${i + 1}`, catalog: cat(c), prev: blocksToString(prev), prompt, want: blocksToString(want) }))
}
