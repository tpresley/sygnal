/**
 * Diagnostic codes used by sygnal-check.
 *
 * The codes and titles are the same as the runtime registry in
 * ../../src/extra/diagnostics/codes.ts (CODE_TITLES). test/codes.vtest.js
 * reads that file and fails if a code here is missing there or has a
 * different title, so the two cannot drift.
 *
 * `severity` is the STATIC checker's default for the code, which can differ
 * from the runtime default: e.g. SYG102 is 'info' at runtime (next() targets
 * are only known at call time) but 'warn' here, where the checker can see
 * every next('X') literal. Rules may still report a lower severity for a
 * specific finding (e.g. SYG110 is 'info' when a dynamic className might
 * produce the class).
 */
export const DOCS_BASE_URL = 'https://sygnal.js.org'

export const CODES = {
  SYG101: { severity: 'warn', title: 'Intent action has no model entry' },
  SYG102: { severity: 'warn', title: 'Model entry is unreachable' },
  SYG104: { severity: 'warn', title: 'Intent selector crosses an isolation boundary' },
  SYG105: { severity: 'warn', title: 'EVENTS type selected but never emitted, or emitted but never selected' },
  SYG110: { severity: 'warn', title: 'Intent selector not present in the component view' },
  SYG111: { severity: 'warn', title: 'Controlled input has no input listener' },
  SYG401: { severity: 'warn', title: "Collection 'from' field is missing or not an array" },
  SYG900: { severity: 'warn', title: 'A diagnostics check threw' },
}

export function docsUrlFor(code) {
  return `${DOCS_BASE_URL}/reference/errors#${code.toLowerCase()}`
}

export function getCodeInfo(code) {
  const info = CODES[code]
  return info && { code, severity: info.severity, title: info.title, docsSlug: code.toLowerCase() }
}

export function listCodes() {
  return Object.keys(CODES).map(getCodeInfo)
}
