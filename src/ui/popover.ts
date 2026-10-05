/*
 * PLAN-5 2-U (S-3, from spike 0-S3): Popover, a behavior over the Popover API.
 *
 *   Filters.uses = { filters: popover({ popover: '.filters', close: '.filters-done' }) }
 *   <button popovertarget={uid('filters')}>Filters</button>
 *   <div className="filters" id={uid('filters')} popover="auto">…</div>
 *
 * The browser does the work: a `popovertarget` button opens and closes it, sets aria-expanded,
 * light-dismisses it (a click outside, Escape) and returns the focus. The behavior mirrors
 * `open` from the popover's toggle event and adds OPEN / CLOSE / TOGGLE for the model (ELEMENT
 * showPopover / hidePopover / togglePopover). Open it from elsewhere with a host intent:
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
import {gone, on} from './shared'

const isOpen = (el: any) => { try { return el.matches(':popover-open') } catch (_) { return false } }

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false},
  intent: ({DOM, STATE}: any, {popover: p, close}: any) => ({
    ...(close && {CLOSE: DOM.click(close)}),
    TOGGLED: DOM.toggle(p).map((e: any) => e.newState == 'open'),
    ...(STATE && {SYNC: gone(DOM, STATE, p, isOpen)}),
  }),
  model: {
    OPEN: {ELEMENT: (_s: any, _d: any, _n: any, _p: any, o: any) => ({showPopover: on(o.popover, 'showPopover', (el: any) => { isOpen(el) || el.showPopover() })})},
    CLOSE: {ELEMENT: (_s: any, _d: any, _n: any, _p: any, o: any) => ({hidePopover: on(o.popover, 'hidePopover', (el: any) => { isOpen(el) && el.hidePopover() })})},
    TOGGLE: {ELEMENT: (_s: any, _d: any, _n: any, _p: any, o: any) => ({togglePopover: o.popover})},
    TOGGLED: (s: any, open: boolean) => (s.open == open ? ABORT : {...s, open}),
    SYNC: (s: any) => (s.open ? {...s, open: false} : ABORT),
  },
})

/** A popover (Popover API) as a behavior: `uses = { filters: popover({ popover: '.filters' }) }`. */
export const popover = (options: any = {}): any => base({...options, open: false})
