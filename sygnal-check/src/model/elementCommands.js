/**
 * Element commands (PLAN-4 GS-2): the commands a component's model sends on the built-in
 * ELEMENT sink, read from the literal command objects its ELEMENT sink values produce.
 *
 *   OPEN_HELP: { ELEMENT: { showModal: HelpDialog } }
 *   SUBMIT:    { ELEMENT: (s) => (s.errors.email ? { focus: Email } : ABORT) }
 *   ADD:       { ELEMENT: [{ focus: Draft }, { scrollIntoView: Row, block: 'nearest' }] }
 *
 * The FIRST key of a command object is the method, the other keys are its options (D118). The
 * target is a control (resolved through controls()) or a selector string.
 *
 *   analyzeCommands(project, comp) → Command[]
 *   Command = { action, method, methodNode, node (the command object), file,
 *               control: Control | null, selector: string | null, targetNode, dynamic,
 *               widgetTag: Widget | null (a defineWidget() tag as the target: SYG143) }
 *
 * The lists mirror the runtime (src/extra/diagnostics/checks/elementCommands.ts); a drift test
 * (test/commands-timers.vtest.js) reads that file.
 */
import { unwrap, isFunction, propName, stringValue } from '../ast.js'
import { resolveExpr } from './resolve.js'
import { returnedExpressions } from './intent.js'
import { resolveControl } from './controls.js'
import { resolveWidget } from './widgets.js'

/** The element commands Sygnal documents and types (the core runs any method of the element, D133) */
export const NATIVE_COMMAND_NAMES = ['focus', 'blur', 'select', 'click', 'scrollIntoView', 'showModal', 'show', 'close', 'showPopover', 'hidePopover', 'togglePopover']

/** Methods that change the DOM snabbdom owns: the dev entry reports them at send (SYG641) */
export const DOM_MUTATORS = /^(remove|append|prepend|before|after|replaceWith|replaceChildren|appendChild|removeChild|insertBefore|replaceChild|insertAdjacent(Element|HTML|Text)|(set|remove|toggle)Attribute(NS|Node)?|attachShadow|setHTML(Unsafe)?|normalize)$/

/**
 * Other methods of DOM elements a command may run (D133: any element method runs). A name close
 * to a documented command but in this list is not a misspelling (close / closest, select / reset).
 */
export const ELEMENT_METHODS = new Set([
  // HTMLElement / Element
  'animate', 'attachInternals', 'checkVisibility', 'closest', 'computedStyleMap', 'dispatchEvent', 'getAnimations',
  'hasPointerCapture', 'matches', 'releasePointerCapture', 'requestFullscreen', 'requestPointerLock', 'scroll',
  'scrollBy', 'scrollTo', 'setPointerCapture', 'requestClose',
  // media
  'play', 'pause', 'load', 'fastSeek', 'canPlayType', 'addTextTrack', 'captureStream', 'requestPictureInPicture', 'setSinkId',
  // forms and fields
  'reset', 'submit', 'requestSubmit', 'checkValidity', 'reportValidity', 'setCustomValidity', 'showPicker',
  'stepUp', 'stepDown', 'setSelectionRange', 'setRangeText',
  // canvas, details, others
  'getContext', 'toBlob', 'toDataURL', 'transferControlToOffscreen',
])

/** Native events a command makes the element fire (an intent may listen to them: DOM.close(Dialog)) */
export const CAUSED_EVENTS = {
  showModal: ['cancel', 'close', 'toggle', 'beforetoggle'],
  show: ['close', 'toggle', 'beforetoggle'],
  close: ['close', 'toggle', 'beforetoggle'],
  showPopover: ['toggle', 'beforetoggle'],
  hidePopover: ['toggle', 'beforetoggle'],
  togglePopover: ['toggle', 'beforetoggle'],
  focus: ['focus', 'focusin', 'blur', 'focusout'],
  blur: ['blur', 'focusout'],
  select: ['select'],
  click: ['click', 'input', 'change'],
  scrollIntoView: ['scroll', 'scrollend'],
}

/** Object literals a sink value produces: itself, a function's returns, through ?: && || , and arrays */
function commandObjects(project, file, valueNode) {
  const r = resolveExpr(project, file, valueNode)
  if (!r?.node) return []
  const out = []
  const collect = (e, depth = 0) => {
    e = unwrap(e)
    if (!e || depth > 6) return
    if (e.type === 'ConditionalExpression') { collect(e.consequent, depth + 1); collect(e.alternate, depth + 1); return }
    if (e.type === 'LogicalExpression') { collect(e.right, depth + 1); if (e.operator !== '&&') collect(e.left, depth + 1); return }
    if (e.type === 'SequenceExpression') { collect(e.expressions[e.expressions.length - 1], depth + 1); return }
    if (e.type === 'ArrayExpression') { for (const x of e.elements) if (x && x.type !== 'SpreadElement') collect(x, depth + 1); return }
    if (e.type === 'ObjectExpression') out.push({ node: e, file: r.file })
  }
  if (isFunction(r.node)) returnedExpressions(r.node).forEach(x => collect(x))
  else collect(r.node)
  return out
}

/** The ELEMENT commands of a component's model (literal command objects only). */
export function analyzeCommands(project, comp) {
  const out = []
  for (const sv of comp.model?.sinkValues || []) {
    if (sv.sink !== 'ELEMENT') continue
    for (const { node, file } of commandObjects(project, sv.file, sv.node)) {
      const first = node.properties[0]
      if (!first || first.type !== 'ObjectProperty') continue   // a spread or a method first: unknown
      const method = propName(first)
      if (method == null) continue
      const targetNode = unwrap(first.value)
      const control = resolveControl(project, file, targetNode)
      const selector = control ? null : stringValue(targetNode)
      // PLAN-5 W-1: a widget tag as the target matches nothing (SYG143, rules/syg140-widgets.js)
      const widgetTag = control || selector != null ? null : resolveWidget(project, file, targetNode)
      out.push({
        action: sv.action, method, methodNode: first.key, node, file,
        control, selector, targetNode, dynamic: !control && selector == null, widgetTag,
      })
    }
  }
  return out
}
