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
 * Options: `dialog` (required; 3-W G-536: it must match only this dialog, not one nested in it,
 * whose close / toggle / FAIL events it would take too), `trigger` and `close` (clicks dispatch OPEN / CLOSE), `modal`
 * (true; false opens it with show()), `cancelable` (true; false keeps Escape from closing it:
 * the cancel event is prevented, and OPEN sets closedby="none" (G-405: Chromium's CloseWatcher
 * closes on a second Escape otherwise)), `returnFocus` (true: when the dialog closes and the
 * focus was lost, which WebKit does after a mouse click, the element that opened it gets it
 * (G-407: the clicked trigger, recorded by OPEN), else the trigger; a selector names another
 * element; false: leave it to the browser. G-430: the opener is focused from the close event, so
 * a dialog rendered only while open needs no command target).
 * State: { open, returnValue }. Actions: OPEN, CLOSE (data: the returnValue), CLOSED (the close
 * event's returnValue), TOGGLED (from the toggle event), CANCEL (Escape: a host entry can react;
 * the cancel event, or with cancelable: false the Escape keydown in the dialog (G-429): closedby
 * "none" stops the cancel event, and OPEN removes the attribute again when the dialog closes;
 * G-457: not an Escape an element inside handled (defaultPrevented) or an IME one, and not for a
 * non-modal dialog, which Escape doesn't cancel either way),
 * SYNC (G-400: the dialog left the page while open: `open: false`; G-524: or OPEN's showModal()
 * threw: no close event then).
 * G-400: OPEN / CLOSE send commands that check the dialog itself (showModal only on a closed
 * one, close only on an open one), so a state that is out of step can't block them.
 */
import {ABORT, defineBehavior, xs} from '../index'
import {gone, on} from './shared'

// G-429: Escape in this dialog (not in a dialog nested in it, nor with a popover open inside it:
// Escape closes that first). G-457: not one an element inside handled (a Zag combobox or menu
// closing its list prevents it: the browser sends no cancel then either), nor one that ends an
// IME composition (Safari sends keyCode 229 with isComposing false)
const esc = (e: any) => e.key == 'Escape' && !e.defaultPrevented && !e.isComposing && e.keyCode != 229 &&
  e.target?.closest?.('dialog') == e.ownerTarget && !e.ownerTarget?.querySelector?.(':popover-open')

// the focus went nowhere: body, a detached element, or inside a dialog that just closed
const lost = () => {
  const a: any = document.activeElement
  return !a || a == document.body || !a.isConnected || !!a.closest?.('dialog:not([open])')
}
// an ELEMENT target (D102 spec command): focus `sel` only when the focus was lost
const refocus = (sel: any) => on(sel, 'focus', (el: any, o: any) => { lost() && el.focus(o) })

// G-524: OPEN's showModal() threw (bubbles: the DOM driver listens at its root)
const FAIL = 'sygnaldialogfail'

const base = /*#__PURE__*/ defineBehavior({
  initialState: {open: false, returnValue: ''},
  intent: ({DOM, STATE}: any, {dialog: d, trigger, close, cancelable, modal}: any) => ({
    ...(trigger && {OPEN: DOM.click(trigger)}),
    ...(close && {CLOSE: DOM.click(close).mapTo('')}),
    TOGGLED: DOM.toggle(d).map((e: any) => e.newState == 'open'),
    CLOSED: DOM.close(d).map((e: any) => e.target?.returnValue ?? ''),
    // G-429: with cancelable: false the dialog has closedby="none", so Escape fires no cancel
    // event: CANCEL is the Escape keydown (the cancel event, which a browser without closedby
    // still fires, is only prevented). G-457: a non-modal one (show()) gets no cancel event from
    // Escape with cancelable: true either, so no CANCEL: only its cancel event, prevented
    CANCEL: cancelable !== false
      ? DOM.select(d).events('cancel')
      : modal === false
        ? DOM.select(d).events('cancel', {preventDefault: true})
        : xs.merge(DOM.select(d).events('cancel', {preventDefault: true}).filter(() => false), DOM.select(d).events('keydown').filter(esc)),
    // G-524: SYNC also when OPEN's showModal() threw (FAIL, below; true). 3-U G-533: only this
    // behavior's dialog's own FAIL, not one bubbling from a dialog inside it (another behavior's)
    SYNC: ((f: any) => STATE ? xs.merge(gone(DOM, STATE, d, (e: any) => e.open), f) : f)(
      DOM.select(d).events(FAIL).filter((e: any) => e.target === e.ownerTarget).mapTo(true)),
  }),
  model: {
    OPEN: {
      STATE: (s: any) => (s.open ? ABORT : {...s, open: true, returnValue: ''}),
      ELEMENT: (_s: any, d: any, _n: any, _p: any, o: any) => {
        const m = o.modal === false ? 'show' : 'showModal', by = d?.ownerTarget
        return {[m]: on(o.dialog, m, (el: any) => {
          if (el.open) return
          // G-407: who opened it: the clicked trigger, else the element with the focus
          const a = document.activeElement, op: any = by?.nodeType == 1 ? by : a != document.body ? a : null
          const cb = o.cancelable === false && !el.hasAttribute('closedby')
          if (cb) el.setAttribute('closedby', 'none')
          // G-461: a showModal() that throws (a disconnected dialog, a popover open on it) leaves
          // no closedby and arms no listener (a later close would focus this opener). G-488: and
          // the state goes back to closed, so the next OPEN can open it; G-524: through SYNC (an
          // internal FAIL event), not a close event: the host's close listeners don't run for a
          // dialog that never opened, and no previous returnValue comes again. The error is the
          // command's (thrown once)
          try { el[m]() } catch (e) { cb && el.removeAttribute('closedby'); el.dispatchEvent(new Event(FAIL, {bubbles: true})); throw e }
          // on close: G-429 the closedby it set goes (it is the behavior's, not the host's); G-430
          // the element that opened it gets the focus back when it was lost, here rather than by a
          // command (a dialog the host renders only while open is gone by then), and nothing
          // keeps the opener after that. Capture: at the target it runs before the DOM driver's
          // listener, so before CLOSED (whose trigger fallback would take the focus first: a
          // browser-sent event runs the microtasks between listeners)
          el.addEventListener('close', () => {
            cb && el.removeAttribute('closedby')
            if ((o.returnFocus ?? true) === true && op?.isConnected && lost()) op.focus()
          }, {once: true, capture: true})
        })}
      },
    },
    CLOSE: {ELEMENT: (_s: any, rv: any, _n: any, _p: any, o: any) => ({close: on(o.dialog, 'close', (el: any, x: any) => { el.open && el.close(x.returnValue) }), returnValue: typeof rv == 'string' ? rv : ''})},
    TOGGLED: (s: any, open: boolean) => (open && !s.open ? {...s, open, returnValue: ''} : ABORT),
    CLOSED: {
      STATE: (s: any, returnValue: string) => (!s.open && s.returnValue === returnValue ? ABORT : {...s, open: false, returnValue}),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => {
        const f = o.returnFocus ?? true, sel = f === true ? o.trigger : f
        if (!s.open || !sel) return ABORT
        // true: the element that opened it (OPEN's close listener, G-430), else the trigger; a
        // selector: that element (each only when the focus was lost)
        return {focus: refocus(sel)}
      },
    },
    CANCEL: () => ABORT,
    // G-534: after a failed OPEN the returnValue is '' (also when OPEN's STATE aborted: the state
    // was open while the element was closed)
    SYNC: (s: any, failed: any) => (s.open ? {...s, open: false, ...(failed === true && {returnValue: ''})} : ABORT),
  },
})

/** A native <dialog> as a behavior: `uses = { help: dialog({ dialog: '.help', trigger: '.open-help', close: '.close-help' }) }`. */
export const dialog = (options: any = {}): any => base({...options, open: false, returnValue: ''})
