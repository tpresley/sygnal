/**
 * SYG706: a positive tabIndex. It moves the element ahead of everything with
 * tabIndex 0 or none, so the Tab order no longer follows the page.
 */
import { attr, attrString, elementsOf, componentName } from './shared.js'

export default {
  id: 'a11y-positive-tabindex',
  codes: ['SYG706'],
  description: 'Positive tabIndex',
  run(project, report) {
    for (const info of elementsOf(project)) {
      if (info.kind !== 'html' && info.kind !== 'control') continue
      const a = attr(info, 'tabIndex', 'tabindex')
      const s = attrString(a)
      if (s == null || !/^\s*\+?\d+\s*$/.test(s) || Number(s) <= 0) continue
      report({
        code: 'SYG706',
        component: componentName(project, info.file, info.el),
        file: info.file,
        node: a.node,
        message: `tabIndex={${s.trim()}} puts this <${info.name}> ahead of the rest of the page in the Tab order, so keyboard users jump around`,
        fix: 'use tabIndex={0} (focusable in document order) or tabIndex={-1} (focusable from code only), and order the markup the way it should be tabbed',
        data: { value: Number(s) },
      })
    }
  },
}
