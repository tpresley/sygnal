// Wiring-class measures for the PLAN-4 1-E controls A/B (dev-plans/PLAN-4.md §7: "wiring-class
// failures = SYG104/110/124 hits and hidden-test failures caused by wiring"). Used by analyze.mjs
// (per-trial `wiring`), lib/matched.mjs (metrics wiringHits, wiringFailure) and wiring.mjs.
// Unit-tested in analysis/tests/wiring.unit.mjs.
//
// - hits: diagnostics the agent ran into while working. A Bash result counts when it shows a
//   SYG104/110/124 diagnostic as the tools print it: the runtime's `[Sygnal SYG104]` or a
//   sygnal-check finding line (`src/App.jsx:12:5 SYG110 ...`). Reads of the skill, docs or
//   explanations (which mention the codes) don't count, and neither does `sygnal-check explain`.
// - finalCodes: the codes sygnal-check reports (warn or error) on the trial's final src.
// - failure: the trial failed its hidden tests because of wiring: its failure category is
//   `wiring` or `isolation` (run.md step 5), or, when it has none yet, its final code still
//   has a SYG104/110/124 finding. null for a trial that isn't scored.

export const WIRING_CODES = ['SYG104', 'SYG110', 'SYG124']
export const WIRING_CATEGORIES = ['wiring', 'isolation']

const RUNTIME = /\[Sygnal (SYG\d{3})\]/g
const CHECKER = /^\S+:\d+:\d+ (SYG\d{3})\b/gm

/** Wiring codes a tool result shows as emitted diagnostics: { SYG104: n, ... } (n = occurrences). */
export function diagnosticCodes(text, codes = WIRING_CODES) {
  const out = {}
  for (const re of [RUNTIME, CHECKER]) {
    for (const m of String(text ?? '').matchAll(re)) if (codes.includes(m[1])) out[m[1]] = (out[m[1]] ?? 0) + 1
  }
  return out
}

/** Hits over a parsed transcript's calls (lib/parse.mjs): { calls, byCode }. */
export function wiringHits(calls, codes = WIRING_CODES) {
  const byCode = Object.fromEntries(codes.map((c) => [c, 0]))
  let n = 0
  for (const c of calls ?? []) {
    if (c.name !== 'Bash' || !c.result?.text) continue
    if (/sygnal-check(\.js)?\s+explain\b/.test(c.input?.command ?? '')) continue
    const found = diagnosticCodes(c.result.text, codes)
    if (!Object.keys(found).length) continue
    n++
    for (const [k, v] of Object.entries(found)) byCode[k] += v
  }
  return { calls: n, byCode }
}

/** Wiring codes (warn/error) in a sygnal-check result ({ diagnostics: [{ code, severity }] }). */
export function finalWiringCodes(check, codes = WIRING_CODES) {
  return [...new Set((check?.diagnostics ?? []).filter((d) => codes.includes(d.code) && d.severity !== 'info').map((d) => d.code))].sort()
}

/**
 * Whether a scored trial failed because of wiring (see the header). `scored`: { pass,
 * failureCategory }; returns { failure: boolean|null, source: 'category'|'final-code'|null }.
 */
export function wiringFailure(scored, finalCodes = []) {
  if (!scored || scored.pass == null) return { failure: null, source: null }
  if (scored.pass) return { failure: false, source: null }
  const cat = scored.failureCategory
  if (cat && cat !== 'none') return { failure: WIRING_CATEGORIES.includes(cat), source: 'category' }
  return finalCodes.length ? { failure: true, source: 'final-code' } : { failure: false, source: null }
}

/** The per-trial record analyze.mjs stores as `wiring`. */
export function wiringStats({ calls, scored, check }) {
  const hits = wiringHits(calls)
  const finalCodes = finalWiringCodes(check)
  const f = wiringFailure(scored, finalCodes)
  return { hitCalls: hits.calls, hitsByCode: hits.byCode, finalCodes, failure: f.failure, failureSource: f.source, finalChecked: !!check && !check.error }
}
