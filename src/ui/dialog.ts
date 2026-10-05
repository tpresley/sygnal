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
 * the cancel event is prevented), `returnFocus` (true: when the dialog closes and the focus was
 * lost, which WebKit does after a mouse click, the trigger gets it; a selector names another
 * element; false: leave it to the browser).
 * State: { open, returnValue }. Actions: OPEN, CLOSE (data: the returnValue), CLOSED (the close
 * event's returnValue), TOGGLED (from the toggle event), CANCEL (Escape: a host entry can react).
 */
import {ABORT, defineBehavior} from '../index'

// the focus went nowhere: body, a detached element, or inside a dialog that just closed
const lost = () => {
  const a: any = document.activeElement
  return !a || a == document.body || !a.isConnected || !!a.closest?.('dialog:not([open])')
}
// an ELEMENT target (D102 spec command): focus `sel` only when the focus was lost
const refocus = (sel: any) => ({toString: () => '' + sel, spec: {commands: {focus: (el: any, o: any) => { lost() && el.focus(o) }}}})

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false, returnValue: ''},
  intent: ({DOM}: any, {dialog: d, trigger, close, cancelable}: any) => ({
    ...(trigger && {OPEN: DOM.click(trigger)}),
    ...(close && {CLOSE: DOM.click(close).mapTo('')}),
    TOGGLED: DOM.toggle(d).map((e: any) => e.newState == 'open'),
    CLOSED: DOM.close(d).map((e: any) => e.target?.returnValue ?? ''),
    CANCEL: DOM.select(d).events('cancel', {preventDefault: cancelable === false}),
  }),
  model: {
    // ELEMENT entries get the state before the action: no second showModal on an open dialog
    OPEN: {
      STATE: (s: any) => (s.open ? ABORT : {...s, open: true, returnValue: ''}),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? ABORT : {[o.modal === false ? 'show' : 'showModal']: o.dialog}),
    },
    CLOSE: {ELEMENT: (s: any, rv: any, _n: any, _p: any, o: any) => (s.open ? {close: o.dialog, returnValue: typeof rv == 'string' ? rv : ''} : ABORT)},
    TOGGLED: (s: any, open: boolean) => (open && !s.open ? {...s, open, returnValue: ''} : ABORT),
    CLOSED: {
      STATE: (s: any, returnValue: string) => (!s.open && s.returnValue === returnValue ? ABORT : {...s, open: false, returnValue}),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => {
        const f = o.returnFocus ?? true, sel = f === true ? o.trigger : f
        return s.open && sel ? {focus: refocus(sel)} : ABORT
      },
    },
    CANCEL: () => ABORT,
  },
})

/** A native <dialog> as a behavior: `uses = { help: dialog({ dialog: '.help', trigger: '.open-help', close: '.close-help' }) }`. */
export const dialog = (options: any = {}): any => base({...options, open: false, returnValue: ''})
