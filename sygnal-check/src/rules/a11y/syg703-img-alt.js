/**
 * SYG703: an <img> without alt. alt="" (decorative) is fine, and so is an
 * image named another way (aria-label, aria-labelledby, title) or hidden
 * from assistive technology (role="presentation"/"none", aria-hidden).
 */
import { attr, attrString, elementsOf, componentName } from './shared.js'

export default {
  id: 'a11y-img-alt',
  codes: ['SYG703'],
  description: '<img> without alt',
  run(project, report) {
    for (const info of elementsOf(project)) {
      if (info.tag !== 'img' || info.spread) continue
      if (attr(info, 'alt', 'aria-label', 'aria-labelledby', 'title', 'ariaLabel')) continue
      const role = attrString(attr(info, 'role'))
      if (attr(info, 'role') && (role == null || /^(presentation|none)$/.test(role.trim()))) continue
      if (attr(info, 'aria-hidden')) continue
      report({
        code: 'SYG703',
        component: componentName(project, info.file, info.el),
        file: info.file,
        node: info.opening,
        message: `<${info.name}> has no alt text, so screen readers read out the file name or skip it`,
        fix: 'add alt="what the image shows"; for a purely decorative image use alt=""',
        data: { element: 'img' },
      })
    }
  },
}
