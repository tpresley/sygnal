// Scoring shared by the Ollama runner and the frontier scorer.
import { normalizeCatalog, stringToLayout, layoutToTree, repairTree, treeToLayout, layoutToString } from '../llm-composer.mjs'

/** a layout with text params removed (exact match compares structure + enum params) */
export function enumOnly(catalog, layout) {
  const c = normalizeCatalog(catalog)
  const L = structuredClone(layout)
  for (const n of Object.values(L.nodes)) {
    if (!n.params) continue
    for (const k of Object.keys(n.params)) if (!c.byId[n.part]?.params?.[k]?.options) delete n.params[k]
    if (!Object.keys(n.params).length) delete n.params
  }
  return L
}

/** the expected string → canonical string (defaults filled, text params dropped) */
export function canonicalWant(catalog, want) {
  const t = layoutToTree(stringToLayout(want, normalizeCatalog(catalog).root))
  const { tree } = repairTree(catalog, t, [])
  return layoutToString(enumOnly(catalog, treeToLayout(tree)))
}

const leafParts = (catalog, layout) => {
  const c = normalizeCatalog(catalog)
  return Object.values(layout.nodes).filter((n) => !c.byId[n.part]?.container).map((n) => n.part)
}

/** one case → { exact, partErrors, structureError, paramErrors, textOk, keyKept } */
export function scoreCase(catalog, kase, layout, { prev } = {}) {
  const want = canonicalWant(catalog, kase.want)
  const gotS = layoutToString(enumOnly(catalog, layout))
  const wantL = stringToLayout(want, normalizeCatalog(catalog).root)
  const W = leafParts(catalog, wantL), G = leafParts(catalog, layout)
  const partErrors = W.filter((p) => !G.includes(p)).length + G.filter((p) => !W.includes(p)).length
  // params on matching parts
  let paramErrors = 0
  const wantNodes = Object.values(wantL.nodes)
  for (const n of Object.values(layout.nodes)) {
    const w = wantNodes.find((x) => x.part === n.part)
    if (!w) continue
    for (const k of Object.keys(w.params || {})) if (String(w.params[k]) !== String(n.params?.[k])) paramErrors++
  }
  const exact = gotS === want
  const structureError = !exact && partErrors === 0 && paramErrors === 0
  let textOk = null
  if (kase.text) {
    textOk = Object.entries(kase.text).every(([path, needle]) => {
      const [part, param] = path.split('.')
      const n = Object.values(layout.nodes).find((x) => x.part === part)
      return typeof n?.params?.[param] === 'string' && n.params[param].toLowerCase().includes(needle)
    })
  }
  let keyKept = null
  if (prev) {
    // every leaf part in both the previous layout and the expected one keeps its key
    const prevByPart = Object.fromEntries(Object.entries(prev.nodes).filter(([, n]) => !normalizeCatalog(catalog).byId[n.part]?.container).map(([k, n]) => [n.part, k]))
    const gotByPart = Object.fromEntries(Object.entries(layout.nodes).map(([k, n]) => [n.part, k]))
    const shared = W.filter((p) => prevByPart[p] && gotByPart[p])
    keyKept = shared.every((p) => prevByPart[p] === gotByPart[p])
  }
  return { exact, got: gotS, want, partErrors, structureError, paramErrors, textOk, keyKept }
}

export function summarize(rows) {
  const n = rows.length
  const ms = rows.map((r) => r.ms).filter((x) => x != null).sort((a, b) => a - b)
  const sum = (f) => rows.reduce((a, r) => a + (f(r) || 0), 0)
  const texts = rows.filter((r) => r.textOk !== null && r.textOk !== undefined)
  const keys = rows.filter((r) => r.keyKept !== null && r.keyKept !== undefined)
  return {
    n,
    exact: sum((r) => r.exact),
    partErrors: sum((r) => r.partErrors),
    structureErrors: sum((r) => r.structureError),
    paramErrors: sum((r) => r.paramErrors),
    invalid: sum((r) => r.invalid),
    repaired: sum((r) => r.issues?.length > 0),
    text: texts.length ? `${texts.filter((r) => r.textOk).length}/${texts.length}` : '-',
    keys: keys.length ? `${keys.filter((r) => r.keyKept).length}/${keys.length}` : '-',
    medianMs: ms.length ? ms[ms.length >> 1] : null,
    medianTokens: (() => { const t = rows.map((r) => r.tokens).filter((x) => x != null).sort((a, b) => a - b); return t.length ? t[t.length >> 1] : null })(),
  }
}

export function printTable(results) {
  const head = ['config', 'exact', 'part err', 'struct err', 'param err', 'invalid', 'repaired', 'text', 'keys', 'median ms', 'median out tokens']
  console.log(`| ${head.join(' | ')} |\n|${head.map(() => ' --- ').join('|')}|`)
  for (const [name, s] of results) console.log(`| ${name} | ${s.exact}/${s.n} | ${s.partErrors} | ${s.structureErrors} | ${s.paramErrors} | ${s.invalid} | ${s.repaired} | ${s.text} | ${s.keys} | ${s.medianMs ?? '-'} | ${s.medianTokens ?? '-'} |`)
}
