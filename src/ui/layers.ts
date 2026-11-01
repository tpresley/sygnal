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
 * - focus outside: as pointerdown, without the modal floor (Radix's onFocusOutside)
 *
 * Every dialog a dialog behavior opens is a layer too (uncontrolled: `ctl` false), so Escape and
 * pointers know what is on top; an uncontrolled dialog keeps its own Escape (covered() below).
 */
export const DISMISS = 'sygnaldismiss'

// a layer: its element, whether the stack dismisses it (ctl), on Escape (esc), on a press or a
// focus outside (out), whether it is modal, and the selector of a trigger whose press isn't outside
type Layer = {el: any; ctl?: boolean; esc?: boolean; out?: boolean; modal?: boolean; trigger?: any}

// (one stack per page, shared by every copy of sygnal/ui)
const G: any = globalThis, stack: Layer[] = (G[Symbol.for('sygnal.layers')] ||= [])

// G-579: an open popover Escape closes before the layer it is in: an auto or hint one (the
// `popover` property: an engine without hint reads it as manual; the attribute where there is
// none). Not a manual one (a Toaster region moved into a modal, D198; a tooltip)
export const first = (p: any) => { try { return /^(auto|hint|)$/i.test(p.popover ?? p.getAttribute('popover')) && p.matches(':popover-open') } catch (_) { return false } }

// a <Portal>'s content → its placeholder (core/markers/portal.ts names the content `__portal`)
const owners = () => {
  const m = new Map()
  for (const p of document.querySelectorAll('[data-sygnal-portal]') as any) (p as any).__portal && m.set((p as any).__portal, p)
  return m
}
/** `n` is in `a`: in its DOM, in a shadow root in it, or in a <Portal> rendered in it */
export const within = (a: any, n: any, m = owners()): boolean => {
  for (; n; n = m.get(n) || n.parentElement || n.parentNode?.host) if (n === a) return true
  return false
}

const on = (f: boolean) => {
  const x = f ? 'addEventListener' : 'removeEventListener'
  document[x]('pointerdown', down, true)
  document[x]('focusin', focus, true)
  document[x]('keydown', key)
}
// (a layer the page no longer has is dropped; its close event never came)
const prune = () => {
  for (let i = stack.length; i--;) stack[i].el.isConnected || stack.splice(i, 1)
  stack.length || on(false)
}
/** `el` opened: on top of the stack (again) */
export const push = (el: any, l: Omit<Layer, 'el'>) => {
  pull(el)
  stack.push({el, ...l}) == 1 && on(true)
}
/** `el` closed */
export const pull = (el: any) => {
  const i = stack.findIndex((l) => l.el === el)
  i < 0 || (stack.splice(i, 1), stack.length || on(false))
}

/** a layer opened over `el` and inside it is open (its Escape is that layer's) */
export const covered = (el: any) => {
  prune()
  const m = owners()
  return stack.slice(stack.findIndex((l) => l.el === el) + 1).some((l) => l.el !== el && within(el, l.el, m))
}

const fire = (l: Layer, e: Event) => l.el.dispatchEvent(new CustomEvent(DISMISS, {detail: e, bubbles: true}))

// the target is outside the layer: not in it, nor its own trigger; a modal dialog's ::backdrop
// (a press on the dialog outside its box) is outside
const outside = (l: Layer, t: any, e: any, m: any) => {
  const b = t?.closest?.('[popovertarget],[commandfor]'), id = b && (b.getAttribute('popovertarget') || b.getAttribute('commandfor'))
  if ((id && id === l.el.id) || (l.trigger && t?.closest?.('' + l.trigger))) return false
  if (t === l.el && l.el.localName == 'dialog') {
    const r = t.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }
  return !within(l.el, t, m)
}
const away = (e: any, floor: number) => {
  prune()
  const t = e.composedPath?.()[0] ?? e.target, m = owners(), ls = stack.slice(floor)
  for (let i = ls.length; i--;) ls[i].ctl && ls[i].out && outside(ls[i], t, e, m) && fire(ls[i], e)
}
// (Radix: a touch press dismisses on the click that follows it, so a scroll gesture that starts
// outside doesn't; the next press drops a click that never came)
let tap: any
function down(e: any) {
  let f = 0
  stack.forEach((l, i) => { l.modal && (f = i) })
  document.removeEventListener('click', tap, true)
  tap = () => away(e, f)
  e.pointerType == 'touch' ? document.addEventListener('click', tap, {capture: true, once: true}) : tap()
}
function focus(e: any) { away(e, 0) }
function key(e: any) {
  if (e.key != 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode == 229) return
  prune()
  const l = stack[stack.length - 1], m = owners()
  l?.ctl && l.esc && ![...(document.querySelectorAll('[popover]') as any)].some((p) => first(p) && within(l.el, p, m)) && fire(l, e)
}
