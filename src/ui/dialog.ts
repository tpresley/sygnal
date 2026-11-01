/*
 * PLAN-5 2-U (S-3, from spike 0-S3): Dialog, a behavior over a native <dialog>.
 *
 *   Settings.uses = { prefs: dialog({ dialog: '.prefs', trigger: '.open-prefs', close: '.close-prefs' }) }
 *
 * The host renders the <dialog> (aria-labelledby its heading) and its buttons. OPEN calls
 * showModal() through ELEMENT: the browser traps the focus, makes the page inert and returns the
 * focus. ui-sweep R2: `open` is the source of truth (Radix's controlled `open` / `onOpenChange`):
 * a host reducer that writes it opens or closes the dialog (APPLY), and everything that would
 * close it asks the model first, prevented: Escape (closedby="none" + the keydown) and a light
 * dismiss as CANCEL, the close button, a method="dialog" form and commandfor "close" as CLOSE, so
 * a host entry that keeps `open: true` keeps it open without it ever closing. A close the browser
 * makes on its own comes as CLOSED (a host entry keeping it open opens it again); an open
 * without the model as TOGGLED. R4: the dialog may be in a <Portal> the host renders. Round 3:
 * with the `open` option given (controlled) the browser never dismisses it (closedby="none" while
 * open, whatever the host set): the layer stack (layers.ts) does, by what the host's closedby
 * names (Escape; "any": a press or a focus outside too), as CANCEL, top layer first.
 *
 * Options: `dialog` (required; 3-W G-536: it must match only this dialog, not one nested in it,
 * whose close / toggle / FAIL events it would take too), `trigger` and `close` (clicks dispatch OPEN / CLOSE), `modal`
 * (true; false opens it with show()), `cancelable` (true; false: CANCEL leaves the state open),
 * `open` (R2: the start, false), `returnFocus` (true: when the dialog closes and the
 * focus was lost, which WebKit does after a mouse click, the element that opened it gets it
 * (G-407: the clicked trigger, recorded by OPEN), else the trigger; a selector names another
 * element; false: leave it to the browser. G-430: the opener is focused from the close event, or
 * (R2) when the host stops rendering the open dialog, so it needs no command target).
 * `id` (round 5: the prefix of dialogAttrs' ids; default: the key in `uses`).
 * State: { id, open, returnValue }. Actions: OPEN, CLOSE (data: the returnValue), CANCEL (Escape: the
 * keydown in the dialog while it has the closedby="none" OPEN set (G-405 / G-429: no CloseWatcher
 * close; the attribute goes when it closes); the prevented cancel event of a dialog with the
 * host's own closedby; G-457: not an Escape an element inside handled (defaultPrevented) or an
 * IME one, and not for a non-modal dialog, which Escape doesn't cancel either way), CLOSED (the
 * close event's returnValue), TOGGLED (from the toggle event), SYNC (G-400: the dialog left the
 * page while open: `open: false`; G-524: or OPEN's showModal() threw: no close event then), APPLY
 * (R2: `open` changed outside these: make the dialog match).
 * G-400: the commands check the dialog itself (showModal only on a closed one, close only on an
 * open one), so a state that is out of step can't block them.
 * Round 5: `dialogAttrs(state, uid)` gives the trigger, the dialog, its title and description the
 * ARIA and ids of Radix's Dialog.Trigger / Content / Title / Description / Close.
 */
import {ABORT, defineBehavior, xs} from '../index'
import {docOf, evt, focused, observer} from './dom'
import {covered, DISMISS, first, pull, push} from './layers'
import {ev, find, gone, idsOf, keyed, on, watch} from './shared'

// G-429: Escape in this dialog (not in a dialog nested in it, nor with a popover open inside it
// that Escape closes first, G-579 (layers.ts first()), nor with a controlled layer open inside it,
// round 3: Escape is that layer's). G-457: not one an element inside handled (a Zag combobox or
// menu closing its list prevents it: the browser sends no cancel then either), nor one that ends
// an IME composition (Safari sends keyCode 229 with isComposing false). R2: only while the dialog
// has closedby="none" (OPEN sets it; with the host's own closedby the cancel event comes instead)
// (the attribute, not the closedBy property: one that only an engine with closedby reflects)
const none = (d: any) => /^none$/i.test(d?.getAttribute?.('closedby') || '')
const esc = (e: any) => e.key == 'Escape' && !e.defaultPrevented && !e.isComposing && e.keyCode != 229 &&
  e.target?.closest?.('dialog') == e.ownerTarget && none(e.ownerTarget) &&
  ![...(e.ownerTarget?.querySelectorAll?.('[popover]') ?? [])].some(first) && !covered(e.ownerTarget)

// the focus went nowhere where `el` is: body, a detached element, or inside a dialog that just
// closed (round 6: `el`'s document and root, so a host tree, an iframe, a shadow root)
const lost = (el: any) => {
  const a: any = focused(el)
  return !a || a == docOf(el)?.body || !a.isConnected || !!a.closest?.('dialog:not([open])')
}
// an ELEMENT target (D102 spec command): focus `sel` only when the focus was lost
const refocus = (sel: any) => on(sel, 'focus', (el: any, o: any) => { lost(el) && el.focus(o) })

// G-524: OPEN's showModal() threw (bubbles: the DOM driver listens at its root)
const FAIL = 'sygnaldialogfail'

const method = (o: any) => (o.modal === false ? 'show' : 'showModal')
// R2: a method="dialog" form of this dialog (the submitter's formmethod wins), not a nested dialog's
const ownForm = (e: any) => (e.submitter?.getAttribute?.('formmethod') || e.target?.getAttribute?.('method') || '').toLowerCase() == 'dialog' &&
  e.target?.closest?.('dialog') == e.ownerTarget
// R2: an invoker command (commandfor) this behavior handles itself: on this dialog, not a custom one
const ownCommand = (e: any) => e.target === e.ownerTarget && /^(show-modal|close|request-close)$/.test(e.command)

/**
 * Opens the dialog (when closed): showModal() unless modal: false. `by` is what opened it: the
 * clicked trigger (OPEN's click event, G-407), a commandfor button (`source`), else the element
 * with the focus; the focus goes back to it on close (G-430).
 */
const show = (el: any, o: any, by?: any) => {
  if (el.open) return
  const m = method(o)
  // ui-sweep: the element keeps the last close's returnValue, and an Escape (no new value) would
  // report it again: an earlier 'ok' would read as this close's
  el.returnValue = ''
  const a = focused(el), op: any = by?.nodeType == 1 ? by : a != docOf(el)?.body ? a : null
  // R2: a modal dialog gets closedby="none" (unless the host set closedby): Escape reaches the
  // model as CANCEL (a keydown), which closes it through the state, so a host entry can keep it
  // open (G-405: Chromium's CloseWatcher would close on a second Escape otherwise). Round 3: a
  // controlled one always (the host's closedby says what the layer stack dismisses it on: "any"
  // a press or a focus outside too, "none" nothing; none given: Escape when modal), back on close
  const hc = el.getAttribute('closedby'), cb = o.controlled ? hc != 'none' : m == 'showModal' && hc == null
  const back = () => { hc == null ? el.removeAttribute('closedby') : el.setAttribute('closedby', hc) }
  if (cb) el.setAttribute('closedby', 'none')
  // G-461: a showModal() that throws (a disconnected dialog, a popover open on it) leaves no
  // closedby and arms no listener (a later close would focus this opener). G-488: and the state
  // goes back to closed, so the next OPEN can open it; G-524: through SYNC (an internal FAIL
  // event), not a close event: the host's close listeners don't run for a dialog that never
  // opened, and no previous returnValue comes again. The error is the command's (thrown once)
  try { el[m]() } catch (e) { cb && back(); el.dispatchEvent(evt(el, FAIL, {bubbles: true})); throw e }
  // round 3: a layer (layers.ts): on top for Escape and presses outside; dismissed by the stack
  // when controlled (by what the host's closedby names)
  const c = (hc || (m == 'showModal' ? 'closerequest' : 'none')).toLowerCase()
  push(el, {ctl: !!o.controlled, esc: c != 'none', out: c == 'any', modal: m == 'showModal', trigger: o.trigger})
  // on close: G-429 the closedby it set goes (it is the behavior's: the host's comes back), it
  // leaves the layer stack (round 3); G-430 the
  // element that opened it gets the focus back when it was lost, here rather than by a command (a
  // dialog the host renders only while open is gone by then), and nothing keeps the opener after
  // that. Capture: at the target it runs before the DOM driver's listener, so before CLOSED (whose
  // trigger fallback would take the focus first)
  const done = () => {
    mo?.disconnect()
    pull(el)
    cb && back()
    if ((o.returnFocus ?? true) === true && op?.isConnected && lost(el)) op.focus()
  }
  el.addEventListener('close', done, {once: true, capture: true})
  // R2: a host that renders the dialog only while open removes it when `open` goes false, before
  // any close event: the opener gets the focus back then too (Radix's focus scope on unmount)
  // (round 6: the element's window's MutationObserver: a host tree has none)
  const root = el.getRootNode(), MO = observer(el), mo = MO ? new MO(() => {
    if (!el.isConnected) el.removeEventListener('close', done, {capture: true}), done()
  }) : null
  mo?.observe(root.nodeType == 9 ? root.body : root, {childList: true, subtree: true})
}
// the commands that make the dialog match an open / closed slice (each checks the dialog itself,
// G-400, so one that is already as asked does nothing)
const opening = (o: any, by?: any) => ({[method(o)]: on(o.dialog, method(o), (el: any) => show(el, o, by))})
// (optional: a host that renders the dialog only while open has removed it by then, G-430)
const closing = (o: any, rv: any) => ({close: on(o.dialog, 'close', (el: any, x: any) => { el.open && el.close(x.returnValue) }, true), returnValue: typeof rv == 'string' ? rv : ''})
const closed = (s: any, rv: any) => (!s.open && s.returnValue === rv ? ABORT : {...s, open: false, returnValue: rv})

const base = /*#__PURE__*/ defineBehavior({
  initialState: {id: null, open: false, returnValue: ''},
  // SYG118 (dev): the option each action's trigger is built from (a host intent of that name replaces it)
  triggers: {OPEN: 'trigger', CLOSE: 'close'},
  intent: ({DOM, STATE}: any, {dialog: d, trigger, close, modal, controlled}: any) => {
    const cmd = ev(DOM, d, 'command', {preventDefault: ownCommand}, false).filter(ownCommand)
    const els = find(DOM, d)
    return {
      OPEN: xs.merge(trigger ? ev(DOM, trigger, 'click') : xs.never(), cmd.filter((e: any) => e.command == 'show-modal')),
      // R2: everything that would close it asks the model first: the close button, a
      // method="dialog" form's submit (prevented; the submitter's value), commandfor "close"
      CLOSE: xs.merge(
        close ? ev(DOM, close, 'click').mapTo('') : xs.never(),
        ev(DOM, d, 'submit', {preventDefault: ownForm}, true).filter(ownForm).map((e: any) => e.submitter?.value ?? ''),
        cmd.filter((e: any) => e.command == 'close').map((e: any) => e.source?.value ?? ''),
      ),
      // (R2: an event the dialog has moved on from since is dropped: a close event that comes after
      // the model opened it again, a toggle that no longer says what it is)
      TOGGLED: ev(DOM, d, 'toggle', {}, false).filter((e: any) => e.target?.open !== (e.newState != 'open')).map((e: any) => e.newState == 'open'),
      CLOSED: ev(DOM, d, 'close', {}, false).filter((e: any) => !e.target?.open).map((e: any) => e.target?.returnValue ?? ''),
      // R2: Escape (closedby="none": the keydown), the cancel event of a dialog with the host's own
      // closedby (light dismiss) or of a non-modal one, commandfor "request-close": prevented, so
      // the state decides. G-457: a non-modal dialog gets no keydown CANCEL (Escape doesn't close one)
      CANCEL: xs.merge(
        // (round 3: a controlled one's Escape, press and focus outside come from the layer stack)
        controlled ? ev(DOM, d, DISMISS, {}, false).filter((e: any) => e.target === e.ownerTarget).map((e: any) => e.detail)
          : modal === false ? xs.never() : ev(DOM, d, 'keydown').filter(esc),
        ev(DOM, d, 'cancel', {preventDefault: true}, false).filter((e: any) => e.target === e.ownerTarget && !none(e.ownerTarget)),
        cmd.filter((e: any) => e.command == 'request-close'),
      ),
      // G-524: SYNC also when OPEN's showModal() threw (FAIL, below; true). 3-U G-533: only this
      // behavior's dialog's own FAIL, not one bubbling from a dialog inside it (another behavior's)
      SYNC: ((f: any) => STATE ? xs.merge(gone(els, STATE), f) : f)(
        ev(DOM, d, FAIL).filter((e: any) => e.target === e.ownerTarget).mapTo(true)),
      ...(STATE && {APPLY: watch(els, STATE, (e: any) => !!e.open)}),
    }
  },
  // every entry that can change `open` sends the commands for the slice it ends with, the host's
  // entries for the same action included (7.0: outputs get the committed slice): a host entry
  // that keeps `open: true` keeps the dialog open
  model: {
    OPEN: {
      STATE: (s: any) => (s.open ? ABORT : {...s, open: true, returnValue: ''}),
      // G-407: who opened it: the clicked trigger, or the commandfor button
      ELEMENT: (s: any, d: any, _n: any, _p: any, o: any) => (s.open ? opening(o, d?.source || d?.ownerTarget) : ABORT),
    },
    CLOSE: {
      STATE: (s: any, rv: any) => (s.open ? {...s, open: false, returnValue: typeof rv == 'string' ? rv : ''} : ABORT),
      // (on a closed dialog too: the command checks the dialog, G-400)
      ELEMENT: (s: any, rv: any, _n: any, _p: any, o: any) => (s.open ? ABORT : closing(o, rv)),
    },
    TOGGLED: {
      STATE: (s: any, open: boolean) => (open && !s.open ? {...s, open, returnValue: ''} : ABORT),
      // opened without the model and the host kept it closed: close it again
      ELEMENT: (s: any, open: boolean, _n: any, _p: any, o: any) => (open && !s.open ? closing(o, s.returnValue) : ABORT),
    },
    CLOSED: {
      STATE: (s: any, rv: string) => closed(s, rv),
      ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => {
        // closed by the browser and the host kept it open (R2): open it again
        if (s.open) return opening(o)
        // returnFocus true: the element that opened it (show()'s close listener, G-430), else the
        // trigger; a selector: that element (each only when the focus was lost)
        const f = o.returnFocus ?? true, sel = f === true ? o.trigger : f
        return sel ? {focus: refocus(sel)} : ABORT
      },
    },
    CANCEL: {
      STATE: (s: any, _e: any, _n: any, _p: any, o: any) => (o.cancelable === false ? ABORT : closed(s, '')),
      ELEMENT: (s: any, _e: any, _n: any, _p: any, o: any) => (s.open ? ABORT : closing(o, s.returnValue)),
    },
    // G-534: after a failed OPEN the returnValue is '' (also when OPEN's STATE aborted: the state
    // was open while the element was closed)
    SYNC: (s: any, failed: any) => (s.open ? {...s, open: false, ...(failed === true && {returnValue: ''})} : ABORT),
    // R2: the slice's `open` changed outside these entries (a host reducer): make the dialog match
    APPLY: {ELEMENT: (s: any, _d: any, _n: any, _p: any, o: any) => (s.open ? opening(o) : closing(o, s.returnValue))},
  },
})

/** A native <dialog> as a behavior: `uses = { help: dialog({ dialog: '.help', trigger: '.open-help', close: '.close-help' }) }`. */
export const dialog = (options: any = {}): any => keyed(base({...options, open: !!options.open, returnValue: '', controlled: options.open !== undefined}))

/**
 * Round 5: the attributes of a dialog's elements, from its slice, as Radix's Dialog parts: the
 * trigger's aria-haspopup / aria-expanded / aria-controls, the dialog's id and its name and
 * description (aria-labelledby / aria-describedby: the `title` and `description` ids), data-state.
 * (No role: a <dialog> has it; an alert dialog writes role="alertdialog" on it.)
 */
export const dialogAttrs = (s: any, uid: any): any => {
  const id = idsOf(s, uid, 'dialog'), open = !!s?.open, state = open ? 'open' : 'closed'
  return {
    trigger: {type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': id('dialog'), 'data-state': state},
    dialog: {id: id('dialog'), 'aria-labelledby': id('title'), 'aria-describedby': id('description'), 'data-state': state},
    title: {id: id('title')},
    description: {id: id('description')},
    close: {type: 'button'},
  }
}
