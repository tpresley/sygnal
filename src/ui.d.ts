// 'sygnal/ui' (PLAN-5 U-1, D202): headless UI parts on native HTML. Types for the entry.
import type { Behavior, BehaviorTarget } from 'sygnal'

/** `uid` from the view's props: `({ state, uid }) => …` */
export type Uid = (name?: string) => string

// ── Dialog ────────────────────────────────────────────────────────────
export interface DialogState {
  /**
   * Whether the dialog is open: the source of truth (Radix's controlled `open`). A reducer that
   * writes it opens or closes the dialog; the dialog's own changes (Escape, a form submit,
   * commandfor) come back as actions, and a host entry that keeps `true` keeps it open.
   */
  open: boolean
  /** The close event's returnValue ('' when closed without one) */
  returnValue: string
}
export interface DialogOptions {
  /** The <dialog> */
  dialog: BehaviorTarget
  /** Its clicks dispatch OPEN */
  trigger?: BehaviorTarget
  /** Its clicks dispatch CLOSE (returnValue '') */
  close?: BehaviorTarget
  /** true (default): showModal(); false: show() */
  modal?: boolean
  /** true (default); false: Escape doesn't close it (the cancel event is prevented; OPEN sets closedby="none") */
  cancelable?: boolean
  /**
   * On close, when the focus was lost (WebKit after a mouse click), focus this: true (default) =
   * the element that opened it (else the trigger), a selector or control = that element, false =
   * leave it to the browser.
   */
  returnFocus?: boolean | BehaviorTarget
  /** Open at the start (default false; Radix's defaultOpen) */
  open?: boolean
}
export interface DialogActions { OPEN: any; CLOSE: string | undefined; CLOSED: string; TOGGLED: boolean; CANCEL: Event; /** false: the dialog left the page while open; true: OPEN's showModal() threw */ SYNC: boolean; /** The slice's `open` changed outside the behavior's entries: the dialog is made to match it */ APPLY: boolean }
/**
 * A native <dialog> as a behavior: `uses = { help: dialog({ dialog: '.help', trigger: '.open-help', close: '.close-help' }) }`
 * gives `state.help = { open, returnValue }` and 'help.OPEN' / 'help.CLOSE' (data: the returnValue) /
 * 'help.CLOSED' / 'help.CANCEL'.
 */
export function dialog(options: DialogOptions): Behavior<DialogState, DialogActions, {}, DialogOptions>

// ── Popover ───────────────────────────────────────────────────────────
/** `open`: the source of truth, as the dialog's (a reducer that writes it shows or hides the popover) */
export interface PopoverState { open: boolean }
export interface PopoverOptions {
  /** The popover element (popover="auto" or "manual") */
  popover: BehaviorTarget
  /** A button inside: its clicks dispatch CLOSE */
  close?: BehaviorTarget
  /** Open at the start (default false) */
  open?: boolean
}
export interface PopoverActions { OPEN: any; CLOSE: any; TOGGLE: any; TOGGLED: boolean; SYNC: false; APPLY: boolean }
/**
 * A popover (Popover API) as a behavior: `uses = { filters: popover({ popover: '.filters' }) }`, opened by a
 * `popovertarget` button or 'filters.OPEN' / 'filters.TOGGLE'; `state.filters.open` follows its toggle event.
 */
export function popover(options: PopoverOptions): Behavior<PopoverState, PopoverActions, {}, PopoverOptions>

// ── Tooltip ───────────────────────────────────────────────────────────
export interface TooltipState {
  open: boolean
  pending: null | 'show' | 'hide'
  /** The pointer is on the trigger or the tip */
  hover: boolean
  /** The trigger has the keyboard focus */
  focus: boolean
  /** The trigger was pressed: the pointer shows the tip again only after leaving and coming back */
  pressed: boolean
}
export interface TooltipOptions {
  /** What it describes (pointer and focus) */
  trigger: BehaviorTarget
  /** The tip: role="tooltip" popover="manual", placed with CSS anchor positioning */
  tip: BehaviorTarget
  /** ms before it shows (default 500) */
  showDelay?: number
  /** ms before it hides (default 100) */
  hideDelay?: number
}
export interface TooltipActions { ENTER: 'hover' | 'focus' | undefined; LEAVE: 'hover' | 'focus' | undefined; SHOW: any; HIDE: any; ESCAPE: string; TOGGLED: boolean; /** A pointerdown on the trigger: hides the tip */ PRESS: PointerEvent }
/** A tooltip: `uses = { tip: tooltip({ trigger: '.save', tip: '.save-tip' }) }`. Needs makeTimerDriver(). */
export function tooltip(options: TooltipOptions): Behavior<TooltipState, TooltipActions, {}, TooltipOptions>

// ── Tooltips (PLAN-11) ────────────────────────────────────────────────
export interface TooltipsState {
  /** The tip id of the trigger (or tip) last entered */
  id: string | null
  /** The id of the tip shown, or null */
  open: string | null
  pending: null | 'show' | 'hide'
  hover: boolean
  focus: boolean
  pressed: boolean
}
export interface TooltipsOptions {
  /** Every trigger (a selector matching them all); each names its tip with aria-describedby */
  trigger: BehaviorTarget
  /** Every tip: role="tooltip" popover="manual" with an id, placed with CSS anchor positioning */
  tip: BehaviorTarget
  /** ms before a tip shows (default 500); moving to another trigger while one shows switches at once */
  showDelay?: number
  /** ms before it hides (default 100) */
  hideDelay?: number
}
export interface TooltipsActions {
  ENTER: { via: 'hover' | 'focus'; id: string }
  LEAVE: { via: 'hover' | 'focus'; id: string }
  SHOW: any
  HIDE: any
  ESCAPE: string
  TOGGLED: { id: string; open: boolean }
  PRESS: { id: string }
}
/**
 * PLAN-11 (6.7): every tooltip of a component as one behavior (one state slice, two timers):
 * `uses = { tips: tooltips({ trigger: '.term', tip: '.term-tip' }) }`, each trigger with
 * `aria-describedby` naming its tip's id. One tip shows at a time. Needs makeTimerDriver().
 */
export function tooltips(options: TooltipsOptions): Behavior<TooltipsState, TooltipsActions, {}, TooltipsOptions>

// ── Tabs ──────────────────────────────────────────────────────────────
export interface TabsState {
  /** The ids' prefix (the key in `uses` unless the `id` option names it) */
  id: string | null
  /** The selected tab's value (null: the first tab rendered) */
  selected: string | null
  orientation: 'horizontal' | 'vertical'
}
export interface TabsOptions {
  /** The tabs (each with tabsAttrs' `tab(value)` spread on it) */
  tab: BehaviorTarget
  /** The tab selected at the start */
  selected?: string | number
  /** Which arrow keys move between the tabs (default 'horizontal': Left / Right) */
  orientation?: 'horizontal' | 'vertical'
  /** 'automatic' (default): moving the focus selects; 'manual': Enter / Space (a click) selects */
  activation?: 'automatic' | 'manual'
  /** The arrow keys wrap around (default true) */
  loop?: boolean
  /** The ids' prefix (default: the key in `uses`) */
  id?: string
}
export interface TabsActions { SELECT: string | number; MOVE: string }
/** Tabs over the host's markup: `uses = { tabs: tabs({ tab: '.tab', selected: 'general' }) }`; render with `tabsAttrs`. */
export function tabs(options: TabsOptions): Behavior<TabsState, TabsActions, {}, TabsOptions>

/** Attributes to spread on an element (`{...a.tab('general')}`). */
export type PartAttrs = Record<string, string | number | boolean | undefined>
export interface TabsAttrs {
  /** The tab list: role="tablist", aria-orientation */
  list: PartAttrs
  /** A tab: id, role="tab", aria-selected, aria-controls, tabindex (roving), data-value, data-state, type="button" */
  tab(value: string | number): PartAttrs
  /** Its panel: id, role="tabpanel", aria-labelledby, tabindex="0", hidden (unless selected), data-state */
  panel(value: string | number): PartAttrs
}
/**
 * The attributes of a tab set from its slice and the view's `uid`: `const a = tabsAttrs(state.tabs, uid)`.
 * `values`: the tabs' values in order (leave disabled ones out); with it, a `selected` that isn't
 * one of them (a removed tab) shows the first one selected.
 */
export function tabsAttrs(slice: TabsState | undefined, uid: Uid, values?: ReadonlyArray<string | number>): TabsAttrs

// ── Accordion ─────────────────────────────────────────────────────────
export interface AccordionState {
  id: string | null
  /** The open panels' values */
  expanded: string[]
  collapsible: boolean
}
export interface AccordionOptions {
  /** The header buttons (each with accordionAttrs' `trigger(value)` spread on it) */
  trigger: BehaviorTarget
  /** Several panels open at once (default false) */
  multiple?: boolean
  /** The last open panel can be closed (default true) */
  collapsible?: boolean
  /** The panels open at the start */
  expanded?: string | number | Array<string | number>
  /** Up / Down wrap around (default true) */
  loop?: boolean
  /** The ids' prefix (default: the key in `uses`) */
  id?: string
}
export interface AccordionActions { TOGGLE: string | number; EXPAND: string | number; COLLAPSE: string | number; MOVE: string }
/** An accordion over the host's markup: `uses = { faq: accordion({ trigger: '.faq-trigger' }) }`; render with `accordionAttrs`. */
export function accordion(options: AccordionOptions): Behavior<AccordionState, AccordionActions, {}, AccordionOptions>
export interface AccordionAttrs {
  /** A header button: id, aria-expanded, aria-controls, aria-disabled (the one open panel that can't close), data-value, data-state, type="button" */
  trigger(value: string | number): PartAttrs
  /** Its panel: id, role="region", aria-labelledby, hidden (unless open), data-state */
  panel(value: string | number): PartAttrs
}
/** The attributes of an accordion from its slice and the view's `uid`. */
export function accordionAttrs(slice: AccordionState | undefined, uid: Uid): AccordionAttrs

// ── Disclosure ────────────────────────────────────────────────────────
export interface DisclosureState { id: string | null; open: boolean }
export interface DisclosureOptions {
  /** The button (with disclosureAttrs' `trigger` spread on it) */
  trigger: BehaviorTarget
  /** Open at the start (default false) */
  open?: boolean
  /** The ids' prefix (default: the key in `uses`) */
  id?: string
}
export interface DisclosureActions { TOGGLE: any; OPEN: any; CLOSE: any }
/** A disclosure over the host's markup: `uses = { more: disclosure({ trigger: '.more-toggle' }) }`; render with `disclosureAttrs`. */
export function disclosure(options: DisclosureOptions): Behavior<DisclosureState, DisclosureActions, {}, DisclosureOptions>
export interface DisclosureAttrs {
  /** The button: aria-expanded, aria-controls, data-state, type="button" */
  trigger: PartAttrs
  /** The panel: id, hidden (unless open), data-state */
  panel: PartAttrs
}
/** The attributes of a disclosure from its slice and the view's `uid`. */
export function disclosureAttrs(slice: DisclosureState | undefined, uid: Uid): DisclosureAttrs

// ── Toaster ───────────────────────────────────────────────────────────
export type ToastKind = 'info' | 'success' | 'warning' | 'error'
/** The data of `event('TOAST', …)` (a string is the text). */
export type Toast = {
  text: string
  /** 'info' (default); 'error' toasts go to the role="alert" region */
  kind?: ToastKind
  /** ms until it dismisses itself (default 5000; 0 = until dismissed) */
  timeoutMs?: number
  /** A shown toast with this id is replaced (and its timer restarts); `event('TOAST_DISMISS', id)` removes it */
  id?: string | number
}
export interface ToasterProps {
  /** The region's aria-label (default 'Notifications') */
  label?: string
  /** The Dismiss button's text; its aria-label is `${dismissLabel}: ${text}` (default 'Dismiss') */
  dismissLabel?: string
  /** The Transition class prefix (default 'toast': toast-enter-from, toast-leave-to, …) */
  transition?: string
  /** How long a leaving toast stays, in ms: your leave animation's length (default 200) */
  duration?: number
  /** Timers stop while the pointer or the focus is in the region (default true) */
  pauseOnHover?: boolean
  /** Extra classes on the region (.toaster) */
  className?: string
  /** Optional: bind its state to a slice of the parent's */
  state?: string
}
/**
 * Shows the toasts that `event('TOAST', { text, kind, timeoutMs })` sends from any component. Render it
 * once, near the root: `<Toaster />`. Needs makeTimerDriver() for auto-dismiss.
 */
export function Toaster(props: ToasterProps): any
