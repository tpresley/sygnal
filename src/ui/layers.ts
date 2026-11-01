/*
 * ui-sweep round 3: dismissable layers, as Radix's DismissableLayer. A controlled dialog or
 * popover (its `open` option given) doesn't let the browser dismiss it: it is a manual popover /
 * a dialog with closedby="none", and the layer stack here turns an Escape, a pointerdown outside
 * and a focus moving outside into a `sygnaldismiss` event on its element (detail: that event),
 * which the behavior's intent makes its close request (popover DISMISS, dialog CANCEL). The
 * element closes only when the state says so: a host entry that keeps it open keeps it open, with
 * no frame where it is hidden.
 *
 * - Escape: only the top layer (and not while an auto / hint popover inside it is open: the
 *   browser closes that one first, G-579), and not one an element handled (defaultPrevented)
 * - pointerdown outside (touch: at the click after it, as Radix): every layer the target is outside of, top first; a target inside a layer
 *   opened in it (in its DOM, or in a <Portal> rendered in it) is inside. Layers under a modal
 *   dialog get none (the page under it is inert); a press on a layer's own popovertarget /
 *   commandfor button is not outside (its click opens or closes it through the model)
 * - focus outside: as pointerdown, without the modal floor (Radix's onFocusOutside); round 4: not
 *   the focus a press moves (one dismissal per interaction: the pointerdown's)
 * - round 4: an open Zag part (Menu, Select, Combobox: zag/shared.ts layered()) is a layer the
 *   stack doesn't dismiss (Zag does), anchored at its widget's host: a press in it is inside the
 *   layers its host is in, and Escape is its own while it is on top
 *
 * Every dialog a dialog behavior opens is a layer too (uncontrolled: `ctl` false), so Escape and
 * pointers know what is on top; an uncontrolled dialog keeps its own Escape (covered() below).
 */
import {all, docOf, evt} from './dom'
import {add, pull, S} from './stack'

export {pull}
export const DISMISS = 'sygnaldismiss'

// a layer: its element, whether the stack dismisses it (ctl), on Escape (esc), on a press or a
// focus outside (out), whether it is modal, the selector of a trigger whose press isn't outside,
// and (round 4) its anchor: the element that places it in the page when its element is elsewhere
// (a Zag part's content: the widget's host), so it is inside the layers its anchor is inside
type Layer = {el: any; ctl?: boolean; esc?: boolean; out?: boolean; modal?: boolean; trigger?: any; anchor?: any}

// (one stack per page: stack.ts; the listeners are installed once per document, by the first
// sygnal/ui copy that opens a layer in it, and stay)
const stack: Layer[] = S.stack

// G-579: an open popover Escape closes before the layer it is in: an auto or hint one (the
// `popover` property: an engine without hint reads it as manual; the attribute where there is
// none). Not a manual one (a Toaster region moved into a modal, D198; a tooltip)
export const first = (p: any) => { try { return /^(auto|hint|)$/i.test(p.popover ?? p.getAttribute('popover')) && p.matches(':popover-open') } catch (_) { return false } }

// a <Portal>'s content → its placeholder (core/markers/portal.ts names the content `__portal`),
// in `n`'s document and root (round 6)
const owners = (n: any) => {
  const m = new Map()
  for (const p of all(n, '[data-sygnal-portal]')) p.__portal && m.set(p.__portal, p)
  return m
}
/** `n` is in `a`: in its DOM, in a shadow root in it, or in a <Portal> rendered in it */
export const within = (a: any, n: any, m = owners(a)): boolean => {
  for (; n; n = m.get(n) || n.parentElement || n.parentNode?.host) if (n === a) return true
  return false
}
// `n` is in the layer at `i`: in its element, or in a layer above it whose anchor is in it (Radix:
// a nested layer is inside its parent wherever it renders)
const inside = (i: number, n: any, m: any): boolean => {
  if (within(stack[i].el, n, m)) return true
  for (let j = i + 1; j < stack.length; j++) { const l = stack[j]; if (l.anchor && within(l.el, n, m) && inside(i, l.anchor, m)) return true }
  return false
}

// (a layer the page no longer has is dropped; its close event never came)
const prune = () => { for (let i = stack.length; i--;) stack[i].el.isConnected || stack.splice(i, 1) }
/** `el` opened: on top of the stack (again) */
export const push = (el: any, l: Omit<Layer, 'el'>) => {
  add(el, l)
  // (round 6: once per document: the element's own, a host tree's or an iframe's)
  const d = docOf(el), on = S.docs ||= new WeakSet()
  if (!d?.addEventListener || on.has(d)) return
  on.add(d)
  const end = () => { S.press = 0 }
  d.addEventListener('pointerdown', down, true)
  d.addEventListener('focusin', focus, true)
  d.addEventListener('keydown', key)
  // the end of a press (round 4: the focus a press moves is that press's, not a second dismissal)
  for (const t of ['click', 'pointercancel', 'keydown']) d.addEventListener(t, end, true)
}

/** a layer opened over `el` and inside it is open (its Escape is that layer's) */
export const covered = (el: any) => {
  prune()
  const m = owners(el), i = stack.findIndex((l) => l.el === el)
  return stack.slice(i + 1).some((l) => l.el !== el && (within(el, l.el, m) || (l.anchor && within(el, l.anchor, m))))
}

const fire = (l: Layer, e: Event) => l.el.dispatchEvent(evt(l.el, DISMISS, {detail: e, bubbles: true}, 'CustomEvent'))

// the target is outside the layer at `i`: not in it, nor its own trigger; a modal dialog's
// ::backdrop (a press on the dialog outside its box) is outside
const outside = (i: number, t: any, e: any, m: any) => {
  const l = stack[i], b = t?.closest?.('[popovertarget],[commandfor]'), id = b && (b.getAttribute('popovertarget') || b.getAttribute('commandfor'))
  if ((id && id === l.el.id) || (l.trigger && t?.closest?.('' + l.trigger))) return false
  // (a host tree has no boxes: a press on the dialog itself is inside it)
  if (t === l.el && l.el.localName == 'dialog' && t.getBoundingClientRect) {
    const r = t.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }
  return !inside(i, t, m)
}
const away = (e: any, floor: number) => {
  prune()
  const t = e.composedPath?.()[0] ?? e.target, m = owners(t), out: Layer[] = []
  // (decided for every layer before any is dismissed: a dismissal may change the stack)
  for (let i = stack.length; i-- > floor;) stack[i].ctl && stack[i].out && outside(i, t, e, m) && out.push(stack[i])
  out.forEach((l) => fire(l, e))
}
// (Radix: a touch press dismisses on the click that follows it, so a scroll gesture that starts
// outside doesn't; the next press drops a click that never came)
function down(e: any) {
  let f = 0
  stack.forEach((l, i) => { l.modal && (f = i) })
  S.press = 1
  const d = docOf(e.target)
  d.removeEventListener('click', S.tap, true)
  S.tap = () => away(e, f)
  e.pointerType == 'touch' ? d.addEventListener('click', S.tap, {capture: true, once: true}) : S.tap()
}
// a focus outside, not one a press moved (round 4: one dismissal per interaction, the press's,
// as Radix reports pointerdownoutside first)
function focus(e: any) { S.press || away(e, 0) }
function key(e: any) {
  if (e.key != 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode == 229) return
  prune()
  // (the top layer only: a Zag part's, which Zag closes itself, or an uncontrolled dialog's, which
  // has its own Escape, takes it)
  const l = stack[stack.length - 1], m = l && owners(l.el)
  l?.ctl && l.esc && !all(l.el, '[popover]').some((p) => first(p) && within(l.el, p, m)) && fire(l, e)
}
