/*
 * PLAN-5 2-U (S-3, from spike 0-S3): Dialog, a behavior over a native <dialog>.
 *
 *   Settings.uses = { prefs: dialog({ dialog: '.prefs', trigger: '.open-prefs', close: '.close-prefs' }) }
 *
 * The host renders the <dialog> (aria-labelledby its heading) and its buttons. OPEN calls
 * showModal() through ELEMENT: the browser traps the focus, makes the page inert, closes on
 * Escape and returns the focus. `open` / `returnValue` follow the dialog's own close event,
 * whichever way it closed (a close button, Escape, a form method="dialog", closedby="any"), and
 * its toggle event when it opened without the model (commandfor="…" command="show-modal").
 *
 * Options: `dialog` (required), `trigger` and `close` (clicks dispatch OPEN / CLOSE), `modal`
 * (true; false opens it with show()), `cancelable` (true; false keeps Escape from closing it:
 * the cancel event is prevented, and OPEN sets closedby="none" (G-405: Chromium's CloseWatcher
 * closes on a second Escape otherwise)), `returnFocus` (true: when the dialog closes and the
 * focus was lost, which WebKit does after a mouse click, the element that opened it gets it
 * (G-407: the clicked trigger, recorded by OPEN), else the trigger; a selector names another
 * element; false: leave it to the browser).
 * State: { open, returnValue }. Actions: OPEN, CLOSE (data: the returnValue), CLOSED (the close
 * event's returnValue), TOGGLED (from the toggle event), CANCEL (Escape: a host entry can react),
 * SYNC (G-400: the dialog left the page while open: `open: false`).
 * G-400: OPEN / CLOSE send commands that check the dialog itself (showModal only on a closed
 * one, close only on an open one), so a state that is out of step can't block them.
 */
import {ABORT, defineBehavior} from '../index'
import {gone, on} from './shared'

// the focus went nowhere: body, a detached element, or inside a dialog that just closed
const lost = () => {
  const a: any = document.activeElement
  return !a || a == document.body || !a.isConnected || !!a.closest?.('dialog:not([open])')
}
// an ELEMENT target (D102 spec command): focus `sel` only when the focus was lost
const refocus = (sel: any) => on(sel, 'focus', (el: any, o: any) => { lost() && el.focus(o) })
// G-407: the element that opened the dialog (OPEN records it on the dialog), when the focus was lost
const opener = (sel: any) => on(sel, 'focus', (d: any, o: any) => { lost() && d._opener?.isConnected && d._opener.focus(o) })

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false, returnValue: ''},
  intent: ({DOM, STATE}: any, {dialog: d, trigger, close, cancelable}: any) => ({
    ...(trigger && {OPEN: DOM.click(trigger)}),
    ...(close && {CLOSE: DOM.click(close).mapTo('')}),
    TOGGLED: DOM.toggle(d).map((e: any) => e.newState == 'open'),
    CLOSED: DOM.close(d).map((e: any) => e.target?.returnValue ?? ''),
    CANCEL: DOM.select(d).events('cancel', {preventDefault: cancelable === false}),
    ...(STATE && {SYNC: gone(DOM, STATE, d, (e: any) => e.open)}),
  }),
  model: {
    OPEN: {
      STATE: (s: any) => (s.open ? ABORT : {...s, open: true, returnValue: ''}),
      ELEMENT: (_s: any, d: any, _n: any, _p: any, o: any) => {
        const m = o.modal === false ? 'show' : 'showModal', by = d?.ownerTarget
        return {[m]: on(o.dialog, m, (el: any) => {
          if (el.open) return
          // G-407: who opened it: the clicked trigger, else the element with the focus
          const a = document.activeElement
          el._opener = by?.nodeType == 1 ? by : a != document.body ? a : null
          if (o.cancelable === false && !el.hasAttribute('closedby')) el.setAttribute('closedby', 'none')
          el[m]()
        })}
      },
    },
    CLOSE: {ELEMENT: (_s: any, rv: any, _n: any, _p: any, o: any) => ({close: on(o.dialog, 'close', (el: any, x: any) => { el.open && el.close(x.returnValue) }), returnValue: typeof rv == 'string' ? rv : ''})},
    TOGGLED: (s: any, open: boolean) => (open && !s.open ? {...s, open, returnValue: ''} : ABORT),
    CLOSED: {
      STATE: (s: any, returnValue: string) => (!s.open && s.returnValue === returnValue ? ABORT : {...s, open: false, returnValue}),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => {
        const f = o.returnFocus ?? true, sel = f === true ? o.trigger : f
        if (!s.open || f === false) return ABORT
        // true: the element that opened it, else the trigger (each only when the focus was lost)
        return f === true ? [{focus: opener(o.dialog)}, ...(sel ? [{focus: refocus(sel)}] : [])] : {focus: refocus(sel)}
      },
    },
    CANCEL: () => ABORT,
    SYNC: (s: any) => (s.open ? {...s, open: false} : ABORT),
  },
})

/** A native <dialog> as a behavior: `uses = { help: dialog({ dialog: '.help', trigger: '.open-help', close: '.close-help' }) }`. */
export const dialog = (options: any = {}): any => base({...options, open: false, returnValue: ''})
