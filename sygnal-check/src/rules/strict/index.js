/**
 * Strict-mode (canonical-form, SYG5xx) rules — workstream 2A.
 * Normative source: dev-plans/PLAN-1-canonical-forms.md (rules C1-C11).
 * Each rule follows the interface documented in ../index.js with
 * `strict: true`; they only run with `--strict` / `check(…, { strict: true })`.
 *
 * Rules attach their mechanical rewrites to a report as a `fixAll` fix (shared.js rewriteFix,
 * PLAN-7 C-4): `--fix` applies them (see ../../fix.js), an editor offers them.
 */
import positionalView from './syg501-positional-view.js'
import effectInState from './syg503-effect-in-state.js'
import shorthandKey from './syg504-shorthand-key.js'
import eventsEmit from './syg505-events-emit.js'
import childSelectString from './syg506-child-select-string.js'
import propDrilling from './syg507-prop-drilling.js'
import selectRoundtrip from './syg508-select-roundtrip.js'
import clockInHandler from './syg509-clock-in-handler.js'

export const strictRules = [
  positionalView,     // SYG501 (C1)
  // SYG502 (C3) retired in 6.0 (PLAN-4 GS-4): returning the state object is "no change"
  effectInState,      // SYG503 (C4)
  shorthandKey,       // SYG504 (C5)
  eventsEmit,         // SYG505 (C6)
  childSelectString,  // SYG506 (C7)
  propDrilling,       // SYG507 (C10, info)
  selectRoundtrip,    // SYG508 (PLAN-3 §1.1: reply actions)
  clockInHandler,     // SYG509 (record/replay: now()/random()/uuid() from props; replaces SYG258)
]
