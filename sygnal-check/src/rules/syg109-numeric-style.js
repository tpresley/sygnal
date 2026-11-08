/**
 * SYG109: a number for a style property that needs a unit.
 *
 * Sygnal assigns `style` keys to `elm.style` as written, without appending px, so
 * `style={{ width: 10 }}` is invalid CSS: nothing is set and nothing fails. Reported for a
 * non-zero number literal, or a const number, on an intrinsic element or a control, in a style
 * object literal (or a const one), including its delayed / remove / destroy sub-objects.
 * Not reported: custom properties, UNITLESS, 'sygnal/primitives' tags (they append px; they
 * describe as 'component' here), and any project importing a non-DOM renderer, whose numbers mean
 * cells or points (NON_DOM).
 *
 * UNITLESS is the dev entry's table (src/extra/diagnostics/checks/numericStyle.ts);
 * test/syg109-numeric-style.test.js keeps the two equal.
 *
 * --fix: `10` → `'10px'`, on a literal (not for a time or an angle, whose unit isn't px).
 */
import { unwrap, propName } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import { elementsOf, attr, componentName } from './a11y/shared.js'

// React's isUnitlessNumber, then the CSS number properties it misses
export const UNITLESS = [
  'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice', 'borderImageWidth', 'boxFlex',
  'boxFlexGroup', 'boxOrdinalGroup', 'columnCount', 'columns', 'flex', 'flexGrow', 'flexPositive', 'flexShrink',
  'flexNegative', 'flexOrder', 'gridArea', 'gridRow', 'gridRowEnd', 'gridRowSpan', 'gridRowStart', 'gridColumn',
  'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart', 'fontWeight', 'lineClamp', 'lineHeight', 'opacity', 'order',
  'orphans', 'scale', 'tabSize', 'widows', 'zIndex', 'zoom', 'fillOpacity', 'floodOpacity', 'stopOpacity',
  'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth', 'MozAnimationIterationCount',
  'MozBoxFlex', 'MozBoxFlexGroup', 'MozLineClamp', 'msAnimationIterationCount', 'msFlex', 'msZoom', 'msFlexPositive',
  'msGridColumns', 'msGridRows', 'WebkitAnimationIterationCount', 'WebkitBoxFlex', 'WebKitBoxFlexGroup',
  'WebkitBoxOrdinalGroup', 'WebkitColumnCount', 'WebkitColumns', 'WebkitFlex', 'WebkitFlexGrow', 'WebkitFlexPositive',
  'WebkitFlexShrink', 'WebkitLineClamp',
  'counterIncrement', 'counterReset', 'counterSet', 'fontSizeAdjust', 'maskBorderOutset', 'maskBorderSlice',
  'maskBorderWidth', 'mathDepth', 'shapeImageThreshold',
]
const UNITLESS_SET = new Set(UNITLESS)
export const isUnitless = (key) => UNITLESS_SET.has(key.replace(/-+(.)/g, (_, c) => c.toUpperCase()))

// the style sub-objects snabbdom's style module applies at other times
const PHASES = new Set(['delayed', 'remove', 'destroy'])
// numbers here mean cells or density-independent points
const NON_DOM = /^sygnal\/(terminal|react-native|host|canvas|three)$/
// px would be wrong for these: no fix, the unit is the author's
const NOT_A_LENGTH = /(Duration|Delay)$|^(transition|animation|rotate)$/

const nonDomProject = new WeakMap()
function targetsNonDom(project) {
  if (nonDomProject.has(project)) return nonDomProject.get(project)
  let found = false
  for (const file of project.files.values()) {
    for (const s of file?.ast.program.body || []) { // (null: a file that failed to parse)
      if ((s.type === 'ImportDeclaration' && s.importKind !== 'type' && NON_DOM.test(s.source.value)) ||
        (s.type === 'ExportNamedDeclaration' && s.source && NON_DOM.test(s.source.value))) found = true
    }
    if (found) break
  }
  nonDomProject.set(project, found)
  return found
}

/** A literal or const number: { value, literal? } (the literal only when it's the value as written); null otherwise. */
function numberOf(project, file, expr) {
  const e = unwrap(expr)
  if (e?.type === 'NumericLiteral') return { value: e.value, literal: e }
  if (e?.type === 'UnaryExpression' && (e.operator === '-' || e.operator === '+') && unwrap(e.argument)?.type === 'NumericLiteral') {
    const v = unwrap(e.argument).value
    return { value: e.operator === '-' ? -v : v, literal: e }
  }
  if (e?.type !== 'Identifier') return null
  const b = findBinding(file, e.name, e)
  if (!b || (b.kind !== 'import' && !(b.kind === 'var' && b.declKind === 'const'))) return null
  const r = resolveExpr(project, file, e)
  const n = unwrap(r?.node)
  return n?.type === 'NumericLiteral' ? { value: n.value } : null
}

/** The object a `style` value is: a literal, or a const naming one in this file. */
function styleObject(file, expr) {
  let e = unwrap(expr)
  if (e?.type === 'Identifier') {
    const b = findBinding(file, e.name, e)
    e = b?.kind === 'var' && b.declKind === 'const' ? unwrap(b.init) : null
  }
  return e?.type === 'ObjectExpression' ? e : null
}

function checkObject(project, file, obj, visit) {
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty') continue
    const key = propName(p)
    if (key == null) continue
    const v = unwrap(p.value)
    if (PHASES.has(key) && v?.type === 'ObjectExpression') { checkObject(project, file, v, visit); continue }
    if (key.startsWith('--') || isUnitless(key)) continue
    const n = numberOf(project, file, v)
    if (n && n.value !== 0) visit(p, key, n)
  }
}

export default {
  id: 'numeric-style',
  codes: ['SYG109'],
  description: 'Numeric style value without a unit',
  run(project, report) {
    if (targetsNonDom(project)) return
    const seen = new Set() // a const style object used by several elements is one finding
    for (const info of elementsOf(project)) {
      if (info.kind !== 'html' && info.kind !== 'control') continue
      const obj = styleObject(info.file, attr(info, 'style')?.value)
      if (!obj) continue
      checkObject(project, info.file, obj, (prop, key, n) => {
        if (seen.has(prop)) return
        seen.add(prop)
        const good = NOT_A_LENGTH.test(key) ? null : `'${n.value}px'`
        report({
          code: 'SYG109',
          component: componentName(project, info.file, info.el),
          file: info.file,
          node: prop,
          message: `style ${key}: ${n.value} on <${info.name}> is a number with no unit, so the browser ignores it (Sygnal does not append px)`,
          fix: good ? `write ${key}: ${good}` : `write ${key} as a string with its unit`,
          data: { property: key, value: n.value, tag: info.name },
          fixes: good && n.literal ? [{ title: `Change to ${good}`, kind: 'quickfix', preferred: true, fixAll: true, edits: [{ file: info.file.path, start: n.literal.start, end: n.literal.end, text: good }] }] : undefined,
        })
      })
    }
  },
}
