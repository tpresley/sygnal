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
  // PLAN-5 W-1 widgets (rules/syg140-widgets.js; SYG142 also for a widget target in rules/syg640)
  SYG140: { severity: 'warn', title: 'Widget dispatched an undeclared event' },
  SYG141: { severity: 'warn', title: 'Listener for an event the widget does not declare' },
  SYG142: { severity: 'error', title: 'Widget command not declared' },
  SYG143: { severity: 'warn', title: 'Widget tag used as a selector' },
  SYG144: { severity: 'info', title: 'Widget event the host element also fires natively' },
  // PLAN-6 K-1: the agent static and LLM requests (rules/syg150-agent.js, syg152, syg153)
  SYG150: { severity: 'warn', title: 'Agent action has no model entry' },
  SYG151: { severity: 'warn', title: 'Misspelled agent static' },
  SYG152: { severity: 'warn', title: 'LLM request without an ok action' },
  SYG153: { severity: 'warn', title: 'WebMCP form attribute set as a DOM property' },
  // PLAN-4 GS-1 behaviors (model/behaviors.js)
  SYG127: { severity: 'error', title: 'Behavior collision or unresolvable uses entry' },
  SYG128: { severity: 'error', title: 'Duplicate control key' },
  // PLAN-4 4-G2 (rules/syg129-child-select-grandchild.js; PLAN-3 G-187)
  SYG129: { severity: 'warn', title: "CHILD.select() of a component this one doesn't render" },
  // PLAN-4 GS-8 undo (rules/syg127-behaviors.js)
  SYG223: { severity: 'warn', title: 'persist pick or omit names a key that is not in initialState' },
  SYG224: { severity: 'error', title: 'persist on a component that is not the root' },
  SYG226: { severity: 'warn', title: 'Undo track, resetOn or coalesce names an unknown action' },
  // PLAN-6 K-1 (rules/syg150-agent.js): static counterparts of the agent layer's codes (G-611, G-591)
  SYG240: { severity: 'error', title: 'Agent action input has no JSON Schema form' },
  SYG243: { severity: 'warn', title: 'Agent action input schema converted with losses' },
  SYG401: { severity: 'warn', title: "Collection 'from' field is missing or not an array" },
  SYG440: { severity: 'warn', title: 'Two agent declarations with the same name' },
  SYG441: { severity: 'warn', title: 'Agent Collection items without unique ids' },
  // PLAN-4 4-G2 (rules/syg405-initial-state.js): error for a child rendered by tag, warn for a
  // Collection / Switchable target (the rule passes the severity)
  SYG405: { severity: 'error', title: 'Sub-component has initialState without isolatedState' },
  // PLAN-4 GS-7 timers (rules/syg422-timers.js)
  SYG422: { severity: 'error', title: 'Invalid timer spec' },
  // PLAN-4 4-G2 (rules/syg609-sink-driver.js): the run() call registers no driver for a model sink
  SYG609: { severity: 'warn', title: 'Sink or source has no driver' },
  // PLAN-4.6 R5 (rules/syg612-removed-forms.js): a form 6.0 removed
  SYG612: { severity: 'error', title: 'Removed in 6.0' },
  SYG634: { severity: 'info', title: 'latest: true with a computed key' },
  // PLAN-4 GS-2 element commands (rules/syg640-element-commands.js), GS-7 (rules/syg422-timers.js)
  SYG640: { severity: 'warn', title: 'Element command target not found' },
  SYG641: { severity: 'error', title: 'Unknown element command' },
  SYG643: { severity: 'warn', title: 'Declaration static with no driver to take it' },
  // PLAN-4 GS-3: the a11y lane (rules/a11y/); warn, also under --strict; error with --a11y=error (D144)
  SYG701: { severity: 'warn', title: 'Click listener on a non-interactive element' },
  SYG702: { severity: 'warn', title: 'Form field without an accessible label' },
  SYG703: { severity: 'warn', title: 'Image without alt text' },
  SYG704: { severity: 'warn', title: 'Link without href used as a button' },
  SYG705: { severity: 'warn', title: 'Button without an accessible name' },
  SYG706: { severity: 'warn', title: 'Positive tabIndex' },
  SYG707: { severity: 'warn', title: 'Unknown ARIA attribute or invalid role' },
  SYG708: { severity: 'warn', title: 'Label or ARIA reference to an id that is not rendered' },
  // PLAN-5 2-T (D211): rules/a11y/syg722-ui-name.js
  SYG722: { severity: 'warn', title: 'Menu, Select or Combobox without an accessible name' },
  // PLAN-5 B-1 (rules/a11y/syg724-sortable.js)
  SYG724: { severity: 'warn', title: 'Sortable handle not keyboard-accessible, or no live region' },
  // PLAN-6 K-1 (rules/a11y/syg730-hover-only.js, syg731-toggle-state.js)
  SYG730: { severity: 'warn', title: 'Action reachable only by hovering' },
  SYG731: { severity: 'warn', title: 'Toggled state shown only by a class' },
  // strict mode (--strict), dev-plans/PLAN-1-canonical-forms.md; severities match
  // STRICT_CODE_SEVERITY in src/extra/diagnostics/codes.ts
  SYG501: { severity: 'error', title: "Removed in 6.0: view with positional arguments", strict: true },
  SYG502: { severity: 'warn', title: 'Retired in 6.0: STATE reducer signals no change without ABORT', strict: true },
  SYG503: { severity: 'warn', title: 'Side effect in a STATE reducer that returns ABORT', strict: true },
  SYG504: { severity: 'error', title: "Removed in 6.0: 'ACTION | SINK' model key", strict: true },
  SYG505: { severity: 'warn', title: 'Non-canonical EVENTS emit', strict: true },
  SYG506: { severity: 'error', title: "Removed in 6.0: CHILD.select() with a component name", strict: true },
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
