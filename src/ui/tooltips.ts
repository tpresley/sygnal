/*
 * PLAN-11 T-1: Tooltips, one behavior for every tooltip of a component (glossary terms in a
 * paragraph, icon buttons in a toolbar): one state slice and two timers however many triggers
 * there are, instead of a tooltip() per trigger.
 *
 *   Article.uses = { tips: tooltips({ trigger: '.term', tip: '.term-tip' }) }
 *
 * Each trigger names its tip with aria-describedby (the tip's id); the tips are `role="tooltip"
 * popover="manual"` elements placed by CSS anchor positioning, as for tooltip(). One tip shows at
 * a time. Moving from one trigger to another while a tip is shown switches at once (no second
 * show delay), as tooltip groups do.
 *
 * Options: `trigger`, `tip` (required selectors matching every trigger / every tip),
 * `showDelay` (500 ms), `hideDelay` (100 ms).
 * State: { id (the tip of the trigger or tip last entered), open (the id of the tip shown),
 * pending: null | 'show' | 'hide', hover, focus }. Actions: ENTER / LEAVE ({ via: 'hover' |
 * 'focus', id }), SHOW / HIDE (the timers), ESCAPE, TOGGLED ({ id, open }). Timers
 * '<key>.show' / '<key>.hide' as tooltip()'s. Needs makeTimerDriver() (tests: fake timers).
 * Same rules as tooltip(): pointer and focus tracked apart (keyboard focus only), touch ignored, hovering the tip keeps
 * it open (WCAG 1.4.13), Escape listened for only while a tip is shown or about to be; R3: a press
 * on a trigger hides its tip until the pointer leaves and comes back.
 */
import {ABORT, defineBehavior, dropRepeats, xs} from '../index'
import {ev, visible} from './shared'

const mouse = (e: any) => e?.pointerType != 'touch'
const el = (e: any) => e?.ownerTarget || e?.currentTarget || e?.target
// the trigger's tip id (its aria-describedby: the first id when it lists several), or the tip's own
const tipOf = (e: any) => String(el(e)?.getAttribute?.('aria-describedby') || '').trim().split(/\s+/)[0] || null
const idOf = (e: any) => el(e)?.id || null
const at = (id: string) => `[id="${id.replace(/["\\]/g, '\\$&')}"]`

const base = /*#__PURE__*/ defineBehavior({
  initialState: {id: null as null | string, open: null as null | string, pending: null as null | string, hover: false, focus: false, pressed: false},
  // SYG118 (dev): the option each action's trigger is built from (a host intent of that name replaces it)
  triggers: {ENTER: 'trigger', LEAVE: 'trigger', PRESS: 'trigger'},
  timers: (s: any, o: any) => ({
    show: s?.pending == 'show' && {after: o.showDelay ?? 500, action: 'SHOW'},
    hide: s?.pending == 'hide' && {after: o.hideDelay ?? 100, action: 'HIDE'},
  }),
  intent: ({DOM, STATE}: any, {trigger, tip}: any) => ({
    ENTER: xs.merge(
      ev(DOM, trigger, 'pointerenter').filter(mouse).map((e: any) => ({via: 'hover', id: tipOf(e)})),
      ev(DOM, tip, 'pointerenter').filter(mouse).map((e: any) => ({via: 'hover', id: idOf(e)})),
      ev(DOM, trigger, 'focus').filter(visible).map((e: any) => ({via: 'focus', id: tipOf(e)})),
    ).filter((x: any) => !!x.id),
    LEAVE: xs.merge(
      ev(DOM, trigger, 'pointerleave').filter(mouse).map((e: any) => ({via: 'hover', id: tipOf(e)})),
      ev(DOM, tip, 'pointerleave').filter(mouse).map((e: any) => ({via: 'hover', id: idOf(e)})),
      ev(DOM, trigger, 'blur').map((e: any) => ({via: 'focus', id: tipOf(e)})),
    ).filter((x: any) => !!x.id),
    // R3: a press on a trigger hides the tip (Radix)
    PRESS: ev(DOM, trigger, 'pointerdown').map((e: any) => ({id: tipOf(e)})),
    ESCAPE: (STATE ? STATE.stream.map((s: any) => !!(s?.open || s?.pending)).compose(dropRepeats()) : xs.of(true))
      .map((on: boolean) => (on ? DOM.keydown('document').key().filter((k: string) => k == 'Escape') : xs.never()))
      .flatten(),
    TOGGLED: ev(DOM, tip, 'toggle', {}, false).map((e: any) => ({id: idOf(e), open: e.newState == 'open'})).filter((x: any) => !!x.id),
  }),
  model: {
    ENTER: {
      STATE: (s: any, {via, id}: any) => {
        const k = via == 'focus' ? 'focus' : 'hover'
        // another trigger: it takes over (a tip already shown switches at once, in ELEMENT)
        if (id != s.id) return {...s, id, hover: k == 'hover', focus: k == 'focus', pressed: false, pending: s.open ? null : 'show'}
        // R3: after a press the pointer shows it again only once it has left and come back
        if (s.pressed && k == 'hover') return s.hover ? ABORT : {...s, hover: true}
        const pending = s.open == id ? null : 'show'
        return s[k] && s.pending == pending ? ABORT : {...s, [k]: true, pending}
      },
      // 7.0: outputs get the updated slice; "another trigger than before" reads the previous one
      ELEMENT: (s: any, {id}: any, _n: any, p: any, _o: any, k: string) => {
        const w = p?.previousState ? p.previousState[k] : s
        return id != w.id && w.open && w.open != id ? [{hidePopover: at(w.open)}, {showPopover: at(id)}] : ABORT
      },
    },
    PRESS: {
      STATE: (s: any, {id}: any) => (s.pressed && s.id == id && !s.pending ? ABORT : {...s, id, pending: null, pressed: true}),
      ELEMENT: (s: any) => (s.open ? {hidePopover: at(s.open)} : ABORT),
    },
    LEAVE: (s: any, {via, id}: any) => {
      if (id != s.id) return ABORT
      const k = via == 'focus' ? 'focus' : 'hover'
      const n = {...s, [k]: false, ...(k == 'hover' && {pressed: false})}
      const pending = n.hover || n.focus ? s.pending : s.open ? 'hide' : null
      return !s[k] && s.pending == pending && n.pressed == s.pressed ? ABORT : {...n, pending}
    },
    SHOW: {
      STATE: (s: any) => ({...s, pending: null}),
      ELEMENT: (s: any) => (!s.id || s.open == s.id ? ABORT : s.open ? [{hidePopover: at(s.open)}, {showPopover: at(s.id)}] : {showPopover: at(s.id)}),
    },
    HIDE: {
      STATE: (s: any) => ({...s, pending: null}),
      ELEMENT: (s: any) => (s.open ? {hidePopover: at(s.open)} : ABORT),
    },
    ESCAPE: {
      STATE: (s: any) => (s.open || s.pending ? {...s, pending: null} : ABORT),
      ELEMENT: (s: any) => (s.open ? {hidePopover: at(s.open)} : ABORT),
    },
    TOGGLED: (s: any, {id, open}: any) => (open ? (s.open == id ? ABORT : {...s, open: id}) : s.open == id ? {...s, open: null} : ABORT),
  },
})

/** Every tooltip of a component as one behavior: `uses = { tips: tooltips({ trigger: '.term', tip: '.term-tip' }) }`. */
export const tooltips = (options: any = {}): any => base({...options, id: null, open: null, pending: null, hover: false, focus: false, pressed: false})
