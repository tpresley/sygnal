/**
 * Sygnal diagnostic code registry.
 *
 * Every diagnostic Sygnal reports has a stable code (`SYG123`), a default
 * severity, a short title, and a docs anchor (`docsSlug`) on
 * https://sygnal.js.org/reference/errors (base URL = the `site` field of
 * docs/astro.config.mjs).
 *
 * The registry is stored as two parallel tables so the published bundle only
 * carries what the runtime needs:
 *   - CODE_SEVERITY: code → default severity (used by report(); in the bundle)
 *   - CODE_TITLES:   code → title (docs/inspect/static-checker metadata; pure
 *                    object literal, tree-shaken unless something imports it)
 * getCodeInfo(code) / listCodes() assemble the full
 * { code, severity, title, docsSlug } records. To add a code, add it to BOTH
 * tables below (inside your reserved range), or call registerCodes() from a
 * workstream's own module. docsSlug is always the lower-cased code
 * ('SYG101' → https://sygnal.js.org/reference/errors#syg101).
 *
 * (Comments are attached to type-only declarations so the TypeScript emit
 * drops them — keeps them out of the published bundle and the size gate.)
 *
 * Severity:
 *   - 'error' — throws (or is rethrown, enriched) at the call site
 *   - 'warn'  — console + collected (when diagnostics mode is 'warn')
 *   - 'info'  — collected only; surfaced through inspect / test helpers
 *
 * Ranges (see dev-plans/PLAN-1.md §2):
 *   SYG1xx  Wiring: intent <-> model <-> view <-> events
 *   SYG2xx  State & reducers
 *   SYG3xx  Streams & intent construction (incl. xstream hints)
 *   SYG4xx  Collections, Switchable, sub-components, context
 *   SYG5xx  Strict mode / canonical-form violations
 *   SYG6xx  Drivers & run configuration
 *   SYG9xx  Internal invariants
 *
 * ---------------------------------------------------------------------------
 * RESERVED RANGES (PLAN-1 workstream allocation — add entries only inside the
 * range your workstream owns; changes outside go through the coordinator):
 *
 *   0B (diagnostics core)    SYG900                (check-failure invariant)
 *   1A (runtime checks)      SYG101-105, SYG110, SYG201, SYG202, SYG301,
 *                            SYG401 (pre-seeded below), plus SYG106-199
 *                            and SYG302-399 for new checks
 *   1E (message retrofit)    SYG206-299, SYG402-499, SYG601-699, SYG901-999
 *   2A (strict mode)         SYG500-599
 *   unallocated              SYG100, SYG200, SYG203-205, SYG300, SYG400,
 *                            SYG600 (coordinator assigns on request)
 * ---------------------------------------------------------------------------
 */
export type DiagnosticSeverity = 'error' | 'warn' | 'info'

export interface DiagnosticCodeInfo {
  code: string
  severity: DiagnosticSeverity
  title: string
  // anchor on the errors reference page, e.g. 'syg101' → /reference/errors#syg101
  docsSlug: string
}

export const DOCS_BASE_URL = 'https://sygnal.js.org'

export const CODE_SEVERITY: Record<string, DiagnosticSeverity> = {
  SYG101: 'warn',
  SYG102: 'info',
  SYG103: 'info',
  SYG104: 'warn',
  SYG105: 'info',
  SYG106: 'warn',
  SYG110: 'warn',
  SYG201: 'warn',
  SYG202: 'warn',
  SYG301: 'error',
  SYG401: 'warn',
  SYG900: 'warn',
}

export const CODE_TITLES: Record<string, string> = {
  // SYG1xx wiring (1A)
  SYG101: 'Intent action has no model entry',
  SYG102: 'Model entry is unreachable',
  SYG103: 'Intent selector matched no rendered element',
  SYG104: 'Intent selector crosses an isolation boundary',
  SYG105: 'EVENTS type selected but never emitted, or emitted but never selected',
  SYG106: 'Parent prop is overwritten by a reserved view argument',
  SYG110: 'Intent selector not present in the component view',
  // SYG2xx state & reducers (1A)
  SYG201: 'STATE reducer dropped keys from the previous state',
  SYG202: 'STATE reducer returned undefined',
  // SYG3xx streams & intent construction (1A)
  SYG301: 'RxJS operator used on an xstream stream',
  // SYG4xx collections / switchable / sub-components / context (1A)
  SYG401: "Collection 'from' field is missing or not an array",
  // SYG9xx internal (0B)
  SYG900: 'A diagnostics check threw',
}

export function getCodeInfo(code: string): DiagnosticCodeInfo | undefined {
  const severity = CODE_SEVERITY[code]
  return severity && { code, severity, title: CODE_TITLES[code] || '', docsSlug: code.toLowerCase() }
}

export function listCodes(): DiagnosticCodeInfo[] {
  return Object.keys(CODE_SEVERITY).map(c => getCodeInfo(c)!)
}

export function registerCodes(entries: Array<[string, DiagnosticSeverity, string]>): void {
  for (const [code, severity, title] of entries) {
    CODE_SEVERITY[code] = severity
    CODE_TITLES[code] = title
  }
}

export function docsUrlFor(code: string): string {
  return `${DOCS_BASE_URL}/reference/errors#${code.toLowerCase()}`
}
