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
  SYG112: { severity: 'error', title: 'Reply action has no model entry' },
  // PLAN-4 CT-1 controls (model/controls.js)
  SYG124: { severity: 'error', title: 'Component used as a control or selector' },
  SYG125: { severity: 'error', title: 'Control given .intent, .model or .initialState' },
  SYG126: { severity: 'info', title: 'Control rendered but never listened to' },
  // PLAN-4 GS-1 behaviors (model/behaviors.js)
  SYG127: { severity: 'error', title: 'Behavior collision or unresolvable uses entry' },
  SYG128: { severity: 'error', title: 'Duplicate control key' },
  // PLAN-4 GS-8 undo (rules/syg127-behaviors.js)
  SYG226: { severity: 'warn', title: 'Undo track or resetOn names an unknown action' },
  SYG401: { severity: 'warn', title: "Collection 'from' field is missing or not an array" },
  SYG634: { severity: 'info', title: 'latest: true with a computed key' },
  // PLAN-4 GS-3: the a11y lane (rules/a11y/); warn, error under --strict (D111)
  SYG701: { severity: 'warn', title: 'Click listener on a non-interactive element' },
  SYG702: { severity: 'warn', title: 'Form field without an accessible label' },
  SYG703: { severity: 'warn', title: 'Image without alt text' },
  SYG704: { severity: 'warn', title: 'Link without href used as a button' },
  SYG705: { severity: 'warn', title: 'Button without an accessible name' },
  SYG706: { severity: 'warn', title: 'Positive tabIndex' },
  SYG707: { severity: 'warn', title: 'Unknown ARIA attribute or invalid role' },
  SYG708: { severity: 'warn', title: 'Label or ARIA reference to an id that is not rendered' },
  // strict mode (--strict), dev-plans/PLAN-1-canonical-forms.md; severities match
  // STRICT_CODE_SEVERITY in src/extra/diagnostics/codes.ts
  SYG501: { severity: 'warn', title: 'View uses positional arguments', strict: true },
  SYG502: { severity: 'warn', title: 'Retired in 6.0: STATE reducer signals no change without ABORT', strict: true },
  SYG503: { severity: 'warn', title: 'Side effect in a STATE reducer that returns ABORT', strict: true },
  SYG504: { severity: 'warn', title: "'ACTION | SINK' shorthand model key", strict: true },
  SYG505: { severity: 'warn', title: 'Non-canonical EVENTS emit', strict: true },
  SYG506: { severity: 'warn', title: 'CHILD.select() with a string component name', strict: true },
  SYG507: { severity: 'info', title: 'Prop drilled through more than 2 component levels', strict: true },
  SYG508: { severity: 'warn', title: 'select()/errors() round trip where reply actions would do', strict: true },
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
