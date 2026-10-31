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
 * Options: `popover` (required), `close` (a button inside; its click dispatches CLOSE).
 * State: { open }. Actions: OPEN, CLOSE, TOGGLE, TOGGLED (data: open, from the toggle event),
 * SYNC (G-400: the popover left the page while open: `open: false`).
 * G-400 / G-406: OPEN and CLOSE send commands that check the popover itself (`:popover-open`),
 * not the state, which follows the asynchronous toggle event: OPEN then CLOSE in one tick ends
 * closed, and a popover removed while open opens again.
 */
import {ABORT, defineBehavior} from '../index'
import {ev, find, gone, on, watch} from './shared'

const isOpen = (el: any) => { try { return el.matches(':popover-open') } catch (_) { return false } }
// the commands that make the popover match an open / closed slice (each checks the popover
// itself, G-400 / G-406)
const showing = (o: any) => ({showPopover: on(o.popover, 'showPopover', (el: any) => { isOpen(el) || el.showPopover() })})
const hiding = (o: any) => ({hidePopover: on(o.popover, 'hidePopover', (el: any) => { isOpen(el) && el.hidePopover() }, true)})
const sync = (s: any, o: any) => (s.open ? showing(o) : hiding(o))

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false},
  // SYG118 (dev): the option each action's trigger is built from (a host intent of that name replaces it)
  triggers: {CLOSE: 'close'},
  intent: ({DOM, STATE}: any, {popover: p, close}: any) => {
    const els = find(DOM, p)
    return {
      ...(close && {CLOSE: ev(DOM, close, 'click')}),
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
export const popover = (options: any = {}): any => base({...options, open: !!options.open})
