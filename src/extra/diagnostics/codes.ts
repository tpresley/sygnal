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
 * Severity (PLAN-2 1-B, G-044):
 *   - 'error' — the operation failed: thrown at the call site, or caught there
 *               (reducer, EFFECT, view, sub-component) and logged with
 *               console.error while the app keeps running
 *   - 'warn'  — likely mistake, behaviour continues: console + collected
 *               (when diagnostics mode is 'warn')
 *   - 'info'  — collected only; surfaced through inspect / test helpers
 *   A call site may report a lower severity than the default (SYG405 for
 *   Collection/Switchable children, SYG406 handled by onError: 'warn').
 *   Every code surfaces under its own code: an error thrown by fail() and
 *   caught by a reducer/EFFECT/instantiation handler is reported under the
 *   thrown code (legacy.caught), not the handler's.
 *
 * Ranges (see dev-plans/PLAN-1.md §2):
 *   SYG1xx  Wiring: intent <-> model <-> view <-> events
 *   SYG2xx  State & reducers
 *   SYG3xx  Streams & intent construction (incl. xstream hints)
 *   SYG4xx  Collections, Switchable, sub-components, context
 *   SYG5xx  Strict mode / canonical-form violations
 *   SYG6xx  Drivers & run configuration
 *   SYG7xx  Accessibility (a11y; static only, sygnal-check, PLAN-4 GS-3)
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
  SYG111: 'warn',
  SYG201: 'warn',
  SYG202: 'warn',
  SYG301: 'error',
  SYG401: 'warn',
  SYG900: 'warn',
  // ---- 1E retrofit codes (SYG206-299, 402-499, 601-699, 901-999) ----
  SYG206: 'error',
  SYG207: 'warn',
  SYG208: 'warn',
  SYG209: 'error',
  SYG210: 'warn',
  SYG211: 'error',
  SYG212: 'error',
  SYG213: 'warn',
  SYG214: 'error',
  SYG215: 'error',
  SYG216: 'error',
  SYG217: 'warn',
  SYG218: 'error',
  SYG219: 'warn',
  SYG220: 'warn',
  SYG402: 'error',
  SYG403: 'error',
  SYG404: 'error',
  SYG405: 'error',
  SYG406: 'error',
  SYG407: 'error',
  SYG408: 'error',
  SYG409: 'warn',
  SYG410: 'error',
  SYG411: 'error',
  SYG412: 'error',
  SYG413: 'error',
  SYG414: 'error',
  SYG415: 'error',
  SYG416: 'error',
  SYG417: 'warn',
  SYG418: 'error',
  SYG419: 'error',
  SYG420: 'error',
  SYG601: 'error',
  SYG602: 'error',
  SYG603: 'error',
  SYG604: 'error',
  SYG605: 'error',
  SYG606: 'error',
  SYG607: 'error',
  SYG608: 'warn',
  SYG609: 'warn',
  SYG610: 'error',
  SYG901: 'error',
  SYG902: 'error',
  SYG903: 'error',
  // ---- end 1E retrofit codes ----
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
  SYG111: 'Controlled input has no input listener',
  SYG115: 'Unknown DOM event shorthand',
  SYG116: 'EVENTS value has no string type',
  SYG124: 'Component used as a control or selector',
  SYG125: 'Control given .intent, .model or .initialState',
  SYG126: 'Control rendered but never listened to',
  SYG127: 'Behavior collision or unresolvable uses entry',
  SYG128: 'Duplicate control key',
  SYG112: 'Reply action has no model entry',
  SYG130: 'href() names no route or leaves out a param',
  SYG131: 'Route params the pattern does not use',
  SYG132: 'Declaration static that is never sent',
  SYG133: 'SPA router inside a Vike app',
  // SYG2xx state & reducers (1A)
  SYG201: 'STATE reducer dropped keys from the previous state',
  SYG202: 'STATE reducer returned undefined',
  // SYG3xx streams & intent construction (1A)
  SYG301: 'RxJS operator used on an xstream stream',
  // SYG4xx collections / switchable / sub-components / context (1A)
  SYG401: "Collection 'from' field is missing or not an array",
  // SYG5xx strict mode / canonical forms (2A; dev-plans/PLAN-1-canonical-forms.md)
  SYG501: 'View uses positional arguments',
  SYG502: 'Retired in 6.0: STATE reducer signals no change without ABORT',
  SYG503: 'Side effect in a STATE reducer that returns ABORT',
  SYG504: "'ACTION | SINK' shorthand model key",
  SYG505: 'Non-canonical EVENTS emit',
  SYG506: 'CHILD.select() with a string component name',
  SYG507: 'Prop drilled through more than 2 component levels',
  SYG508: 'select()/errors() round trip where reply actions would do',
  // SYG9xx internal (0B)
  SYG900: 'A diagnostics check threw',
  // ---- 1E retrofit codes (SYG206-299, 402-499, 601-699, 901-999) ----
  SYG206: 'Invalid calculated field definition',
  SYG207: 'Calculated field shadows an initialState key',
  SYG208: 'Calculated field depends on an unknown key',
  SYG209: 'Circular calculated field dependency',
  SYG210: 'INITIALIZE used with a sink other than STATE',
  SYG211: 'Invalid model shorthand entry',
  SYG212: 'Model entry is not a function or an object of sinks',
  SYG213: 'Duplicate model entry for the same action and sink',
  SYG214: 'EFFECT handler threw',
  SYG215: 'next() delay is not a number',
  SYG216: 'Reducer threw',
  SYG217: 'Driver-sink reducer returned undefined',
  SYG218: 'Reducer returned an unsupported type',
  SYG219: 'EFFECT handler returned a value',
  SYG220: 'Calculated field threw',
  SYG221: 'set() called with a string',
  SYG222: 'STATE reducer returned the same object after it was mutated in place',
  SYG223: 'persist pick or omit names a key that is not in initialState',
  SYG224: 'persist on a component that is not the root',
  SYG226: 'Undo track or resetOn names an unknown action',
  SYG402: 'Context is not an object',
  SYG403: 'Invalid context entry',
  SYG404: 'Context stream errored',
  SYG405: 'Sub-component has initialState without isolatedState',
  SYG406: 'View threw',
  SYG407: 'onError handler threw',
  SYG408: 'Sub-component failed to instantiate',
  SYG409: 'Child tried to update a calculated field',
  SYG410: "Invalid sub-component 'state' prop",
  SYG411: "Collection 'of' is missing or not a component",
  SYG412: "Invalid Collection 'from' prop",
  SYG413: 'Unnamed component factory not found',
  SYG414: 'Component not found',
  SYG415: "Switchable 'of' is missing or invalid",
  SYG416: "Switchable 'current' is missing or invalid",
  SYG417: 'Portal target not found',
  SYG418: 'Invalid Collection sort prop',
  SYG419: "Invalid switchable() 'name$' parameter",
  SYG420: 'JSX tag is undefined',
  SYG421: 'Invalid data (dataset) key',
  SYG422: 'Invalid timer spec',
  SYG601: 'Missing or invalid sources',
  SYG602: 'Intent is not a function',
  SYG603: 'Intent returned an invalid value',
  SYG604: 'Invalid hmrActions',
  SYG605: "Intent action name contains '|'",
  SYG606: 'calculated is not an object',
  SYG607: 'State source not found',
  SYG608: 'Strict mode requested without the diagnostics entry',
  SYG609: 'Sink or source has no driver',
  SYG610: "Request has a 'then' or 'catch' key",
  SYG611: 'Socket message not sent or connection not opened',
  SYG620: 'Router command not performed',
  // PLAN-3 5-3: makeFetchDriver's cache, invalidation and validation (dev entry; SYG634 static only)
  SYG630: 'Cached request is not idempotent',
  SYG631: 'validate is not a Standard Schema',
  SYG632: 'invalidate matched nothing',
  SYG633: 'abort names a lane the requests do not use',
  SYG634: 'latest: true with a computed key',
  // PLAN-3 5-5 (D88)
  SYG635: 'Caching asked for without a queryCache',
  // PLAN-4 GS-2: element commands (reported by the dev entry, checks/elementCommands.ts)
  SYG640: 'Element command target not found',
  SYG641: 'Unknown element command',
  // PLAN-4 GS-5: persist() (src/extra/persist.ts reports SYG642 with an explicit severity, like SYG611)
  SYG642: 'Persisted state could not be restored or saved',
  // PLAN-4 GS-7: timers (checks/timers.ts; dev entry)
  SYG643: 'Declaration static with no driver to take it',
  // PLAN-4 D131: sygnal/element (reported through the core bridge when diagnostics are on)
  SYG644: 'Custom element prop hides an HTMLElement member',
  // PLAN-4 GS-12 (D129): View Transitions (checks/viewTransitions.ts; dev entry)
  SYG645: "viewTransitions that can't run",
  // PLAN-4 GS-3: a11y lane (static only, sygnal-check)
  SYG701: 'Click listener on a non-interactive element',
  SYG702: 'Form field without an accessible label',
  SYG703: 'Image without alt text',
  SYG704: 'Link without href used as a button',
  SYG705: 'Button without an accessible name',
  SYG706: 'Positive tabIndex',
  SYG707: 'Unknown ARIA attribute or invalid role',
  SYG708: 'Label or ARIA reference to an id that is not rendered',
  SYG901: 'Sub-component sink stream errored',
  SYG902: 'EFFECT stream errored',
  SYG903: 'Component factory returned invalid sinks',
  // ---- end 1E retrofit codes ----
}

// 2A: strict-mode (SYG5xx) default severities. Kept OUT of CODE_SEVERITY so the
// main bundle doesn't carry them (D29: zero bytes); the 'sygnal/diagnostics'
// entry registers them (registerCodes) and its reports pass the severity
// explicitly. sygnal-check keeps the same table in sygnal-check/src/codes.js.
export const STRICT_CODE_SEVERITY: Record<string, DiagnosticSeverity> = {
  SYG501: 'warn',
  SYG502: 'warn',
  SYG503: 'warn',
  SYG504: 'warn',
  SYG505: 'warn',
  SYG506: 'warn',
  SYG507: 'info',
  SYG508: 'warn',
}

// PLAN-3 1-G (G-143): codes only the 'sygnal/diagnostics' dev entry reports. Like the strict
// table, kept OUT of CODE_SEVERITY (zero bytes in the main bundle); the entry registers them
// and passes the severity explicitly.
// PLAN-3 1-D: SYG112 (a reply action has no model entry) too.
// PLAN-3 2-A: SYG611 too, though makeSocketDriver reports it (legacy error(), severity passed
// explicitly): kept out of CODE_SEVERITY so the core bundle doesn't pay for an opt-in driver.
export const DEV_CODE_SEVERITY: Record<string, DiagnosticSeverity> = {
  SYG112: 'error',
  SYG115: 'warn',
  SYG116: 'error',
  // PLAN-4 1-D: controls, static (sygnal-check)
  SYG124: 'error',
  SYG125: 'error',
  SYG126: 'info',
  // PLAN-4 GS-1: behaviors (checks/behaviors.ts)
  SYG127: 'error',
  SYG128: 'error',
  SYG221: 'error',
  // PLAN-4 GS-4 (state.ts)
  SYG222: 'warn',
  // PLAN-4 GS-5 (checks/persist.ts; sygnal-check statically)
  SYG223: 'warn',
  SYG224: 'error',
  // PLAN-4 GS-8 (undo.ts reports it when diagnostics are on; sygnal-check statically)
  SYG226: 'warn',
  SYG421: 'error',
  SYG611: 'error',
  // PLAN-3 5-4b: router (SYG620 is reported by the router itself, like SYG611) and G-167
  SYG130: 'error',
  SYG131: 'warn',
  SYG132: 'warn',
  SYG133: 'warn',
  SYG620: 'error',
  // PLAN-3 5-3 (fetch.ts)
  SYG630: 'warn',
  SYG631: 'error',
  SYG632: 'info',
  SYG633: 'warn',
  // static only (sygnal-check); listed so the entry knows its title
  SYG634: 'info',
  // PLAN-3 5-5 (fetch.ts)
  SYG635: 'warn',
  // PLAN-4 GS-2 (checks/elementCommands.ts, through the core bridge; renderComponent too)
  SYG640: 'warn',
  SYG641: 'error',
  // PLAN-4 GS-5 (persist.ts, through legacy warn(): printed in production too)
  SYG642: 'warn',
  // PLAN-4 GS-7 (timers.ts): an invalid timer spec (not started); timers / connections /
  // resources declared with no driver registered
  SYG422: 'error',
  SYG643: 'warn',
  // PLAN-4 D131 (element.ts, through the core bridge; a console warning in dev with diagnostics off)
  SYG644: 'warn',
  // PLAN-4 GS-12 (viewTransitions.ts): the static set, but the app's DOM driver isn't makeViewTransitionDOMDriver()
  SYG645: 'warn',
  // PLAN-4 GS-3: a11y lane, static only (sygnal-check; error under --strict); listed so the entry knows its title
  SYG701: 'warn',
  SYG702: 'warn',
  SYG703: 'warn',
  SYG704: 'warn',
  SYG705: 'warn',
  SYG706: 'warn',
  SYG707: 'warn',
  SYG708: 'warn',
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
