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
 * State: { open, pending: null | 'show' | 'hide', hover, focus }. Actions: ENTER / LEAVE (data
 * 'hover' | 'focus': the pointer on the trigger or the tip (it stays open while hovered, WCAG
 * 1.4.13), or the focus on the trigger), SHOW / HIDE (the timers), ESCAPE (hides it at once),
 * TOGGLED. Timers (joined to the host's `timers`): '<key>.show' / '<key>.hide'; one whose state
 * goes away is cancelled, so leaving before the delay never shows the tip. Needs
 * makeTimerDriver() (tests: fake timers).
 * G-403: the pointer and the focus are tracked apart (it hides once both have left: a mouse
 * leaving doesn't hide a tip the keyboard focus still shows); touch pointer events are ignored
 * (a tap focuses the trigger instead); the document keydown listener for Escape is there only
 * while the tip is shown or about to be, so a page of tooltips has at most the open one's.
 */
import {ABORT, defineBehavior, dropRepeats, xs} from '../index'

const mouse = (e: any) => e?.pointerType != 'touch'
const which = (k: any) => (k == 'focus' ? 'focus' : 'hover')

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false, pending: null as null | string, hover: false, focus: false},
  timers: (s: any, o: any) => ({
    show: s?.pending == 'show' && {after: o.showDelay ?? 500, action: 'SHOW'},
    hide: s?.pending == 'hide' && {after: o.hideDelay ?? 100, action: 'HIDE'},
  }),
  intent: ({DOM, STATE}: any, {trigger, tip}: any) => ({
    ENTER: xs.merge(xs.merge(DOM.pointerenter(trigger), DOM.pointerenter(tip)).filter(mouse).mapTo('hover'), DOM.focus(trigger).mapTo('focus')),
    LEAVE: xs.merge(xs.merge(DOM.pointerleave(trigger), DOM.pointerleave(tip)).filter(mouse).mapTo('hover'), DOM.blur(trigger).mapTo('focus')),
    ESCAPE: (STATE ? STATE.stream.map((s: any) => !!(s?.open || s?.pending)).compose(dropRepeats()) : xs.of(true))
      .map((on: boolean) => (on ? DOM.keydown('document').key().filter((k: string) => k == 'Escape') : xs.never()))
      .flatten(),
    TOGGLED: DOM.toggle(tip).map((e: any) => e.newState == 'open'),
  }),
  model: {
    ENTER: (s: any, k: any) => {
      const n = {...s, [which(k)]: true}, pending = s.open ? null : 'show'
      return s[which(k)] && s.pending == pending ? ABORT : {...n, pending}
    },
    LEAVE: (s: any, k: any) => {
      const n = {...s, [which(k)]: false}
      // still hovered or focused: as it was
      const pending = n.hover || n.focus ? s.pending : s.open ? 'hide' : null
      return !s[which(k)] && s.pending == pending ? ABORT : {...n, pending}
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
export const tooltip = (options: any = {}): any => base({...options, open: false, pending: null, hover: false, focus: false})
