/*
 * PLAN-5 2-U (T-1, D198, from spike 0-S4): the Toaster component.
 *
 *   anywhere:  SAVE: { EVENTS: event('TOAST', { text: 'Saved', kind: 'success' }) }
 *   once:      <Toaster />            (main.js: run(App, { TIMER: makeTimerDriver() }))
 *
 * - TOAST adds { id, text, kind ('info' | 'success' | 'warning' | 'error'; default 'info'),
 *   timeoutMs (default 5000; 0 = until dismissed) }. A string is the text. A TOAST with the `id`
 *   of a shown toast replaces it in place and restarts its timer ('Saving…' → 'Saved').
 *   TOAST_DISMISS removes the toast with that id (no id: all of them). G-398: ids compare as
 *   strings (the Collection's keys); an automatic id is 't<n>', never one a shown toast has.
 * - Each toast is a Collection item: its `timers` static auto-dismisses it (GS-7; fake-timer
 *   testable), its Dismiss button removes it, Transition animates it (`transition` names the
 *   classes, `duration` is how long a leaving toast stays: the leave animation's length).
 * - Two persistent live regions: role="status" (polite) for every kind but errors, role="alert"
 *   for errors. They are rendered while empty, so a toast added later is announced.
 * - While the pointer or the focus is in the region, the timers stop (and start over when both
 *   have left; G-399: `hover` and `focus` are tracked apart): `pauseOnHover={false}` turns this
 *   off. A focused Dismiss button moves the focus to the next toast's (else the previous one's,
 *   else where the focus came from) before its toast goes; a focused element removed any other
 *   way gets a focusout sent (Chromium sends none), so the region never stays paused.
 * - The region is a `popover="manual"` element (top layer, above the page), re-parented into the
 *   topmost open modal <dialog> while one is open and back when it closes or is removed (a
 *   MutationObserver in the region's hooks, D198): outside the modal it would be drawn but inert
 *   (spike 0-S4). `__sygnalHome` keeps its events in this component (G-356). The region is the
 *   only child of a wrapper (`.toaster-home`), so the moved element has no siblings to patch.
 *   G-404: the dialogs of the region's own root (a shadow root) are looked at and observed too.
 *   G-426: the focus is that root's activeElement (in a shadow root the document's is the host).
 *
 * Class hooks: .toaster-home, .toaster (+ `className`), .toaster-status, .toaster-alert,
 * .toaster-list, .toast, .toast-text, .toast-dismiss. Data attributes: data-kind on .toast,
 * data-paused on .toaster.
 */
import {ABORT, Collection, Transition, createElement as h, xs} from '../index'

// ── the region's placement (D198) ────────────────────────────────────
// the open modal dialogs, in the order they became modal (the last one is on top)
const order: any[] = []
const modal = (d: any) => { try { return d.matches(':modal') } catch (_) { return false } }
// G-404: the dialogs of the document and of the region's own root (a shadow root: sygnal/element)
const topModal = (root: any) => {
  const all = [...document.querySelectorAll('dialog')]
  if (root !== document && root?.querySelectorAll) all.push(...root.querySelectorAll('dialog'))
  const open = all.filter(modal)
  for (let i = order.length; i--;) if (!open.includes(order[i])) order.splice(i, 1)
  for (const d of open) if (!order.includes(d)) order.push(d)
  return order[order.length - 1]
}
const show = (el: any) => { try { el.matches(':popover-open') || el.showPopover() } catch (_) {} }
// the element with the focus in `el`'s root
const act = (el: any) => (el.getRootNode?.() || document).activeElement
// G-428: a focusout that leaves `t`: not to an element inside it, and with no relatedTarget not
// while the focus is still inside (the window lost the focus: it comes back to the same element)
const left = (t: any, e: any) => !(t && t.contains?.(e.relatedTarget || act(t)))
// a toast on its way out (its Transition's leave classes)
const leaving = (b: any) => /-leave-/.test(b.closest?.('.toast')?.className || '')

const placement = {
  insert: (v: any) => {
    const el = v.elm, home = el.parentNode, root = el.getRootNode?.() || document
    el.__sygnalHome = home
    show(el)
    // G-399: the focus in the region, and where it came from (where it goes back to)
    el.addEventListener('focusin', (e: any) => { if (!el.contains(e.relatedTarget)) { el._f = 1; el._from = e.relatedTarget } })
    el.addEventListener('focusout', (e: any) => { if (left(el, e)) el._f = 0 })
    // a Dismiss button with the focus (keyboard; a click that focused it): the focus moves to the
    // next toast's Dismiss button, else the previous one's, else back where it came from, before
    // the button goes (a removed focused element gets no focusout in Chromium)
    el.addEventListener('click', (e: any) => {
      const b = e.target?.closest?.('.toast-dismiss')
      // G-426: the root's activeElement (in a shadow root, the document's is the host)
      if (!b || !b.contains(act(el))) return
      const bs = [...el.querySelectorAll('.toast-dismiss')].filter((x: any) => x === b || !leaving(x)), i = bs.indexOf(b)
      const to: any = bs[i + 1] || bs[i - 1] || (el._from?.isConnected && !el.contains(el._from) && el._from)
      to ? to.focus() : b.blur()
    })
    if (typeof MutationObserver == 'undefined') return
    const place = () => {
      const to = topModal(root) || home
      if (el.parentNode !== to) {
        // a move blurs a focused Dismiss button: give the focus back
        const a = act(el), f: any = el.contains(a) && a
        to.appendChild(el)
        f && f.focus()
      }
      // a moved popover is closed: show it again (on top of the dialog it is in)
      show(el)
    }
    // `open` flips on showModal / close; a dialog removed while open takes the region with it
    const mo = el._mo = new MutationObserver((rs) => {
      // G-399: the focused element was removed (a toast dismissed some other way): no focusout
      // in Chromium, so the region would stay paused; send one
      if (el._f && !el.contains(act(el))) { el._f = 0; el.dispatchEvent(new FocusEvent('focusout', {bubbles: true})) }
      if (home.isConnected && (!el.isConnected || (el.parentNode !== home && !modal(el.parentNode)) || rs.some((r) => r.type == 'attributes'))) place()
    })
    const opts = {subtree: true, childList: true, attributes: true, attributeFilter: ['open']}
    mo.observe(document.body, opts)
    // G-404: a region in a shadow root sees that root's dialogs open and close too
    if (root !== document && root.nodeType == 11) mo.observe(root, opts)
    place()
  },
  // removed with its wrapper while in a dialog: take it out of the dialog too
  destroy: (v: any) => {
    const el = v.elm
    el._mo?.disconnect()
    el.parentNode !== el.__sygnalHome && el.remove()
  },
}

// ── one toast ──────────────────────────────────────────────────────
// (statics through a /*#__PURE__*/ Object.assign, so every bundler drops an unused Toaster; a
// componentName, so diagnostics and DevTools name them in minified builds too)
const ToastItem = /*#__PURE__*/ Object.assign(function ToastItem({state, dismissLabel, transition, duration}: any) {
  return h(Transition, {name: transition, duration},
    h('div', {className: 'toast', 'data-kind': state.kind},
      h('span', {className: 'toast-text'}, state.text),
      h('button', {type: 'button', className: 'toast-dismiss', 'aria-label': dismissLabel + ': ' + state.text}, dismissLabel)))
}, {
  componentName: 'ToastItem',
  intent: ({DOM}: any) => ({DISMISS: DOM.click('.toast-dismiss')}),
  // a replaced toast (rev) gets a new timer name, so its timer starts over
  timers: (s: any) => ({['expire' + (s?.rev || '')]: s?.timeoutMs > 0 && !s.paused && {after: s.timeoutMs, action: 'EXPIRE'}}),
  model: {DISMISS: () => undefined, EXPIRE: () => undefined},
})

// ── the toaster ──────────────────────────────────────────────────────
const polite = (t: any) => t.kind != 'error'
const urgent = (t: any) => t.kind == 'error'
// entering or leaving the region (not moving between its children)
const crossing = (e: any) => !e.ownerTarget?.contains?.(e.relatedTarget)
const paused = (s: any, p: boolean) => ({...s, paused: p, toasts: s.toasts.map((t: any) => ({...t, paused: p}))})
// the pointer or the focus came in or left: paused while either is in (unless pauseOnHover={false})
const pause = (s: any, k: string, on: boolean, p: any) => {
  if (s[k] === on) return ABORT
  const n = {...s, [k]: on}, z = p.pauseOnHover !== false && !!(n.hover || n.focus)
  return z === s.paused ? n : paused(n, z)
}
// ids compare as strings (the Collection's keys do: 7 and '7' are one toast)
const same = (a: any, b: any) => '' + a === '' + b

/** Renders the toasts that `event('TOAST', { text, kind, timeoutMs })` sends from anywhere. Render it once: `<Toaster />`. */
export const Toaster = /*#__PURE__*/ Object.assign(function Toaster({state, label = 'Notifications', dismissLabel = 'Dismiss', transition = 'toast', duration = 200, className}: any) {
  const list = (filter: any) => h(Collection, {of: ToastItem, from: 'toasts', filter, className: 'toaster-list', dismissLabel, transition, duration})
  return h('div', {className: 'toaster-home'},
    h('section', {
      className: className ? 'toaster ' + className : 'toaster', 'aria-label': label, attrs: {popover: 'manual'},
      'data-paused': state.paused ? '' : undefined, hook: placement,
    },
    h('div', {className: 'toaster-status', role: 'status', 'aria-live': 'polite'}, list(polite)),
    h('div', {className: 'toaster-alert', role: 'alert'}, list(urgent))))
}, {
  componentName: 'Toaster',
  isolatedState: true,
  initialState: {toasts: [] as any[], next: 1, paused: false, hover: false, focus: false},
  intent: ({EVENTS, DOM}: any) => ({
    TOAST: EVENTS.select('TOAST'),
    DISMISS: EVENTS.select('TOAST_DISMISS'),
    // G-399: the pointer and the focus apart (the timers stop while either is in the region)
    HOVER: xs.merge(DOM.pointerover('.toaster').filter(crossing).mapTo(true), DOM.pointerout('.toaster').filter(crossing).mapTo(false)),
    FOCUS: xs.merge(DOM.focusin('.toaster').filter(crossing).mapTo(true), DOM.focusout('.toaster').filter((e: any) => left(e.ownerTarget, e)).mapTo(false)),
  }),
  model: {
    TOAST: (s: any, d: any) => {
      const t = typeof d == 'string' ? {text: d} : d || {}
      // G-398: an automatic id is 't<n>', one no shown toast has (a user's 2 or '2' never meets it)
      const i = t.id == null ? -1 : s.toasts.findIndex((x: any) => same(x.id, t.id))
      let n = s.next, id = t.id
      if (id == null) { while (s.toasts.some((x: any) => same(x.id, 't' + n))) n++; id = 't' + n++ }
      const toast = {...t, id, kind: t.kind || 'info', timeoutMs: t.timeoutMs ?? 5000, paused: s.paused, rev: i < 0 ? 0 : s.toasts[i].rev + 1}
      return {
        ...s,
        next: n,
        toasts: i < 0 ? [...s.toasts, toast] : s.toasts.map((x: any, j: number) => (j == i ? toast : x)),
      }
    },
    DISMISS: (s: any, id: any) => {
      const toasts = id == null ? [] : s.toasts.filter((x: any) => !same(x.id, id))
      return toasts.length == s.toasts.length ? ABORT : {...s, toasts}
    },
    HOVER: (s: any, on: boolean, _n: any, p: any) => pause(s, 'hover', on, p),
    FOCUS: (s: any, on: boolean, _n: any, p: any) => pause(s, 'focus', on, p),
  },
})
