// PLAN-5 4-D: an automatic failure category for a failed trial that nobody classified yet
// (run.md step 5 is manual; `failureCategory` was null in all 335 PLAN-5 records). Used by
// analyze.mjs (per-trial `failureAuto`) and its report. Unit-tested in tests/failure.unit.mjs.
//
// A manual category (score.mjs --classify) always wins. Otherwise the category comes from the
// sygnal-check diagnostics (warn/error) left in the trial's final src, mapped to run.md's
// categories; a failed trial without such a finding is 'other' (a misread spec, a text mismatch,
// a hand-rolled feature that is wrong: the common case, by the PLAN-5 analysis). It is a
// suggestion for the report, never written back to results/<run>.json.

/** run.md step 5 categories by the diagnostics that point at them (first match wins). */
export const AUTO_RULES = [
  ['isolation', ['SYG104']],
  ['wiring', ['SYG101', 'SYG102', 'SYG105', 'SYG110', 'SYG124', 'SYG401', 'SYG410', 'SYG643']],
  ['reducer-shape', ['SYG202', 'SYG221', 'SYG222']],
  ['stream-operator', ['SYG301']],
]

/**
 * @param scored  { pass, failureCategory } (analyze.mjs's rec.scored) or null
 * @param check   a sygnal-check result ({ diagnostics: [{ code, severity }] }) or null
 * @returns null (not scored, or passed) | { category, source: 'manual' | 'final-code' | 'none-found', codes }
 */
export function autoFailureCategory(scored, check) {
  if (!scored || scored.pass !== false) return null
  if (scored.failureCategory && scored.failureCategory !== 'none') return { category: scored.failureCategory, source: 'manual', codes: [] }
  const codes = [...new Set((check?.diagnostics ?? []).filter((d) => d.severity !== 'info').map((d) => d.code))].sort()
  for (const [category, list] of AUTO_RULES) {
    const hit = codes.filter((c) => list.includes(c))
    if (hit.length) return { category, source: 'final-code', codes: hit }
  }
  return { category: 'other', source: 'none-found', codes: [] }
}
