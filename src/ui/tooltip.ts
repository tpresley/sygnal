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
 * 1.4.13), or the keyboard focus on the trigger: ui-sweep, a :focus-visible one, not the focus a
 * mouse click gives), SHOW / HIDE (the timers), ESCAPE (hides it at once),
 * TOGGLED. Timers (joined to the host's `timers`): '<key>.show' / '<key>.hide'; one whose state
 * goes away is cancelled, so leaving before the delay never shows the tip. Needs
 * makeTimerDriver() (tests: fake timers).
 * R3 (ui-sweep): a pointerdown on the trigger hides the tip at once (PRESS; `pressed`), and the
 * pointer shows it again only after leaving and coming back, as Radix does: a click on a button
 * doesn't leave its tip up (also WebKit's, under a modal the click opened).
 * G-403: the pointer and the focus are tracked apart (it hides once both have left: a mouse
 * leaving doesn't hide a tip the keyboard focus still shows); touch pointer events are ignored
 * (a tap focuses the trigger instead); the document keydown listener for Escape is there only
 * while the tip is shown or about to be, so a page of tooltips has at most the open one's.
 */
import {ABORT, defineBehavior, dropRepeats, xs} from '../index'
import {ev, visible} from './shared'

const mouse = (e: any) => e?.pointerType != 'touch'
const which = (k: any) => (k == 'focus' ? 'focus' : 'hover')

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false, pending: null as null | string, hover: false, focus: false, pressed: false},
  // SYG118 (dev): the option each action's trigger is built from (a host intent of that name replaces it)
  triggers: {ENTER: 'trigger', LEAVE: 'trigger', PRESS: 'trigger'},
  timers: (s: any, o: any) => ({
    show: s?.pending == 'show' && {after: o.showDelay ?? 500, action: 'SHOW'},
    hide: s?.pending == 'hide' && {after: o.hideDelay ?? 100, action: 'HIDE'},
  }),
  intent: ({DOM, STATE}: any, {trigger, tip}: any) => ({
    // (R4: ev(): the trigger and the tip may be in a <Portal>)
    ENTER: xs.merge(xs.merge(ev(DOM, trigger, 'pointerenter'), ev(DOM, tip, 'pointerenter')).filter(mouse).mapTo('hover'), ev(DOM, trigger, 'focus').filter(visible).mapTo('focus')),
    LEAVE: xs.merge(xs.merge(ev(DOM, trigger, 'pointerleave'), ev(DOM, tip, 'pointerleave')).filter(mouse).mapTo('hover'), ev(DOM, trigger, 'blur').mapTo('focus')),
    // R3: a press on the trigger hides the tip (Radix)
    PRESS: ev(DOM, trigger, 'pointerdown'),
    ESCAPE: (STATE ? STATE.stream.map((s: any) => !!(s?.open || s?.pending)).compose(dropRepeats()) : xs.of(true))
      .map((on: boolean) => (on ? DOM.keydown('document').key().filter((k: string) => k == 'Escape') : xs.never()))
      .flatten(),
    TOGGLED: ev(DOM, tip, 'toggle', {}, false).map((e: any) => e.newState == 'open'),
  }),
  model: {
    ENTER: (s: any, k: any) => {
      // R3: after a press the pointer shows it again only once it has left and come back
      if (s.pressed && k != 'focus') return s.hover ? ABORT : {...s, hover: true}
      const n = {...s, [which(k)]: true}, pending = s.open ? null : 'show'
      return s[which(k)] && s.pending == pending ? ABORT : {...n, pending}
    },
    PRESS: {
      STATE: (s: any) => (s.pressed && !s.pending ? ABORT : {...s, pending: null, pressed: true}),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? {hidePopover: o.tip} : ABORT),
    },
    LEAVE: (s: any, k: any) => {
      const n = {...s, [which(k)]: false, ...(k != 'focus' && {pressed: false})}
      // still hovered or focused: as it was
      const pending = n.hover || n.focus ? s.pending : s.open ? 'hide' : null
      return !s[which(k)] && s.pending == pending && n.pressed == s.pressed ? ABORT : {...n, pending}
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
export const tooltip = (options: any = {}): any => base({...options, open: false, pending: null, hover: false, focus: false, pressed: false})
