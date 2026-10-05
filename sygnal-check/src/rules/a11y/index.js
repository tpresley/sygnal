/**
 * The 7xx "a11y" lane (PLAN-4 GS-3): static accessibility checks.
 *
 * On by default (they are core rules), warn severity, also under --strict
 * (D144, amending D111); --a11y=error / check(…, { a11y: 'error' }) swaps in
 * error-severity copies. See ./shared.js for the precision rules every check
 * follows.
 */
import clickTarget from './syg701-click-target.js'
import fieldLabel from './syg702-field-label.js'
import imgAlt from './syg703-img-alt.js'
import buttonName from './syg705-button-name.js'
import positiveTabindex from './syg706-positive-tabindex.js'
import aria from './syg707-aria.js'
import idReference from './syg708-id-reference.js'
import sortable from './syg724-sortable.js'

export const a11yRules = [
  clickTarget,      // SYG701, SYG704 (cross intent/view)
  fieldLabel,       // SYG702
  imgAlt,           // SYG703
  buttonName,       // SYG705
  positiveTabindex, // SYG706
  aria,             // SYG707
  idReference,      // SYG708
  sortable,         // SYG724 (the sortable behavior's handle and live region)
]

/** The same rules reporting at error severity (the a11y: 'error' opt-in, D144). */
export const errorA11yRules = a11yRules.map(rule => ({
  ...rule,
  run: (project, report) => rule.run(project, (r) => report({ ...r, severity: 'error' })),
}))
