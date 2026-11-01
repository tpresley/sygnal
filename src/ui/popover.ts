/*
 * PLAN-5 2-U (S-3, from spike 0-S3): Popover, a behavior over the Popover API.
 *
 *   Filters.uses = { filters: popover({ popover: '.filters', close: '.filters-done' }) }
 *   <button popovertarget={uid('filters')}>Filters</button>
 *   <div className="filters" id={uid('filters')} popover="auto">…</div>
 *
 * The browser does the work: a `popovertarget` button opens and closes it, sets aria-expanded,
 * light-dismisses it (a click outside, Escape) and returns the focus. ui-sweep R2: `open` is the
 * source of truth (Radix's controlled `open`): OPEN / CLOSE / TOGGLE and a host reducer that writes
 * it show or hide the popover (ELEMENT showPopover / hidePopover; APPLY for a host write), and the
 * toggle event writes it back (TOGGLED; a host entry that keeps the other value shows or hides it
 * again). R4: the popover may be in a <Portal> the host renders. Open it from elsewhere with a host intent:
 * `'filters.OPEN': DOM.click('.edit-filters')`. (No `trigger` option: a button that toggles an
 * auto popover through the model reopens it, because the press outside light-dismisses it first;
 * `popovertarget` buttons are exempt.)
 *
 * Round 3: with the `open` option given it is controlled (Radix's open / onOpenChange): a manual
 * popover the browser never dismisses; the layer stack (layers.ts) turns Escape, a press and a
 * focus outside into DISMISS (top layer first), and its popovertarget buttons / commandfor
 * commands are prevented and dispatched as TOGGLE / OPEN / CLOSE, so a host entry that keeps
 * `open: true` keeps it shown with no frame hidden. Uncontrolled ones keep the light dismiss.
 *
 * Options: `popover` (required), `close` (a button inside; its click dispatches CLOSE), `open`.
 * State: { open }. Actions: OPEN, CLOSE, TOGGLE, DISMISS (controlled), TOGGLED (data: open, from the toggle event),
 * SYNC (G-400: the popover left the page while open: `open: false`).
 * G-400 / G-406: OPEN and CLOSE send commands that check the popover itself (`:popover-open`),
 * not the state, which follows the asynchronous toggle event: OPEN then CLOSE in one tick ends
 * closed, and a popover removed while open opens again.
 */
import {ABORT, defineBehavior, xs} from '../index'
import {DISMISS, pull, push} from './layers'
import {ev, find, gone, on, watch} from './shared'

// a popovertarget button's popover
const tgt = (b: any) => b?.popoverTargetElement ?? document.getElementById(b?.getAttribute?.('popovertarget'))
const isOpen = (el: any) => { try { return el.matches(':popover-open') } catch (_) { return false } }
// round 3: a controlled popover (its `open` option given) is a manual one on the layer stack: the
// browser never dismisses it, an Escape / a press or a focus outside comes as DISMISS (layers.ts)
const layer = (el: any) => {
  push(el, {ctl: true, esc: true, out: true})
  const end = (e: any) => { e.newState == 'closed' && (pull(el), el.removeEventListener('toggle', end)) }
  el.addEventListener('toggle', end)
}
// the commands that make the popover match an open / closed slice (each checks the popover
// itself, G-400 / G-406)
const showing = (o: any) => ({showPopover: on(o.popover, 'showPopover', (el: any) => {
  if (isOpen(el)) return
  // (set while closed: changing it hides an open one)
  o.controlled && el.getAttribute('popover') != 'manual' && el.setAttribute('popover', 'manual')
  el.showPopover()
  o.controlled && layer(el)
})})
// (off the layer stack at once: its toggle event comes after)
const hiding = (o: any) => ({hidePopover: on(o.popover, 'hidePopover', (el: any) => { pull(el); isOpen(el) && el.hidePopover() }, true)})
const sync = (s: any, o: any) => (s.open ? showing(o) : hiding(o))

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false},
  // SYG118 (dev): the option each action's trigger is built from (a host intent of that name replaces it)
  triggers: {CLOSE: 'close'},
  intent: ({DOM, STATE}: any, {popover: p, close, controlled}: any) => {
    const els = find(DOM, p)
    // round 3, controlled: its popovertarget buttons and commandfor commands go through the model
    // (prevented: the browser would show / hide it itself), as OPEN / CLOSE / TOGGLE
    const ours = (e: any) => !!tgt(e.ownerTarget)?.matches?.('' + p)
    const cmd = (e: any) => e.target === e.ownerTarget && /^(show|hide|toggle)-popover$/.test(e.command)
    const asks = controlled ? xs.merge(
      ev(DOM, '[popovertarget]', 'click', {preventDefault: ours}).filter(ours).map((e: any) => e.ownerTarget.getAttribute('popovertargetaction') || 'toggle'),
      ev(DOM, p, 'command', {preventDefault: cmd}, false).filter(cmd).map((e: any) => e.command.split('-')[0]),
    ) : xs.never()
    const ask = (a: string) => asks.filter((x: string) => x == a)
    return {
      ...(controlled && {
        OPEN: ask('show'),
        TOGGLE: ask('toggle'),
        DISMISS: ev(DOM, p, DISMISS, {}, false).filter((e: any) => e.target === e.ownerTarget).map((e: any) => e.detail),
      }),
      ...((close || controlled) && {CLOSE: xs.merge(close ? ev(DOM, close, 'click') : xs.never(), ask('hide'))}),
      // (R2: a toggle the popover has moved on from since is dropped)
      TOGGLED: ev(DOM, p, 'toggle', {}, false).filter((e: any) => !(typeof Element != 'undefined' && e.target instanceof Element) || isOpen(e.target) == (e.newState == 'open')).map((e: any) => e.newState == 'open'),
      ...(STATE && {SYNC: gone(els, STATE), APPLY: watch(els, STATE, isOpen)}),
    }
  },
  // R2: `open` is the source of truth; every entry that can change it sends the commands for the
  // slice it ends with (the host's entries for the same action included)
  model: {
    OPEN: {STATE: (s: any) => (s.open ? ABORT : {...s, open: true}), ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? showing(o) : ABORT)},
    CLOSE: {STATE: (s: any) => (s.open ? {...s, open: false} : ABORT), ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? ABORT : hiding(o))},
    // round 3: a controlled popover's Escape / press outside / focus outside (data: that event);
    // a host entry that keeps `open: true` keeps it shown (it was never hidden)
    DISMISS: {STATE: (s: any) => (s.open ? {...s, open: false} : ABORT), ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? ABORT : hiding(o))},
    TOGGLE: {STATE: (s: any) => ({...s, open: !s.open}), ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => sync(s, o)},
    // the browser opened or closed it (popovertarget, light dismiss, Escape); a host entry that
    // keeps the other value opens or closes it again (a light dismiss can't be prevented)
    TOGGLED: {
      STATE: (s: any, open: boolean) => (s.open == open ? ABORT : {...s, open}),
      ELEMENT: (s: any, open: boolean, _n: any, _p: any, o: any) => (s.open == open ? ABORT : sync(s, o)),
    },
    SYNC: (s: any) => (s.open ? {...s, open: false} : ABORT),
    APPLY: {ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => sync(s, o)},
  },
})

/** A popover (Popover API) as a behavior: `uses = { filters: popover({ popover: '.filters' }) }`. */
export const popover = (options: any = {}): any => base({...options, open: !!options.open, controlled: options.open !== undefined})
