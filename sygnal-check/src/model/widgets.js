/**
 * Widgets (PLAN-5 W-1): `defineWidget({ tag, mount, update, unmount, events, commands })`, and
 * (W-2) the adapters' widgets: `fromZag(zag, render, { events, commands })` from 'sygnal/zag',
 * `fromReact(Comp, { events, commands })` from 'sygnal/react', and the Menu / Select / Combobox
 * tags of 'sygnal/ui/menu', 'sygnal/ui/select' and 'sygnal/ui/combobox' (D211; one subpath per part).
 *
 * A widget tag (`<DatePicker className="due" />`) renders its host element in the scope of the
 * view that uses it (it is not a child component), so its className/id count for SYG110/SYG640
 * and its host tag for the a11y rules (an `input`-hosted widget needs a label: SYG702).
 *
 *   resolveWidget(project, file, node) → Widget | null    an expression naming a defineWidget() result
 *   resolveWidgetJSX(project, file, opening) → Widget | null
 *   Widget = { name, element, kind: 'widget', events: string[] | null, commands: string[] | null, file, call,
 *              def (the definition object literal, or null) }
 *     element  the literal `tag` ('div' when there is none), null when it isn't a literal
 *     events / commands  null when they aren't literals the checker can list
 */
import { walk, unwrap, propName, stringValue } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr, bindingValue } from './resolve.js'

const SYGNAL_MODULE = /^sygnal(\/|$)/

// PLAN-5 W-2: the adapters make widgets too. The function, its module, and the index of the
// argument with the definition / options (tag, events, commands)
const MAKERS = {
  defineWidget: [SYGNAL_MODULE, 0],
  fromZag: [/^sygnal\/zag$/, 2],     // fromZag(zag, render, { events: { name: 'onX' }, commands })
  fromReact: [/^sygnal\/react$/, 1], // fromReact(Comp, { events: { name: 'onX' } | ['onX'], commands })
}

/** the index of the definition argument of a widget-making call (defineWidget, fromZag, fromReact), or -1 */
function defIndex(file, node) {
  node = unwrap(node)
  if (node?.type !== 'CallExpression') return -1
  const callee = unwrap(node.callee)
  if (callee?.type !== 'Identifier') return -1
  const b = findBinding(file, callee.name, callee)
  const m = b && b.kind === 'import' && Object.hasOwn(MAKERS, b.imported) && MAKERS[b.imported]
  return m && m[0].test(b.source) ? m[1] : -1
}

export function isDefineWidgetCall(file, node) {
  return defIndex(file, node) >= 0
}

// PLAN-5 2-Z: the widget tags of the Zag UI parts (div hosts): their subpath (D211), events and commands
export const UI_ZAG = {
  Menu: ['sygnal/ui/menu', ['select', 'open-change'], ['open', 'close']],
  Select: ['sygnal/ui/select', ['value-change', 'open-change'], ['open', 'close', 'clear', 'focus']],
  Combobox: ['sygnal/ui/combobox', ['value-change', 'input-change', 'open-change'], ['open', 'close', 'clear', 'focus']],
}
/** the part ('Menu', 'Select', 'Combobox') a binding imported from its ui subpath names, or null */
export function uiZagPart(b) {
  const w = b && b.kind === 'import' && Object.hasOwn(UI_ZAG, b.imported) && UI_ZAG[b.imported]
  return w && b.source === w[0] ? b.imported : null
}
/** the Widget a binding imported from a Zag part's ui subpath names, or null */
function uiZagWidget(b, name) {
  const part = uiZagPart(b), w = part && UI_ZAG[part].slice(1)
  return w ? { name, element: 'div', kind: 'widget', events: w[0], commands: w[1], file: null, call: null, def: null } : null
}

// names of an object literal's keys, or of an array literal's strings; null when not literal
function names(v, array) {
  v = unwrap(v)
  if (!v) return []
  if (array) {
    if (v.type !== 'ArrayExpression') return null
    const out = []
    for (const e of v.elements) { const s = stringValue(e); if (s == null) return null; out.push(s) }
    return out
  }
  if (v.type !== 'ObjectExpression') return null
  const out = []
  for (const p of v.properties) { const n = p.type === 'SpreadElement' ? null : propName(p); if (n == null) return null; out.push(n) }
  return out
}

const cache = new WeakMap() // call → Widget

export function widgetOfCall(file, call, name) {
  if (cache.has(call)) return cache.get(call)
  const i = Math.max(0, defIndex(file, call))
  const def = unwrap(call.arguments[i])
  let element = 'div', events = null, commands = null
  if (def?.type === 'ObjectExpression') {
    events = []; commands = []
    for (const p of def.properties) {
      if (p.type === 'SpreadElement') { events = commands = element = null; break }
      const k = propName(p)
      const v = p.type === 'ObjectProperty' ? p.value : null
      if (k === 'tag') element = stringValue(v)
      // an adapter's events: an object (event name → callback) or, for fromReact, an array
      else if (k === 'events') events = i && unwrap(v)?.type !== 'ArrayExpression' ? names(v) : names(v, true)
      else if (k === 'commands') commands = v ? names(v) : null
    }
  } else if (i && !def) events = [], commands = []   // an adapter without options: no events
  else element = null
  const w = { name, element, kind: 'widget', events, commands, file, call, def: def?.type === 'ObjectExpression' ? def : null }
  cache.set(call, w)
  return w
}

/** The widget an expression (Identifier, member, import) refers to, or null. */
export function resolveWidget(project, file, node) {
  const z = node?.type === 'Identifier' && uiZagWidget(findBinding(file, node.name, node), node.name)
  if (z) return z
  const r = resolveExpr(project, file, node)
  if (!r || !isDefineWidgetCall(r.file, r.node)) return null
  return widgetOfCall(r.file, unwrap(r.node), node.name || null)
}

/** The widget a JSX tag (<DatePicker>) renders, or null. */
export function resolveWidgetJSX(project, file, opening) {
  const n = opening.name
  if (n.type !== 'JSXIdentifier' || !/^[A-Z]/.test(n.name)) return null
  const b = findBinding(file, n.name, opening)
  const z = uiZagWidget(b, n.name)
  if (z) return z
  const r = bindingValue(project, file, b)
  if (!r || !isDefineWidgetCall(r.file, r.node)) return null
  return widgetOfCall(r.file, unwrap(r.node), n.name)
}

/**
 * Event names the browser fires on (or bubbles through) any element: a widget host hears them
 * natively (GlobalEventHandlers; the dev entry tests `'on' + name in el`).
 */
export const NATIVE_EVENTS = new Set((
  'abort animationcancel animationend animationiteration animationstart auxclick beforeinput beforetoggle blur ' +
  'cancel canplay canplaythrough change click close compositionend compositionstart compositionupdate contextmenu ' +
  'copy cuechange cut dblclick drag dragend dragenter dragleave dragover dragstart drop durationchange emptied ' +
  'ended error focus focusin focusout formdata gotpointercapture input invalid keydown keypress keyup load ' +
  'loadeddata loadedmetadata loadstart lostpointercapture mousedown mouseenter mouseleave mousemove mouseout ' +
  'mouseover mouseup paste pause play playing pointercancel pointerdown pointerenter pointerleave pointermove ' +
  'pointerout pointerover pointerup progress ratechange reset resize scroll scrollend seeked seeking select ' +
  'selectionchange selectstart slotchange stalled submit suspend timeupdate toggle touchcancel touchend touchmove ' +
  'touchstart transitioncancel transitionend transitionrun transitionstart volumechange waiting wheel'
).split(' '))

/** Every defineWidget() call in a file: Widget[] (named after the variable it is assigned to) */
export function widgetsInFile(file) {
  const out = []
  walk(file.ast.program, (n, parent) => {
    if (n.type === 'CallExpression' && isDefineWidgetCall(file, n)) {
      out.push(widgetOfCall(file, n, parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' ? parent.id.name : null))
    }
    return true
  })
  return out
}
