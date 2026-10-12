// Adapter: a1-structure's page+row catalogs (dashboard, ops) → this runner's catalog + cases (read-only import).
const A1 = new URL('../../a1-structure/evals/catalogs.mjs', import.meta.url)
const ROW = { id: 'row', description: 'Row: shows its parts side by side, left to right', container: { direction: 'row', slots: { default: { min: 2, max: 4, accepts: 'leaves' } } } }

/** 'page(row(a b) c)' → 'row(a,b) c' */
export function fromA1(s) {
  if (!s) return ''
  const inner = s.replace(/^page\(/, '').replace(/\)$/, '')
  return inner.replace(/\(([^()]*)\)/g, (_, x) => `(${x.trim().split(/\s+/).join(',')})`)
}

export async function loadA1(id) {
  const { CATALOGS } = await import(A1)
  const c = CATALOGS[id]
  if (!c || c.parts.some((p) => p.slots || p.in || p.resource)) throw new Error(`a1 catalog ${id}: only page+row catalogs are adapted`)
  return {
    catalog: { root: 'page', maxDepth: 2, parts: [...c.parts.map(({ id, description }) => ({ id, description })), ...(c.rows ? [ROW] : [])] },
    cases: c.cases.map(([prompt, want], i) => ({ id: `a1-${id}-${i + 1}`, prompt, want: fromA1(want) })),
  }
}
