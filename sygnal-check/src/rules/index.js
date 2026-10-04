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
 * ./strict/index.js. The a11y lane (SYG7xx, PLAN-4 GS-3) is in ./a11y/: core
 * rules at warn (also under --strict, D144), swapped for error-severity copies
 * with --a11y=error / { a11y: 'error' }.
 */
import intentWithoutModel from './syg101-intent-without-model.js'
import unreachableModel from './syg102-unreachable-model.js'
import unknownReplyAction from './syg112-unknown-reply-action.js'
import selectorInView from './syg110-selector-in-view.js'
import eventsCounterpart from './syg105-events-counterpart.js'
import collectionFrom from './syg401-collection-from.js'
import controlledInput from './syg111-controlled-input.js'
import latestComputedKey from './syg634-latest-computed-key.js'
import controls from './syg124-controls.js'
import behaviors from './syg127-behaviors.js'
import elementCommands from './syg640-element-commands.js'
import timers from './syg422-timers.js'
import persist from './syg223-persist.js'
import initialStateSub from './syg405-initial-state.js'
import childSelectGrandchild from './syg129-child-select-grandchild.js'
import { strictRules } from './strict/index.js'
import { a11yRules, errorA11yRules } from './a11y/index.js'

export const coreRules = [
  intentWithoutModel,
  unreachableModel,
  unknownReplyAction,
  selectorInView, // also reports SYG104 (selector only found in a child component)
  eventsCounterpart,
  collectionFrom,
  controlledInput,
  latestComputedKey,
  controls, // SYG124, SYG125, SYG126, SYG128 (PLAN-4 CT-1)
  behaviors, // SYG127, SYG226 (PLAN-4 GS-1, GS-8)
  elementCommands, // SYG640, SYG641 (PLAN-4 GS-2)
  timers, // SYG422, SYG643 (PLAN-4 GS-7)
  persist, // SYG223, SYG224 (PLAN-4 GS-5)
  initialStateSub, // SYG405 statically (PLAN-4 4-G2)
  childSelectGrandchild, // SYG129 (PLAN-4 4-G2, PLAN-3 G-187)
  ...a11yRules, // SYG701-708 (PLAN-4 GS-3): warn, also under --strict; error with a11y: 'error' (D144)
]

export { strictRules, a11yRules }

export const A11Y_LEVELS = ['warn', 'error']

/**
 * The rules for a run: the core rules, plus the strict ones with `strict`.
 * `a11y: 'error'` reports the a11y lane (SYG7xx) at error severity; it stays
 * at warn otherwise, under strict too (D144).
 */
export function selectRules({ strict = false, a11y = 'warn' } = {}) {
  if (a11y == null) a11y = 'warn'
  if (!A11Y_LEVELS.includes(a11y)) throw new Error(`a11y must be 'warn' or 'error' (got ${JSON.stringify(a11y)})`)
  let rules = coreRules
  if (a11y === 'error') {
    const lane = new Set(a11yRules)
    rules = [...coreRules.filter(r => !lane.has(r)), ...errorA11yRules]
  }
  return strict ? [...rules, ...strictRules] : rules
}
