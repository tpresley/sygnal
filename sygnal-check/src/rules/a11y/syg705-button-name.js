/**
 * SYG705: a <button> with no accessible name: no text content, and no
 * aria-label / aria-labelledby / title. Icon-only buttons (<i>, <svg> without
 * <title>, <img alt="">) are the usual case.
 *
 * Literal children only: any expression child ({state.label}, a helper call)
 * or child component might produce text, so the button is not reported.
 *
 * G-433 (PLAN-5 3-G): one call is known, the icon helper of the icons recipe:
 * `icon(Trash2)` / `renderIcon(Trash2, { size: 16 })`, a function named `icon`
 * or `renderIcon` (any case; also `x.icon(...)`) whose first argument is a
 * string literal or an identifier imported from an icon package (`lucide`,
 * `@lucide/*`, any specifier with `icon` in it such as `@tabler/icons` or
 * `./icons.js`, `@mdi/js`). It renders no text, so it is 'none' unless its
 * second argument names it: an object literal with a `label`, `title`,
 * `aria-label` or `ariaLabel` property ('text' when a non-empty literal string,
 * else 'unknown'); a second argument that isn't an object literal, or one with
 * a spread, is 'unknown'. Any other call stays 'unknown'.
 */
import { unwrap, stringValue, propName } from '../../ast.js'
import { findBinding } from '../../scope.js'
import { attr, attrString, describe, elementsOf, componentName } from './shared.js'

const ICON_FN = /^(render)?icon$/i
const ICON_MODULE = /^(lucide(-static)?$|@lucide\/|@mdi\/)|icon/i
const ICON_LABELS = new Set(['label', 'title', 'aria-label', 'ariaLabel'])

/** 'none' | 'text' | 'unknown' for an icon helper call, or null when the call isn't one */
function iconCall(file, e) {
  const callee = unwrap(e.callee)
  const name = callee.type === 'Identifier' ? callee.name
    : callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : null
  if (!name || !ICON_FN.test(name)) return null
  const [data, opts, ...rest] = e.arguments.map(unwrap)
  if (!data || rest.length) return null
  if (data.type === 'Identifier') {
    const b = file?.parents ? findBinding(file, data.name, e) : null
    if (b?.kind !== 'import' || !ICON_MODULE.test(b.source)) return null
  } else if (stringValue(data) == null) return null
  if (!opts) return 'none'
  if (opts.type !== 'ObjectExpression') return 'unknown'
  let state = 'none'
  for (const p of opts.properties) {
    if (p.type !== 'ObjectProperty') return 'unknown'
    if (p.computed || !ICON_LABELS.has(propName(p))) continue
    const v = stringValue(unwrap(p.value))
    if (v == null) state = 'unknown'
    else if (v.trim()) return 'text'
  }
  return state
}

const NAMING_ATTRS = ['aria-label', 'aria-labelledby', 'title', 'ariaLabel', 'ariaLabelledBy']

/** 'text' | 'none' | 'unknown' for a list of JSX children. */
function nameOf(project, file, children) {
  let state = 'none'
  for (const c of children) {
    const s = childName(project, file, c)
    if (s === 'text') return 'text'
    if (s === 'unknown') state = 'unknown'
  }
  return state
}

function childName(project, file, c) {
  if (c.type === 'JSXText') return c.value.trim() ? 'text' : 'none'
  if (c.type === 'JSXExpressionContainer') {
    const e = unwrap(c.expression)
    if (e.type === 'JSXEmptyExpression') return 'none'
    const s = stringValue(e)
    if (s != null) return s.trim() ? 'text' : 'none'
    if (e.type === 'NumericLiteral') return 'text'
    if (e.type === 'TemplateLiteral') return 'unknown'
    if (e.type === 'JSXElement' || e.type === 'JSXFragment') return childName(project, file, e)
    if (e.type === 'CallExpression') return iconCall(file, e) ?? 'unknown'
    return 'unknown'
  }
  if (c.type === 'JSXFragment') return nameOf(project, file, c.children)
  if (c.type === 'JSXSpreadChild') return 'unknown'
  if (c.type !== 'JSXElement') return 'unknown'
  const info = describe(project, file, c)
  if (!info.tag || info.spread) return 'unknown'
  if (attr(info, 'aria-hidden')) {
    const h = attrString(attr(info, 'aria-hidden'))
    if (h == null) return 'unknown'
    if (h === '' || h === 'true') return 'none'
  }
  for (const n of NAMING_ATTRS) {
    const a = attr(info, n)
    if (!a) continue
    const s = attrString(a)
    if (s == null || s.trim()) return s == null ? 'unknown' : 'text'
  }
  if (info.tag === 'img') {
    const alt = attr(info, 'alt')
    if (!alt) return 'none'
    const s = attrString(alt)
    return s == null ? 'unknown' : s.trim() ? 'text' : 'none'
  }
  if (info.tag === 'input') return 'unknown'
  if (info.tag === 'title') return nameOf(project, file, c.children) === 'none' ? 'none' : 'text'
  return nameOf(project, file, c.children)
}

export default {
  id: 'a11y-button-name',
  codes: ['SYG705'],
  description: '<button> without an accessible name',
  run(project, report) {
    for (const info of elementsOf(project)) {
      if (info.tag !== 'button' || info.spread) continue
      if (NAMING_ATTRS.some(n => attr(info, n))) continue
      if (nameOf(project, info.file, info.el.children) !== 'none') continue
      const what = info.kind === 'control' ? `control <${info.name}> (a <button>)` : '<button>'
      report({
        code: 'SYG705',
        component: componentName(project, info.file, info.el),
        file: info.file,
        node: info.opening,
        message: `${what} has no accessible name (no text, aria-label, aria-labelledby or title), so screen readers announce only "button"`,
        fix: 'put text in it, or for an icon-only button add aria-label="Close" (and aria-hidden="true" on the icon)',
        data: { element: 'button' },
      })
    }
  },
}
