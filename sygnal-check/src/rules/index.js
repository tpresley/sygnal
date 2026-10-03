/**
 * Rule registry.
 *
 * A rule is a module whose default export is:
 *
 *   {
 *     id: 'selector-in-view',          // stable rule id (kebab-case)
 *     codes: ['SYG110', 'SYG104'],     // diagnostic codes it may report
 *     description: '…',
 *     strict: false,                   // true → only runs with --strict
 *     run(project, report) { … }
 *   }
 *
 * `report({ code, component?, file, node, message, fix?, severity?, data? })`
 * — `file` is a FileInfo and `node` an AST node (for the location); the
 * runner turns this into a Diagnostic, applies `// sygnal-ignore` comments
 * and drops findings located outside the scanned files.
 *
 * Strict-mode rules (workstream 2A) go in ./strict/ and are exported from
 * ./strict/index.js.
 */
import intentWithoutModel from './syg101-intent-without-model.js'
import unreachableModel from './syg102-unreachable-model.js'
import unknownReplyAction from './syg112-unknown-reply-action.js'
import selectorInView from './syg110-selector-in-view.js'
import eventsCounterpart from './syg105-events-counterpart.js'
import collectionFrom from './syg401-collection-from.js'
import controlledInput from './syg111-controlled-input.js'
import latestComputedKey from './syg624-latest-computed-key.js'
import { strictRules } from './strict/index.js'

export const coreRules = [
  intentWithoutModel,
  unreachableModel,
  unknownReplyAction,
  selectorInView, // also reports SYG104 (selector only found in a child component)
  eventsCounterpart,
  collectionFrom,
  controlledInput,
  latestComputedKey,
]

export { strictRules }

export function selectRules({ strict = false } = {}) {
  return strict ? [...coreRules, ...strictRules] : coreRules
}
