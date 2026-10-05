/**
 * SYG722 (PLAN-5 2-T, D211): a Zag UI part (<Menu>, <Select>, <Combobox> imported from
 * sygnal/ui/menu, sygnal/ui/select, sygnal/ui/combobox) without an accessible name: no `label`
 * (the visible label, or Menu's trigger text), `aria-label` or `aria-labelledby`. The part puts
 * them on its control (G-413), so without one the trigger / input is announced unnamed.
 *
 * Precise like the other a11y rules: a spread, or a dynamic value for any of the three, counts
 * as named; an empty string literal doesn't.
 */
import { findBinding } from '../../scope.js'
import { UI_ZAG, uiZagPart } from '../../model/widgets.js'
import { attr, attrString, elementsOf, componentName } from './shared.js'

const NAMES = ['label', 'aria-label', 'aria-labelledby']

const CONTROL = { Menu: 'menu button', Select: 'select trigger', Combobox: 'combobox input' }

export default {
  id: 'a11y-ui-name',
  codes: ['SYG722'],
  description: 'Menu / Select / Combobox without an accessible name',
  run(project, report) {
    for (const info of elementsOf(project)) {
      if (info.kind !== 'control' || info.spread || info.opening.name.type !== 'JSXIdentifier') continue
      const part = uiZagPart(findBinding(info.file, info.name, info.opening))
      if (!part) continue
      // named: any of the three, unless it is an empty (or blank) string literal
      if (NAMES.some(n => { const a = attr(info, n); if (!a) return false; const s = attrString(a); return s == null || s.trim() !== '' })) continue
      const sub = UI_ZAG[part][0]
      report({
        code: 'SYG722',
        component: componentName(project, info.file, info.el),
        file: info.file,
        node: info.opening,
        message: `<${part}> (${sub}) has no accessible name (no label, aria-label or aria-labelledby), so screen readers announce its ${CONTROL[part]} without a name`,
        fix: part === 'Menu'
          ? 'give it label="Actions" (the trigger text), or aria-label="More actions" for an icon-only trigger'
          : `give it label="City" (a visible label), or aria-label="City" / aria-labelledby="<id of a heading>" when the label is elsewhere`,
        data: { part, subpath: sub },
      })
    }
  },
}
