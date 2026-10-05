/**
 * SYG702: a form field (<input> other than hidden/submit/reset/button/image,
 * <select>, <textarea>) with no accessible label:
 *   - no <label> wrapping it (in the same view, or around every place the
 *     component or helper that renders it is used),
 *   - no <label for> / <label htmlFor> matching its id (a literal, or the
 *     same uid('x') call),
 *   - no aria-label, aria-labelledby or title,
 *   - no placeholder (a last-resort name, accepted as axe does; a visible
 *     label is still better).
 *
 * Says nothing when unsure: spread props, a dynamic type or id, a field
 * passed into a child component (it may render the label), or JSX kept in a
 * variable or helper we can't follow.
 */
import { loc } from '../../ast.js'
import { attr, attrString, describe, elementsOf, labelState, idIndex, uidKey, componentName } from './shared.js'

const UNLABELLED_INPUT_TYPES = new Set(['hidden', 'submit', 'reset', 'button', 'image'])
const FIELDS = new Set(['input', 'select', 'textarea'])

/** Line of a <label> without for/htmlFor among the field's siblings, or null. */
function unlinkedSiblingLabel(project, info) {
  const parent = info.file.parents.get(info.el)
  if (parent?.type !== 'JSXElement' && parent?.type !== 'JSXFragment') return null
  for (const c of parent.children) {
    if (c.type !== 'JSXElement' || c === info.el) continue
    const s = describe(project, info.file, c)
    if (s.tag === 'label' && !s.spread && !attr(s, 'htmlFor', 'for')) return loc(c.openingElement).line
  }
  return null
}

export default {
  id: 'a11y-field-label',
  codes: ['SYG702'],
  description: 'Form field without an accessible label',
  run(project, report) {
    const ix = idIndex(project)
    for (const info of elementsOf(project)) {
      if (!FIELDS.has(info.tag) || info.spread) continue
      if (info.tag === 'input') {
        const type = attr(info, 'type')
        if (type) {
          const t = attrString(type)
          if (t == null || UNLABELLED_INPUT_TYPES.has(t.toLowerCase())) continue
        }
      }
      if (attr(info, 'aria-label', 'aria-labelledby', 'title', 'placeholder', 'ariaLabel', 'ariaLabelledBy')) continue
      const id = attr(info, 'id')
      if (id) {
        const key = uidKey(id.value)
        const s = key ? null : attrString(id)
        if (key == null && s == null) continue // dynamic id: a label may point at it
        if (key && ix.labelUids.get(info.file)?.has(key)) continue
        if (s != null && ix.labelFors.has(s)) continue
        if (ix.dynamicFor.has(info.file)) continue
      }
      const ctx = labelState(project, info.file, info.el)
      if (ctx !== 'none') continue
      const what = info.kind === 'control' ? `${info.control?.kind === 'widget' ? 'widget' : 'control'} <${info.name}> (a <${info.tag}>)` : `<${info.tag}>`
      const sibling = unlinkedSiblingLabel(project, info)
      report({
        code: 'SYG702',
        component: componentName(project, info.file, info.el),
        file: info.file,
        node: info.opening,
        message: sibling
          ? `${what} has no label: the <label> next to it (line ${sibling}) isn't linked to it, so screen readers announce the field without a name`
          : `${what} has no label, so screen readers announce it without a name`,
        fix: sibling
          ? `move the field inside that <label>, or link them: <label for={uid('x')}> and id={uid('x')} on the field`
          : `wrap it in a <label>, or pair id={uid('x')} with <label for={uid('x')}>; with no visible label, add aria-label`,
        data: { element: info.tag },
      })
    }
  },
}
