/**
 * SYG708: <label for>, aria-describedby or aria-labelledby names an id that
 * nothing renders, so the label or description is attached to nothing.
 *
 *   - a literal id must be rendered somewhere in the scanned files (ids are
 *     document-wide); a dynamic id anywhere (id={props.id}) might be it, so
 *     a project with one only checks uid() references;
 *   - a uid('x') reference needs an element in the same file with
 *     id={uid('x')} (uid values are per component instance).
 *
 * Spread props on an element in the same file might set the id: no finding.
 */
import { attr, elementsOf, idIndex, idRefs, idRendered, uidRendered, componentName } from './shared.js'

const REF_ATTRS = ['aria-describedby', 'aria-labelledby']

export default {
  id: 'a11y-id-reference',
  codes: ['SYG708'],
  description: 'label for / aria-describedby / aria-labelledby pointing at an id that is not rendered',
  run(project, report) {
    const ix = idIndex(project)
    for (const info of elementsOf(project)) {
      if (info.kind !== 'html' && info.kind !== 'control') continue
      if (ix.spreadFiles.has(info.file)) continue
      const checks = REF_ATTRS.map(n => [n, attr(info, n)])
      if (info.tag === 'label') checks.push(['htmlFor', attr(info, 'htmlFor')], ['for', attr(info, 'for')])
      for (const [name, a] of checks) {
        if (!a) continue
        const refs = idRefs(a, info.file)
        if (!refs) continue
        const missing = [
          ...refs.ids.filter(id => !idRendered(ix, id)).map(id => `"${id}"`),
          ...refs.uids.filter(k => !uidRendered(ix, info.file, k)).map(k => `uid(${k === 'uid:' ? '' : `'${k.slice(4)}'`})`),
        ]
        if (!missing.length) continue
        report({
          code: 'SYG708',
          component: componentName(project, info.file, info.el),
          file: info.file,
          node: a.node,
          message: `${name}=${missing.join(' ')} points at an id that no element renders, so the ${name === 'aria-describedby' ? 'description' : 'label'} is attached to nothing`,
          fix: `render the target with the same id (id=${missing[0].startsWith('uid') ? `{${missing[0]}}` : missing[0]}), or fix the reference; prefer uid('x') on both sides for ids inside a component`,
          data: { attribute: name, missing },
        })
      }
    }
  },
}
