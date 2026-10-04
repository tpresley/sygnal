// PLAN-4 4-E measures (dev-plans/PLAN-4.md §7). Used by analyze.mjs (per-trial `testWindow`,
// `a11yFinal`, `usedActionLog`) and lib/matched.mjs (metrics testWindow, testAuthoring, testLearn, usedTestingLibrary,
// a11yFinal, usedActionLog). Unit-tested in analysis/tests/finalmeasures.unit.mjs.
//
// - testWindow: seconds from the agent's first write to a test file to the end of the transcript
//   (the GS-14 A/B's "test-authoring time" as wall time: writing, running and fixing the test, plus
//   whatever app fixes the test led to). null when the trial never wrote a test.
// - a11yFinal: SYG7xx findings (the accessibility lane) that sygnal-check reports on the trial's
//   final src; null when sygnal-check didn't run. The 4-E bar "0 SYG7xx warnings in Opus final code
//   on task 29" reads it.

/**
 * @param testWrites  parsed calls (lib/parse.mjs) that wrote a test file, each with `ts` (ms)
 * @param lastTs      the transcript's last timestamp (ms)
 */
export function testWindowSeconds(testWrites, lastTs) {
  const ts = (testWrites ?? []).map((c) => c?.ts).filter((x) => typeof x === 'number' && !Number.isNaN(x))
  if (!ts.length || typeof lastTs !== 'number') return null
  return Math.max(0, Math.round((lastTs - Math.min(...ts)) / 100) / 10)
}

export const A11Y_CODE = /^SYG7\d\d$/

/** SYG7xx findings in a runSygnalCheck() result ({ diagnostics, error }); null if it didn't run. */
export function a11yFinalCount(check) {
  if (!check || check.error || !Array.isArray(check.diagnostics)) return null
  return check.diagnostics.filter((d) => A11Y_CODE.test(d.code ?? '')).length
}

// D132: the skill's one-line pointer to `t.actions` / `t.inspect()` (GS-10, GS-15), measured in 4-E:
// did the agent use the action log or the wiring inspector in what it wrote or ran (Edit/Write
// inputs and Bash commands; reading the skill doesn't count)?
// The handle is `t` (as the docs name it) or any variable a renderComponent() call is assigned to.
const HANDLE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?renderComponent\s*[(<]/g
const escapeRe = (s) => s.replace(/[$]/g, '\\$&')

/** @param inputText the trial's edit and Bash tool inputs, as one string */
export function usedActionLog(inputText) {
  const s = String(inputText ?? '')
  const names = new Set(['t', ...[...s.matchAll(HANDLE)].map((m) => m[1])])
  const re = new RegExp(`(?<![\\w.$])(?:${[...names].map(escapeRe).join('|')})\\.(?:actions\\b|inspect\\(|explain\\()`)
  return re.test(s)
}
