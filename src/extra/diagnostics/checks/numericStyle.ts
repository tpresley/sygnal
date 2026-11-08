/**
 * SYG109 — a number for a style property that needs a unit (warn).
 *
 * Sygnal assigns `style` keys to `elm.style` as written and does not append px, so
 * `style={{ width: state.w }}` with a number is invalid CSS: nothing is set and nothing fails.
 * sygnal-check reports literals and const numbers; this reports what it can't see.
 *
 * Mechanism: onRender (before the DOM driver patches) walks the rendered vnode tree and reads each
 * `style` (and its delayed / remove / destroy sub-objects). Once per component and property.
 * A child component's root (its `data.isolate`) ends the walk: children render first, and their
 * output is in the parent's vnode.
 *
 * Only under the browser DOM driver (the source's `_eventDelegator`, an EventDelegator): on sygnal/host trees
 * (a terminal, React Native, a worker, the sandbox) numbers mean cells or points, and
 * renderComponent's mock DOM has no CSS. 'sygnal/primitives' tags have appended px by here.
 *
 * UNITLESS is React's isUnitlessNumber plus the CSS number properties it misses; sygnal-check's
 * rules/syg109-numeric-style.js has the same table (test/syg109-numeric-style.test.js keeps them equal).
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf} from './shared'

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
const isUnitless = (key: string): boolean => UNITLESS_SET.has(key.replace(/-+(.)/g, (_, c) => c.toUpperCase()))

const PHASES = ['delayed', 'remove', 'destroy']

function checkStyle(style: Record<string, any>, visit: (key: string, value: number) => void): void {
  for (const key of Object.keys(style)) {
    const v = style[key]
    if (PHASES.includes(key)) { if (v && typeof v == 'object') checkStyle(v, visit); continue }
    if (typeof v == 'number' && v !== 0 && !Number.isNaN(v) && !key.startsWith('--') && !isUnitless(key)) visit(key, v)
  }
}

function walk(vnode: any, visit: (style: Record<string, any>, tag: string) => void, depth = 0): void {
  if (!vnode || typeof vnode != 'object' || depth > 500 || (depth > 0 && vnode.data?.isolate)) return
  const style = vnode.data?.style
  if (style && typeof style == 'object') visit(style, typeof vnode.sel == 'string' ? vnode.sel.split(/[.#]/)[0] : '')
  const children = vnode.children
  if (Array.isArray(children)) for (const c of children) walk(c, visit, depth + 1)
}

export const numericStyleCheck: DiagnosticCheck = {
  id: 'numericStyle',

  onRender(component, rootVnode) {
    const source = component?.sources?.[component.DOMSourceName || 'DOM']
    if (typeof source?._eventDelegator?.addEventListener != 'function') return
    walk(rootVnode, (style, tag) => checkStyle(style, (key, value) => {
      const name = nameOf(component)
      if (!once(`SYG109:${name}:${key}`)) return
      devReport('SYG109', {
        component,
        message: `The view of ${name} sets style ${key} to the number ${value} on <${tag}>. A number with no unit is invalid CSS for ${key}, so the browser ignores it (Sygnal does not append px)`,
        fix: `Write a string with the unit: ${key}: \`\${value}px\``,
        data: {property: key, value, tag},
      })
    }))
  },
}
