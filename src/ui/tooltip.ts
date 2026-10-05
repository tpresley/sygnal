/*
 * PLAN-5 2-U (S-3, from spike 0-S3): Tooltip, a manual popover placed by CSS anchor positioning,
 * shown on hover / focus after a delay and hidden after a delay (D197 `timers`).
 *
 *   Toolbar.uses = { saveTip: tooltip({ trigger: '.save', tip: '.save-tip' }) }
 *
 * The host renders the trigger with aria-describedby (the tip's id) and `anchor-name`, and the
 * tip with role="tooltip", popover="manual", `position-anchor` and `position-area` (styles; see
 * the guide). No JavaScript positioning.
 *
 * Options: `trigger`, `tip` (required), `showDelay` (500 ms), `hideDelay` (100 ms).
 * State: { open, pending: null | 'show' | 'hide' }. Actions: ENTER / LEAVE (pointer or focus on
 * the trigger, pointer on the tip: it stays open while hovered, WCAG 1.4.13), SHOW / HIDE (the
 * timers), ESCAPE (hides it at once), TOGGLED. Timers (joined to the host's `timers`):
 * '<key>.show' / '<key>.hide'; one whose state goes away is cancelled, so leaving before the
 * delay never shows the tip. Needs makeTimerDriver() (tests: fake timers).
 */
import {ABORT, defineBehavior, xs} from '../index'

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false, pending: null as null | string},
  timers: (s: any, o: any) => ({
    show: s?.pending == 'show' && {after: o.showDelay ?? 500, action: 'SHOW'},
    hide: s?.pending == 'hide' && {after: o.hideDelay ?? 100, action: 'HIDE'},
  }),
  intent: ({DOM}: any, {trigger, tip}: any) => ({
    ENTER: xs.merge(DOM.pointerenter(trigger), DOM.focus(trigger), DOM.pointerenter(tip)),
    LEAVE: xs.merge(DOM.pointerleave(trigger), DOM.blur(trigger), DOM.pointerleave(tip)),
    ESCAPE: DOM.keydown('document').key().filter((k: string) => k == 'Escape'),
    TOGGLED: DOM.toggle(tip).map((e: any) => e.newState == 'open'),
  }),
  model: {
    ENTER: (s: any) => {
      const pending = s.open ? null : 'show'
      return s.pending == pending ? ABORT : {...s, pending}
    },
    LEAVE: (s: any) => {
      const pending = s.open ? 'hide' : null
      return s.pending == pending ? ABORT : {...s, pending}
    },
    SHOW: {
      STATE: (s: any) => ({...s, pending: null}),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? ABORT : {showPopover: o.tip}),
    },
    HIDE: {
      STATE: (s: any) => ({...s, pending: null}),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? {hidePopover: o.tip} : ABORT),
    },
    ESCAPE: {
      STATE: (s: any) => (s.open || s.pending ? {...s, pending: null} : ABORT),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? {hidePopover: o.tip} : ABORT),
    },
    TOGGLED: (s: any, open: boolean) => (s.open == open ? ABORT : {...s, open}),
  },
})

/** A tooltip as a behavior: `uses = { tip: tooltip({ trigger: '.save', tip: '.save-tip', showDelay: 500 }) }`. */
export const tooltip = (options: any = {}): any => base({...options, open: false, pending: null})
