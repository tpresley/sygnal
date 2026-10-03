/**
 * The 7xx "a11y" lane (PLAN-4 GS-3): static accessibility checks.
 *
 * On by default (they are core rules), warn severity; with --strict /
 * check(…, { strict: true }) they report errors (D111). See ./shared.js for
 * the precision rules every check follows.
 */
import clickTarget from './syg701-click-target.js'
import fieldLabel from './syg702-field-label.js'
import imgAlt from './syg703-img-alt.js'
import buttonName from './syg705-button-name.js'
import positiveTabindex from './syg706-positive-tabindex.js'
import aria from './syg707-aria.js'
import idReference from './syg708-id-reference.js'

export const a11yRules = [
  clickTarget,      // SYG701, SYG704 (cross intent/view)
  fieldLabel,       // SYG702
  imgAlt,           // SYG703
  buttonName,       // SYG705
  positiveTabindex, // SYG706
  aria,             // SYG707
  idReference,      // SYG708
]

/** The same rules reporting at error severity (strict mode). */
export const strictA11yRules = a11yRules.map(rule => ({
  ...rule,
  run: (project, report) => rule.run(project, (r) => report({ ...r, severity: 'error' })),
}))
