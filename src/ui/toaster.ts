/*
 * PLAN-5 2-U (T-1, D198, from spike 0-S4): the Toaster component.
 *
 *   anywhere:  SAVE: { EVENTS: event('TOAST', { text: 'Saved', kind: 'success' }) }
 *   once:      <Toaster />            (main.js: run(App, { TIMER: makeTimerDriver() }))
 *
 * - TOAST adds { id, text, kind ('info' | 'success' | 'warning' | 'error'; default 'info'),
 *   timeoutMs (default 5000; 0 = until dismissed) }. A string is the text. A TOAST with the `id`
 *   of a shown toast replaces it in place and restarts its timer ('Saving…' → 'Saved').
 *   TOAST_DISMISS removes the toast with that id (no id: all of them).
 * - Each toast is a Collection item: its `timers` static auto-dismisses it (GS-7; fake-timer
 *   testable), its Dismiss button removes it, Transition animates it (`transition` names the
 *   classes, `duration` is how long a leaving toast stays: the leave animation's length).
 * - Two persistent live regions: role="status" (polite) for every kind but errors, role="alert"
 *   for errors. They are rendered while empty, so a toast added later is announced.
 * - While the pointer or the focus is in the region, the timers stop (and start over when it
 *   leaves): `pauseOnHover={false}` turns this off.
 * - The region is a `popover="manual"` element (top layer, above the page), re-parented into the
 *   topmost open modal <dialog> while one is open and back when it closes or is removed (a
 *   MutationObserver in the region's hooks, D198): outside the modal it would be drawn but inert
 *   (spike 0-S4). `__sygnalHome` keeps its events in this component (G-356). The region is the
 *   only child of a wrapper (`.toaster-home`), so the moved element has no siblings to patch.
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
const topModal = () => {
  const open = [...document.querySelectorAll('dialog')].filter(modal)
  for (let i = order.length; i--;) if (!open.includes(order[i])) order.splice(i, 1)
  for (const d of open) if (!order.includes(d)) order.push(d)
  return order[order.length - 1]
}
const show = (el: any) => { try { el.matches(':popover-open') || el.showPopover() } catch (_) {} }

const placement = {
  insert: (v: any) => {
    const el = v.elm, home = el.parentNode
    el.__sygnalHome = home
    show(el)
    if (typeof MutationObserver == 'undefined') return
    const place = () => {
      const to = topModal() || home
      if (el.parentNode !== to) {
        // a move blurs a focused Dismiss button: give the focus back
        const f: any = el.contains(document.activeElement) && document.activeElement
        to.appendChild(el)
        f && f.focus()
      }
      // a moved popover is closed: show it again (on top of the dialog it is in)
      show(el)
    }
    // `open` flips on showModal / close; a dialog removed while open takes the region with it
    ;(el._mo = new MutationObserver((rs) => {
      if (home.isConnected && (!el.isConnected || (el.parentNode !== home && !modal(el.parentNode)) || rs.some((r) => r.type == 'attributes'))) place()
    })).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['open']})
    place()
  },
  // removed with its wrapper while in a dialog: take it out of the dialog too
  destroy: (v: any) => {
    const el = v.elm
    el._mo?.disconnect()
    el.parentNode !== el.__sygnalHome && el.remove()
  },
}

// ── one toast ────────────────────────────────────────────────────────
function ToastItem({state, dismissLabel, transition, duration}: any) {
  return h(Transition, {name: transition, duration},
    h('div', {className: 'toast', 'data-kind': state.kind},
      h('span', {className: 'toast-text'}, state.text),
      h('button', {type: 'button', className: 'toast-dismiss', 'aria-label': dismissLabel + ': ' + state.text}, dismissLabel)))
}
ToastItem.intent = ({DOM}: any) => ({DISMISS: DOM.click('.toast-dismiss')})
// a replaced toast (rev) gets a new timer name, so its timer starts over
;(ToastItem as any).timers = (s: any) => ({['expire' + (s?.rev || '')]: s?.timeoutMs > 0 && !s.paused && {after: s.timeoutMs, action: 'EXPIRE'}})
ToastItem.model = {DISMISS: () => undefined, EXPIRE: () => undefined}

// ── the toaster ──────────────────────────────────────────────────────
const polite = (t: any) => t.kind != 'error'
const urgent = (t: any) => t.kind == 'error'
// entering or leaving the region (not moving between its children)
const crossing = (e: any) => !e.ownerTarget?.contains?.(e.relatedTarget)
const paused = (s: any, p: boolean) => ({...s, paused: p, toasts: s.toasts.map((t: any) => ({...t, paused: p}))})

/** Renders the toasts that `event('TOAST', { text, kind, timeoutMs })` sends from anywhere. Render it once: `<Toaster />`. */
export function Toaster({state, label = 'Notifications', dismissLabel = 'Dismiss', transition = 'toast', duration = 200, className}: any) {
  const list = (filter: any) => h(Collection, {of: ToastItem, from: 'toasts', filter, className: 'toaster-list', dismissLabel, transition, duration})
  return h('div', {className: 'toaster-home'},
    h('section', {
      className: className ? 'toaster ' + className : 'toaster', 'aria-label': label, attrs: {popover: 'manual'},
      'data-paused': state.paused ? '' : undefined, hook: placement,
    },
    h('div', {className: 'toaster-status', role: 'status', 'aria-live': 'polite'}, list(polite)),
    h('div', {className: 'toaster-alert', role: 'alert'}, list(urgent))))
}
Toaster.isolatedState = true
Toaster.initialState = {toasts: [] as any[], next: 1, paused: false}
Toaster.intent = ({EVENTS, DOM}: any) => ({
  TOAST: EVENTS.select('TOAST'),
  DISMISS: EVENTS.select('TOAST_DISMISS'),
  PAUSE: xs.merge(DOM.pointerover('.toaster'), DOM.focusin('.toaster')).filter(crossing),
  RESUME: xs.merge(DOM.pointerout('.toaster'), DOM.focusout('.toaster')).filter(crossing),
})
Toaster.model = {
  TOAST: (s: any, d: any) => {
    const t = typeof d == 'string' ? {text: d} : d || {}
    const i = t.id == null ? -1 : s.toasts.findIndex((x: any) => x.id === t.id)
    const toast = {...t, id: t.id ?? s.next, kind: t.kind || 'info', timeoutMs: t.timeoutMs ?? 5000, paused: s.paused, rev: i < 0 ? 0 : s.toasts[i].rev + 1}
    return {
      ...s,
      next: t.id == null ? s.next + 1 : s.next,
      toasts: i < 0 ? [...s.toasts, toast] : s.toasts.map((x: any, j: number) => (j == i ? toast : x)),
    }
  },
  DISMISS: (s: any, id: any) => {
    const toasts = id == null ? [] : s.toasts.filter((x: any) => x.id !== id)
    return toasts.length == s.toasts.length ? ABORT : {...s, toasts}
  },
  PAUSE: (s: any, _d: any, _n: any, p: any) => (p.pauseOnHover === false || s.paused ? ABORT : paused(s, true)),
  RESUME: (s: any) => (s.paused ? paused(s, false) : ABORT),
}
