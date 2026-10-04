import type { MainDOMSource } from './cycle/dom/MainDOMSource'
import type { EnrichedEventStream } from './cycle/dom/enrichEventStream'
import type { DocumentDOMSource } from './cycle/dom/DocumentDOMSource'
import type { BodyDOMSource } from './cycle/dom/BodyDOMSource'
import type { EventsFnOptions } from './cycle/dom/DOMSource'
import type { VNode } from './cycle/dom/snabbdom'
import type { StateSource } from './cycle/state/index'
import xsDefault from 'xstream'
import type { InspectGraph, InspectOptions } from './extra/diagnostics/checks/public'
import type { MemoryStream, Stream } from 'xstream'

export declare const ABORT: unique symbol
export type ABORT = typeof ABORT

export type DriverSpec<SOURCE = any, SINK = any> = {
  source: SOURCE;
  sink: SINK;
}

export type DriverSpecs = Record<string, DriverSpec<any, any>>

export type CycleDriver<SINK = any, SOURCE = any> =
  SINK extends void
    ? (() => SOURCE)
    : ((sink$: Stream<SINK>) => SOURCE)

export type DriverFactories<DRIVERS extends DriverSpecs = DriverSpecs> = {
  [DRIVER_KEY in keyof DRIVERS]: CycleDriver<DRIVERS[DRIVER_KEY]['sink'], DRIVERS[DRIVER_KEY]['source']>
}

/**
 * A function that takes component properties and returns a JSX element.
 * State and context are always provided by the framework at runtime. In JSX the element
 * takes the component's own props plus an optional `state` slice name or lens instead
 * (see `JSX.LibraryManagedAttributes` / `ElementProps`).
 */
type ComponentProps<STATE, PROPS, CONTEXT> = (
  props: ViewProps<STATE, PROPS, CONTEXT>,
  state: STATE,
  context: CONTEXT,
  peers: { [peer: string]: JSX.Element | JSX.Element[] }
) => JSX.Element

/**
 * PLAN-4 GS-9: `uid()` is a stable id string for this component instance (from its position in
 * the tree: the same in renderToString and after hydration); `uid('name')` derives one from it,
 * e.g. `<input id={uid('email')} />` with `<label for={uid('email')}>`.
 */
export type UidFunction = (name?: string) => string

/** The first argument of a component's view: its props plus `state`, `context`, `children`, `slots` and `uid`. */
export type ViewProps<STATE = any, PROPS = {}, CONTEXT = {}> =
  PROPS & { state: STATE; context: CONTEXT; children?: JSX.Element | JSX.Element[]; slots?: Record<string, JSX.Element[]>; uid: UidFunction }

/**
 * The `state` prop a parent passes to a sub-component in JSX: the name of a field of the
 * parent's state (`state="editor"`) or a lens. Without it the child shares the parent's state.
 */
export type StateProp = string | Lense<any, any>

/**
 * The JSX attributes of a component whose view takes PROPS: `state` becomes an optional
 * slice name or lens, and the framework-provided `context` and `slots` are not passed.
 */
export type ElementProps<PROPS> =
  0 extends (1 & PROPS) ? PROPS
  : 'state' extends keyof PROPS ? WithoutViewOnlyProps<PROPS> & { state?: StateProp }
  : PROPS

/** PROPS without `state`, `context`, `slots` and `uid` (keeps optionality and index signatures, unlike Omit). */
type WithoutViewOnlyProps<PROPS> = {
  [KEY in keyof PROPS as KEY extends 'state' | 'context' | 'slots' | 'uid' ? never : KEY]: PROPS[KEY]
}

type NextFunction<ACTIONS = any> = ACTIONS extends object
  ? <ACTION_KEY extends keyof ACTIONS>(
      action: ACTION_KEY,
      data?: ACTIONS[ACTION_KEY],
      delay?: number
    ) => void
  : (action: string, data?: any, delay?: number) => void

type ReducerExtras<PROPS, CONTEXT> = PROPS & { context: CONTEXT; children?: JSX.Element | JSX.Element[]; slots?: Record<string, JSX.Element[]>; uid: UidFunction }

type Reducer<STATE, PROPS, ACTIONS = any, DATA = any, RETURN = any, CONTEXT = {}> = (
  state: STATE,
  args: DATA,
  next: NextFunction<ACTIONS>,
  props: ReducerExtras<PROPS, CONTEXT>
) => RETURN | ABORT | undefined

export type ExactShape<EXPECTED, ACTUAL extends EXPECTED> = ACTUAL &
  Record<Exclude<keyof ACTUAL, keyof EXPECTED>, never>

type StateOnlyReducer<STATE, RETURN = any> = (
  state: STATE
) => RETURN | ABORT

export type Event<DATA = any> = { type: string; data: DATA }

// ── EVENTS registry ────────────────────────────────────────────────

/**
 * Registry of global EVENTS bus event names and their payload types.
 *
 * Empty by default, which keeps the EVENTS bus untyped (`any`). Augment it to
 * type-check `EVENTS.select()`, `event()`, `emit()` and raw EVENTS sink returns:
 *
 *   declare module 'sygnal' {
 *     interface SygnalEvents {
 *       DELETE_LANE: { laneId: string }
 *       RESET: void            // no payload: event('RESET')
 *     }
 *   }
 *
 * Once the registry has at least one entry, unregistered event names are type errors.
 * The augmenting file must be a module (have at least one import or export).
 */
export interface SygnalEvents {}

/** Valid event names: `string` while the registry is empty, otherwise the registered names. */
export type EventName = keyof SygnalEvents extends never ? string : keyof SygnalEvents & string

/** Payload type of a registered event (`any` while the registry is empty). */
export type EventPayload<TYPE extends string = string> = keyof SygnalEvents extends never
  ? any
  : TYPE extends keyof SygnalEvents ? SygnalEvents[TYPE] : never

/**
 * An event object as put on the EVENTS bus. While the registry is empty this is `Event<any>`;
 * otherwise it is the union of `{ type, data }` for every registered event.
 */
export type RegisteredEvent = keyof SygnalEvents extends never
  ? Event<any>
  : { [TYPE in keyof SygnalEvents & string]: { type: TYPE; data: SygnalEvents[TYPE] } }[keyof SygnalEvents & string]

/** The `{ type, data }` object produced by `event(type, ...)` / `emit(type, ...)`. */
export type EmittedEvent<TYPE extends string = string> = keyof SygnalEvents extends never
  ? { type: TYPE; data: any }
  // TYPE is every registered name when the name argument isn't registered (inference falls
  // back to the constraint): any registered event, so only the clear "not assignable to
  // parameter" error is reported, not a second one on the model entry
  : [EventName] extends [TYPE] ? RegisteredEvent
  : { type: TYPE; data: EventPayload<TYPE> }

/** The `next()` function as seen by an event payload function. */
type EventNextFunction = (action: string, data?: any, delay?: number) => void

/** Payload function for `event()` / `emit()`: receives the reducer arguments, returns the event data. */
export type EventPayloadFunction<TYPE extends string = string, STATE = any, DATA = any> =
  (state: STATE, data: DATA, next: EventNextFunction, props: any) => EventPayload<TYPE>

/**
 * Remaining arguments of `event()` / `emit()` when the payload is a static value.
 * The payload may be omitted when the registry is empty or the event's payload
 * type accepts `undefined` (e.g. `void`).
 */
type StaticEventArgs<TYPE extends string> = keyof SygnalEvents extends never
  ? [payload?: any]
  : undefined extends EventPayload<TYPE>
    ? [payload?: EventPayload<TYPE>]
    : [payload: EventPayload<TYPE>]

/**
 * The sink function returned by `event()`. Use it as the value of an `EVENTS` key in a
 * model entry: `ACTION: { STATE: ..., EVENTS: event('TYPE', fn) }`.
 */
export type EventSink<TYPE extends string = string, STATE = any, DATA = any> =
  (state: STATE, data: DATA, next: any, props: any) => EmittedEvent<TYPE>

export type NonStateSinkReturns = {
  EVENTS?: unknown;
  LOG?: unknown;
  PARENT?: unknown;
}

type ResolvedNonStateSinkReturns<SINK_RETURNS extends NonStateSinkReturns = {}> = {
  EVENTS: SINK_RETURNS extends { EVENTS: infer EVENTS_RETURN } ? EVENTS_RETURN : RegisteredEvent;
  LOG: SINK_RETURNS extends { LOG: infer LOG_RETURN } ? LOG_RETURN : any;
  // `unknown` (any value may be sent) rather than `any`, so CHILD.select(Child) of a child
  // annotated without `{ PARENT: T }` is a Stream<unknown>, not a silent Stream<any>
  PARENT: SINK_RETURNS extends { PARENT: infer PARENT_RETURN } ? PARENT_RETURN : unknown;
}

/**
 * Valid values for a sink
 *
 * - true: Whatever value is received from the intent for this action is passed on as-is.
 * - Function: A reducer
 */
type SinkValue<STATE, PROPS, ACTIONS, DATA, RETURN, CALCULATED, CONTEXT = {}> =
  | true
  | Reducer<STATE & CALCULATED, PROPS, ACTIONS, DATA, RETURN, CONTEXT>

/**
 * Valid values for a non-STATE sink (EVENTS, LOG, PARENT, custom drivers): a SinkValue, or
 * a constant that is sent as-is every time the action fires (`LOG: 'saved'`). Not for
 * STATE, whose values must be reducers. A constant can't be a function (that is a
 * reducer) or `true` (that is pass-through).
 */
type NonStateSinkValue<STATE, PROPS, ACTIONS, DATA, RETURN, CALCULATED, CONTEXT = {}> =
  | SinkValue<STATE, PROPS, ACTIONS, DATA, RETURN, CALCULATED, CONTEXT>
  | SinkConstant<RETURN>

/**
 * A constant for a sink whose value type is `RETURN`. When RETURN is `any` or `unknown`
 * (untyped sinks), any non-function value: a bare `any`/`unknown` would also accept reducers
 * with wrong parameter types and switch off checking of the whole model entry.
 */
type SinkConstant<RETURN> = unknown extends RETURN
  ? AnySinkConstant
  : RETURN extends (...args: any[]) => any ? never : RETURN

type AnySinkConstant =
  | string | number | bigint | boolean | null
  | readonly unknown[]
  | { [key: string]: unknown; apply?: never; call?: never; bind?: never }

/**
 * An EFFECT handler. It may be async: a returned promise is expected (no SYG219) and its
 * rejection is reported as SYG214. `next()` after the component is disposed does nothing.
 * `props.signal` aborts on DISPOSE (undefined where AbortController is missing).
 */
type EffectReducer<STATE, PROPS, ACTIONS, DATA, CALCULATED, CONTEXT = {}> =
  | ((state: STATE & CALCULATED, args: DATA, next: NextFunction<ACTIONS>, props: ReducerExtras<PROPS, CONTEXT> & { signal?: AbortSignal }) => void)

type DefaultSinks<STATE, PROPS, ACTIONS, DATA, CALCULATED, SINK_RETURNS extends NonStateSinkReturns = {}, CONTEXT = {}> = {
  STATE?: SinkValue<STATE, PROPS, ACTIONS, DATA, STATE, CALCULATED, CONTEXT>;
  EVENTS?: NonStateSinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['EVENTS'], CALCULATED, CONTEXT>;
  LOG?: NonStateSinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['LOG'], CALCULATED, CONTEXT>;
  PARENT?: NonStateSinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['PARENT'], CALCULATED, CONTEXT>;
  EFFECT?: EffectReducer<STATE, PROPS, ACTIONS, DATA, CALCULATED, CONTEXT>;
  /** PLAN-4 GS-2: element commands (built in, no driver): `{ focus: Email }`, `[{ ... }, { ... }]` */
  ELEMENT?: NonStateSinkValue<STATE, PROPS, ACTIONS, DATA, ElementCommands, CALCULATED, CONTEXT>;
}

/** Keys a type declares by name (index signatures left out). */
type CustomDriverSinks<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY, CALCULATED, CONTEXT = {}> = keyof DRIVERS extends never
  ? {
      [driver: string]: NonStateSinkValue<STATE, PROPS, ACTIONS, any, any, CALCULATED, CONTEXT>
    }
  : {
      [DRIVER_KEY in keyof DRIVERS]: NonStateSinkValue<
        STATE,
        PROPS,
        ACTIONS,
        ACTION_ENTRY,
        DRIVERS[DRIVER_KEY] extends { source: any; sink: any } ? DRIVERS[DRIVER_KEY]['sink'] : any,
        CALCULATED,
        CONTEXT
      >
    }

type ModelEntry<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY, CALCULATED, SINK_RETURNS extends NonStateSinkReturns = {}, CONTEXT = {}> =
  | SinkValue<STATE, PROPS, ACTIONS, ACTION_ENTRY, STATE, CALCULATED, CONTEXT>
  | Partial<
      DefaultSinks<STATE, PROPS, ACTIONS, ACTION_ENTRY, CALCULATED, SINK_RETURNS, CONTEXT> &
      CustomDriverSinks<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY, CALCULATED, CONTEXT>
    >

type WithDefaultActions<STATE, ACTIONS> = ACTIONS & {
  BOOTSTRAP?: never;
  INITIALIZE?: STATE;
  DISPOSE?: never;
}

type ComponentModel<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, SINK_RETURNS extends NonStateSinkReturns = {}, CONTEXT = {}> = keyof ACTIONS extends never
  ? {
      [action: string]: ModelEntry<
        STATE,
        PROPS,
        DRIVERS,
        WithDefaultActions<STATE, { [action: string]: any }>,
        any,
        CALCULATED,
        SINK_RETURNS,
        CONTEXT
      >
    }
  : {
      [ACTION_KEY in keyof WithDefaultActions<STATE, ACTIONS>]?: ModelEntry<
        STATE,
        PROPS,
        DRIVERS,
        WithDefaultActions<STATE, ACTIONS>,
        WithDefaultActions<STATE, ACTIONS>[ACTION_KEY],
        CALCULATED,
        SINK_RETURNS,
        CONTEXT
      >
    }

type TrimSpaces<S extends string> =
  S extends ` ${infer REST}` ? TrimSpaces<REST>
  : S extends `${infer REST} ` ? TrimSpaces<REST>
  : S

/** Value type produced by a PARENT sink value (a reducer's return, minus ABORT/undefined). */
type ParentSinkValueReturn<VALUE> =
  // an expando model widens `PARENT: true` (pass-through) and `PARENT: false` to boolean:
  // the payload can't be told apart there
  boolean extends VALUE ? ParentConstantReturn<Exclude<VALUE, boolean>> : ParentConstantReturn<VALUE>

type ParentConstantReturn<VALUE> =
  VALUE extends (...args: any[]) => infer RETURN ? Exclude<RETURN, ABORT | undefined | void>
  // `true` is pass-through (payload unknown here)
  : VALUE extends true ? never
  // a constant (including `false`) is sent as-is
  : VALUE

type ParentPayloadFromEntry<ENTRY> =
  ENTRY extends (...args: any[]) => any ? never
  : ENTRY extends object
    ? 'PARENT' extends keyof ENTRY ? ParentSinkValueReturn<NonNullable<ENTRY['PARENT']>> : never
    : never

// Shorthand 'ACTION | PARENT' keys (expando models only). Object-form entries are read by
// distributing over the union of the entry types (see ParentPayloadOf).
type ShorthandParentPayloads<MODEL> = {
  [ACTION_KEY in keyof MODEL & `${string}|${string}`]-?: ACTION_KEY extends `${string}|${infer SINK}`
    ? TrimSpaces<SINK> extends 'PARENT' ? ParentSinkValueReturn<NonNullable<MODEL[ACTION_KEY]>> : never
    : never
}[keyof MODEL & `${string}|${string}`]

type AnyIfNever<T> = [T] extends [never] ? any : T

/**
 * The value type a component sends to its parent through the `PARENT` sink, inferred from the
 * component's `model` (object-form `{ PARENT: fn }` entries and `'ACTION | PARENT'` shorthand),
 * or for a `Component<...>` annotation, the `PARENT` entry of its `SINK_RETURNS`. A
 * `Component<...>` annotation without one gives `unknown` (declare it: `{ PARENT: T }`); no model
 * or `PARENT: true` pass-through entries only give `any`.
 */
export type ParentPayloadOf<COMPONENT> =
  COMPONENT extends { model?: infer MODEL }
    // the union is written out here (not behind a helper alias) so hovers and errors print
    // the payload (`Stream<{ taskId: number }>`), not `Stream<Helper<...the whole model...>>`
    ? 0 extends (1 & MODEL) ? any : AnyIfNever<
        | ParentPayloadFromEntry<NonNullable<NonNullable<MODEL>[keyof NonNullable<MODEL>]>>
        | ShorthandParentPayloads<NonNullable<MODEL>>
      >
    : any

type ChildSource = {
  /** Typed: the stream type is inferred from the child's PARENT sink (falls back to `any`). */
  select<COMPONENT extends (...args: any[]) => any>(component: COMPONENT): Stream<ParentPayloadOf<COMPONENT>>;
  select<T = any>(component: (...args: any[]) => any): Stream<T>;
  select<T = any>(name: string): Stream<T>;
}

/**
 * `DOM.<event>(selector)` shorthands for the standard DOM events, typed like
 * `DOM.select(selector).events('<event>')`: `DOM.keydown('.x')` is a stream of KeyboardEvent,
 * `DOM.click('.x')` of MouseEvent (PointerEvent in newer DOM typings), and so on.
 */
export type DOMEventShorthands = {
  [EVENT in Exclude<keyof HTMLElementEventMap, keyof MainDOMSource>]: DOMEventShorthand<HTMLElementEventMap[EVENT]>
}

/**
 * One `DOM.<event>` shorthand: a selector string gives a stream of the event; a control gives
 * the event with `currentTarget` (and `ownerTarget`) typed as the control's element.
 */
export interface DOMEventShorthand<EVENT> {
  <CONTROL extends AnyControl>(control: CONTROL): EnrichedEventStream<ControlEvent<EVENT, ControlElementOf<CONTROL>>>
  // last, so ReturnType<SygnalDOMSource['click']> stays the selector form
  (selector: string): EnrichedEventStream<EVENT>
}

/**
 * `select()` overloads added to the DOM source: a control selects its element, typed;
 * `'document'` / `'body'` give sources that also take a control; a selector string gives a
 * source whose `select()` takes controls too.
 */
type ControlSelectOverlay = {
  select<CONTROL extends AnyControl>(control: CONTROL): ControlDOMSource<ControlElementOf<CONTROL>>
  select(selector: 'document'): SygnalDocumentDOMSource
  select(selector: 'body'): SygnalBodyDOMSource
  select(selector: string): SelectedDOMSource
}

/** What `DOM.select('<selector>')` returns: a MainDOMSource whose `select()` also takes controls. */
export type SelectedDOMSource = ControlSelectOverlay & MainDOMSource

/** `DOM.select('document')`: document-level listeners, optionally filtered to a selector or control. */
export type SygnalDocumentDOMSource = DocumentDOMSource & {
  select(control: AnyControl): DocumentDOMSource
}

/** `DOM.select('body')`: body-level listeners, optionally filtered to a selector or control. */
export type SygnalBodyDOMSource = BodyDOMSource & {
  select(control: AnyControl): BodyDOMSource
}

/**
 * `DOM.select(control)`: a DOM source scoped to a control's element. `events(name)` is typed
 * like a selector's, with `currentTarget` typed as the control's element; `element()` and
 * `elements()` give that element type.
 */
export type ControlDOMSource<ELEMENT extends Element = Element> = ControlSelectOverlay & Omit<MainDOMSource, 'select' | 'events' | 'element' | 'elements'> & {
  events<K extends keyof HTMLElementEventMap>(eventType: K, options?: EventsFnOptions, bubbles?: boolean): EnrichedEventStream<ControlEvent<HTMLElementEventMap[K], ELEMENT>>
  events(eventType: string, options?: EventsFnOptions, bubbles?: boolean): EnrichedEventStream<ControlEvent<globalThis.Event, ELEMENT>>
  element(): MemoryStream<ELEMENT>
  elements(): MemoryStream<ELEMENT[]>
}

export type SygnalDOMSource = ControlSelectOverlay & MainDOMSource & DOMEventShorthands & {
  /** Any other event name (custom events): `DOM['my-event']('.x')`, `DOM['my-event'](Control)` */
  [eventName: string]: DOMEventShorthand<globalThis.Event>
}

// ── Controls (PLAN-4 CT-1) ────────────────────────────────────────

/**
 * The pragma's own createElement, passed to a spec's `vnode()` as `h` (D116):
 * `h(tag, props, ...children)`. Spec authors build vnodes with it, never with an imported
 * `createElement` (under the automatic JSX runtime that would bundle a second pragma).
 */
export type ControlH = (tag: any, props?: Record<string, any> | null, ...children: unknown[]) => VNode

/**
 * The spec-object form of a control spec (D101, amended D116): `controls({ DueDate: datePicker })`.
 * `vnode(props, children, h)` returns the one element vnode the control renders (the pragma
 * stamps `data-control` on it, keeping its key and hooks, and copies the props' `key` onto it
 * when it has none). `commands` are looked up by element commands before native methods.
 * `__props` is a phantom field (types only) that gives the control its props type.
 */
export interface ControlSpecObject<P = any> {
  /** Free-form kind ('widget' in PLAN-5), shown in inspect() and diagnostics */
  kind: string;
  /** Must return one element vnode (not a component, fragment or text), built with `h` */
  vnode(props: P, children: unknown[], h: ControlH): VNode;
  commands?: Record<string, (elm: Element, options: Record<string, unknown>) => void>;
  /** Phantom, types only: the control's props */
  __props?: P;
}

/**
 * A control spec (frozen contract D101): an intrinsic tag name (`'button'`, `'input'`,
 * `'wa-rating'`) or a spec object `{ kind, vnode(props, children, h), commands?, __props? }`.
 */
export type ControlSpec<P = any> =
  | keyof JSX.IntrinsicElements
  | ControlSpecObject<P>

declare const CONTROL: unique symbol

/**
 * A control (`controls({ Add: 'button' }).Add`): a JSX tag that renders its element with the
 * props passed plus `data-control="<KEY>"`. Not a component (no state, intent or isolation).
 * Anywhere a selector is accepted (`DOM.select`, `DOM.<event>`, `simulateEvent`, `query`,
 * `queryAll`), a control selects its element; in a template string it is its selector:
 * `` `li ${Add}` `` is `li [data-control="Add"]`.
 *
 * KEY is the control's name, ELEMENT the element type (`HTMLButtonElement` for 'button';
 * `Element` for a spec object), PROPS its JSX props.
 */
export interface Control<KEY extends string = string, ELEMENT extends Element = Element, PROPS = any> {
  (props: PROPS): JSX.Element;
  /** The control's selector: `[data-control="<KEY>"]` */
  toString(): `[data-control="${KEY}"]`;
  /** 'element' for a tag spec, else the spec object's `kind` */
  readonly kind: string;
  /** The spec the control was made from */
  readonly spec: ControlSpec;
  /** Phantom, types only */
  readonly [CONTROL]: { key: KEY; element: ELEMENT; props: PROPS };
}

/** Any control, whatever its key, element and props. */
export type AnyControl = Control<string, any, any>

/** The element type a control (or a control spec) renders. */
export type ControlElementOf<C> =
  C extends { readonly [CONTROL]: { element: infer ELEMENT } } ? ELEMENT
  : C extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[C]
  : C extends keyof SVGElementTagNameMap ? SVGElementTagNameMap[C]
  : C extends string ? HTMLElement
  : Element

/** An event from a control's listener: `currentTarget` / `ownerTarget` are the control's element. */
export type ControlEvent<EVENT, ELEMENT extends Element = Element> = EVENT & {
  readonly currentTarget: ELEMENT;
  readonly ownerTarget: ELEMENT;
}

type IfEqual<X, Y, A, B> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? A : B

/** Keys of T that are not readonly. */
type WritableKeys<T> = {
  [KEY in keyof T]-?: IfEqual<{ [Q in KEY]: T[KEY] }, { -readonly [Q in KEY]: T[KEY] }, KEY, never>
}[keyof T]

/** Writable, non-function, non-constant properties of an element: its settable DOM props. */
type SettableElementProps<ELEMENT> = {
  [KEY in WritableKeys<ELEMENT> as KEY extends string
    ? KEY extends Uppercase<KEY> ? never
      : NonNullable<ELEMENT[KEY]> extends (...args: any[]) => any ? never
      : KEY
    : never
  ]?: KEY extends 'value' ? ELEMENT[KEY] | number : ELEMENT[KEY]
}

/** JSX props every control takes, besides its element's own props (or the spec's props). */
export type ControlCommonProps<ELEMENT = Element> = {
  key?: string | number;
  children?: any;
  ref?: Ref<any> | ((element: ELEMENT | null) => void);
}

/**
 * JSX props of an intrinsic element as rendered by Sygnal: the element's settable DOM
 * properties (no event handlers: listen in the intent), plus `class`, `style`, `attrs`,
 * `props`, `hook`, `for`, `tabindex`, `autoFocus` / `autoSelect`. `data-*` / `aria-*` are
 * accepted as hyphenated attributes. Custom elements (`'wa-rating'`) and SVG elements take any prop.
 */
export type IntrinsicControlProps<TAG extends string> =
  ControlCommonProps<ControlElementOf<TAG>> & {
    class?: string | ReadonlyArray<unknown> | Record<string, boolean | null | undefined>;
    style?: string | Record<string, any>;
    attrs?: Record<string, any>;
    props?: Record<string, any>;
    hook?: Record<string, (...args: any[]) => any>;
    for?: string;
    tabindex?: number | string;
    /** Focus the element when it enters the DOM */
    autoFocus?: boolean;
    /** Select the element's text after focusing (input/textarea) */
    autoSelect?: boolean;
  } & (TAG extends keyof HTMLElementTagNameMap
    ? Omit<SettableElementProps<HTMLElementTagNameMap[TAG]>, 'style'>
    : { [prop: string]: any })

/** The JSX props of a control made from a spec: a tag's IntrinsicControlProps, or a spec object's P. */
export type ControlPropsOf<SPEC> =
  SPEC extends string ? IntrinsicControlProps<SPEC>
  : SPEC extends { __props?: infer P }
    ? unknown extends P
      ? (SPEC extends { vnode(props: infer VP, ...rest: any[]): any } ? VP : any) & ControlCommonProps
      : P & ControlCommonProps
    : any

/** The controls `controls(spec)` returns: one per key, typed from its spec. */
export type ControlsOf<SPECS> = {
  [KEY in keyof SPECS & string]: Control<
    KEY,
    SPECS[KEY] extends string ? ControlElementOf<SPECS[KEY]> : Element,
    ControlPropsOf<SPECS[KEY]>
  >
}

/**
 * Element tokens for linking a view to its intent by identifier (CT-1):
 *
 *   const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })
 *   <Draft className="field" value={state.draft} /><Add>Add</Add>
 *   AddTodo.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add) })
 *
 * Each key becomes a control that renders its spec (a tag name, or a spec object) with
 * `data-control="<Key>"`. The keys are the names, so keep them unique in a file.
 */
export function controls<const SPECS extends Record<string, ControlSpec>>(spec: SPECS): ControlsOf<SPECS>

/**
 * The target of an element command: a control, or a selector. It is looked up in the view of the
 * component instance that sends the command (a child's elements are isolated from its parent; a
 * Collection item reaches only its own).
 */
export type ElementTarget = AnyControl | string

/**
 * Element commands beyond the built-in ones, by method name → options, for a control spec's
 * `commands` (D102) or another method of the element. Augment it (the first key of a command is
 * the method, the rest are the options):
 *
 *   declare module 'sygnal' { interface ElementCommandRegistry { open: { at?: number }; play: {} } }
 *   // ELEMENT: { open: DueDate, at: 3 }
 */
export interface ElementCommandRegistry {}

type RegisteredElementCommand = {
  [METHOD in keyof ElementCommandRegistry & string]: { [K in METHOD]: ElementTarget } & ElementCommandRegistry[METHOD]
}[keyof ElementCommandRegistry & string]

/**
 * One element command (the built-in `ELEMENT` sink, PLAN-4 GS-2): `{ <method>: target, ...options }`.
 * The FIRST key is the method, the others are its options; `close` passes `returnValue` as its
 * argument. A control whose spec declares `commands` is asked first (`{ open: DueDate }`), then
 * the element's own method runs, after the next render reaches the page. Register other method
 * names (a spec's commands, `play`, `reset`...) in `ElementCommandRegistry`.
 */
export type ElementCommand =
  | { focus: ElementTarget; preventScroll?: boolean; focusVisible?: boolean }
  | { blur: ElementTarget }
  | { select: ElementTarget }
  | { click: ElementTarget }
  | { scrollIntoView: ElementTarget; block?: ScrollLogicalPosition; inline?: ScrollLogicalPosition; behavior?: ScrollBehavior }
  | { showModal: ElementTarget }
  | { show: ElementTarget }
  | { close: ElementTarget; returnValue?: string }
  | { showPopover: ElementTarget }
  | { hidePopover: ElementTarget }
  | { togglePopover: ElementTarget; force?: boolean }
  | RegisteredElementCommand

/** What the `ELEMENT` sink takes: one command or several (run in order). */
export type ElementCommands = ElementCommand | readonly ElementCommand[]

// ── Behaviors (PLAN-4 GS-1) ────────────────────────────────────────

/**
 * What a behavior's intent receives: the host component's sources (DOM is the host's isolated
 * DOM source; CHILD, EVENTS, drivers as they are), with STATE lensed to the behavior's slice.
 */
export type BehaviorSources<SLICE = any> = IntentSources<SLICE> & { [source: string]: any }

/** The object passed to `defineBehavior()`. Reducers and sinks get the slice, not the host state. */
export interface BehaviorDefinition<SLICE = any, ACTIONS = {}, CALCULATED = {}, OPTIONS = Record<string, any>> {
  /** The slice a host starts with (`state[key]`); options naming one of its keys override it. */
  initialState: SLICE;
  /** Actions named without the key (`NEXT`); the host sees them as `'<key>.NEXT'`. */
  intent?: (sources: BehaviorSources<SLICE>, options: OPTIONS) => { [ACTION in keyof ACTIONS]: Stream<ACTIONS[ACTION]> };
  /**
   * Model entries on the slice: ABORT, or the slice itself, means no change. `next('X')` names
   * the behavior's own actions. (The slice's calculated fields are there at runtime, but typed
   * only on the host's state: TypeScript can't infer them while typing these functions.)
   */
  model?: ComponentModel<SLICE, {}, {}, {}, {}>;
  /** Fields of the slice (`state.pager.offset`), stored on it and recomputed when it changes. */
  calculated?: { [FIELD in keyof CALCULATED]: (slice: SLICE) => CALCULATED[FIELD] };
}

/** One use of a behavior (a `defineBehavior()` factory's result), for a component's `uses`. */
export interface Behavior<SLICE = any, ACTIONS = any, CALCULATED = {}, OPTIONS = any> {
  readonly initialState: SLICE;
  readonly options: OPTIONS;
  /** The slice a host starts with: initialState, the options naming its keys, the calculated fields. */
  readonly state: SLICE & CALCULATED;
  /** Merges the behavior into a component instance under `key`; called by the core for each `uses` entry. */
  merge(component: any, key: string): void;
  /** Phantom, types only */
  readonly __behavior?: { actions: ACTIONS };
}

/** What `defineBehavior()` returns: call it with the options of one use. */
export type BehaviorFactory<SLICE = any, ACTIONS = {}, CALCULATED = {}, OPTIONS = Record<string, any>> =
  (options?: OPTIONS & Partial<SLICE>) => Behavior<SLICE, ACTIONS, CALCULATED, OPTIONS>

/**
 * A reusable piece of state, intent and model (GS-1). A host uses it under a key:
 *
 *   const pager = defineBehavior({
 *     initialState: { page: 0, pageSize: 20 },
 *     intent: ({ DOM }, { next, prev }) => ({ NEXT: DOM.click(next), PREV: DOM.click(prev) }),
 *     model: { NEXT: (p) => ({ ...p, page: p.page + 1 }), PREV: (p) => (p.page === 0 ? ABORT : { ...p, page: p.page - 1 }) },
 *     calculated: { offset: (p) => p.page * p.pageSize },
 *   })
 *   TaskList.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }   // state.pager, 'pager.NEXT'
 *
 * A host model entry for a behavior action ('pager.NEXT') runs after the behavior's: its STATE
 * reducer gets the full state with the behavior's update, its EFFECT runs too, and its value
 * sinks (EVENTS, PARENT, drivers) replace the behavior's. A host intent action of the same name
 * replaces the behavior's trigger.
 */
export function defineBehavior<SLICE extends Record<string, any>, ACTIONS = {}, CALCULATED = {}, OPTIONS = Record<string, any>>(
  definition: BehaviorDefinition<SLICE, ACTIONS, CALCULATED, OPTIONS>
): BehaviorFactory<SLICE, ACTIONS, CALCULATED, OPTIONS>

/** The slice a behavior gives its host (initialState & calculated fields). */
export type BehaviorState<BEHAVIOR> = BEHAVIOR extends Behavior<infer SLICE, any, infer CALCULATED, any> ? SLICE & CALCULATED : never

/** The state keys a `uses` object adds: `type State = { tasks: Task[] } & UsesState<typeof uses>`. */
export type UsesState<USES> = { [KEY in keyof USES]: BehaviorState<USES[KEY]> }

type UsesActionEntries<USES> = {
  [KEY in keyof USES & string]: USES[KEY] extends Behavior<any, infer ACTIONS, any, any>
    ? { [ACTION in keyof ACTIONS & string]: [`${KEY}.${ACTION}`, ACTIONS[ACTION]] }[keyof ACTIONS & string]
    : never
}[keyof USES & string]

/** The namespaced actions a `uses` object adds ('pager.NEXT'), for a typed ACTIONS map. */
export type UsesActions<USES> = { [ENTRY in UsesActionEntries<USES> as ENTRY[0]]: ENTRY[1] }

// ── First-party behaviors (PLAN-4 GS-1, GS-8) ──────────────────────

/** Where a behavior option takes something to listen to: a control or a CSS selector. */
export type BehaviorTarget = AnyControl | string

/** A `pager` slice: `state.pager`. */
export interface PagerState { page: number; pageSize: number; total: number | null }
/** A `pager` slice's calculated fields. `pages` is null while `total` is unknown. */
export interface PagerCalculated { offset: number; pages: number | null; hasPrev: boolean; hasNext: boolean }
export interface PagerOptions {
  /** Items per page (default 20) */
  pageSize?: number;
  /** Starting page, from 0 (default 0) */
  page?: number;
  /** Item count; null (default) = unknown, NEXT has no upper bound */
  total?: number | null;
  /** Its clicks dispatch NEXT */
  next?: BehaviorTarget;
  /** Its clicks dispatch PREV */
  prev?: BehaviorTarget;
}
export interface PagerActions { NEXT: any; PREV: any; GOTO: number; SET_TOTAL: number }

/**
 * A page cursor (GS-1): `List.uses = { pager: pager({ pageSize: 10, total, next: Newer, prev: Older }) }`
 * gives `state.pager = { page, pageSize, total, offset, pages, hasPrev, hasNext }` and the actions
 * 'pager.NEXT' / 'pager.PREV' (no change at the bounds), 'pager.GOTO' (a page number, clamped)
 * and 'pager.SET_TOTAL' (the item count).
 */
export function pager(options?: PagerOptions): Behavior<PagerState, PagerActions, PagerCalculated, PagerOptions>

/** A `selection` slice: the selected ids, as strings, in selection order. */
export interface SelectionState { selected: string[] }
export interface SelectionCalculated { count: number }
export interface SelectionOptions {
  /** Several items at once: an item click toggles its id (default false: it replaces the selection) */
  multi?: boolean;
  /** The control on each item; its clicks dispatch SELECT with the item's `attr` */
  item?: BehaviorTarget;
  /** Select-all toggle: dispatches TOGGLE_ALL (needs `from`) */
  all?: BehaviorTarget;
  /** Its clicks dispatch CLEAR */
  clear?: BehaviorTarget;
  /** The item element's attribute that holds its id (default 'data-id') */
  attr?: string;
  /** The host state key of the item list, for SELECT_ALL / TOGGLE_ALL */
  from?: string;
  /** The id field of the `from` list's items (default 'id') */
  idField?: string;
}
export interface SelectionActions { SELECT: string | number | Event; SELECT_ALL: Array<string | number> | undefined; TOGGLE_ALL: Array<string | number> | Event | undefined; CLEAR: any }

/**
 * Single or multiple selection (GS-1): `uses = { sel: selection({ multi: true, item: Pick, all: All, from: 'mails' }) }`
 * gives `state.sel = { selected, count }` and 'sel.SELECT' (an id or an item click),
 * 'sel.SELECT_ALL' (ids, or every id of `state[from]`), 'sel.TOGGLE_ALL' and 'sel.CLEAR'.
 */
export function selection(options?: SelectionOptions): Behavior<SelectionState, SelectionActions, SelectionCalculated, SelectionOptions>

/** Is `id` in a `selection` slice? Ids compare as strings. */
export function isSelected(slice: SelectionState | undefined | null, id: string | number): boolean

/** `state.history` of `undoable()` / `undo()`: snapshots of `state[key]`, newest last in `past`. */
export interface UndoHistory<T = any> { past: T[]; future: T[] }
export interface UndoOptions {
  /** The state key whose value is snapshotted */
  key: string;
  /** The most snapshots kept in `past` (default 100) */
  limit?: number;
  /** Only these actions are recorded (default: every action with a STATE reducer) */
  track?: string[];
  /**
   * Changes by one action within this many ms join one undo step (default 0: off; 500 when
   * `coalesce` is given). Without `coalesce`, every action's quick repeats join
   */
  coalesceMs?: number;
  /**
   * Only these actions' quick repeats join one step (typing); every other action is always its
   * own step: `undo({ key: 'poster', coalesce: ['HEADLINE'], coalesceMs: 1000 })`
   */
  coalesce?: string[];
  /** These actions clear the history (a load) and are not recorded */
  resetOn?: string[];
}

/**
 * Undo / redo for `state[key]` (GS-8): wraps the model's STATE reducers so each change pushes
 * the old value onto `state.history.past`, and adds UNDO and REDO (no change when there is
 * nothing to undo or redo). `Editor.model = undoable({ TYPE: ... }, { key: 'doc', coalesceMs: 500 })`.
 */
export function undoable<MODEL extends Record<string, any>>(model: MODEL, options: UndoOptions): MODEL & { UNDO: any; REDO: any }

/** `undo()` options: undoable()'s, plus the controls that trigger UNDO / REDO. */
export interface UndoBehaviorOptions extends UndoOptions { undo?: BehaviorTarget; redo?: BehaviorTarget }

/**
 * undoable() as a behavior (GS-8): `uses = { history: undo({ key: 'doc', undo: UndoButton, redo: RedoButton }) }`
 * gives `state.history = { past, future, canUndo, canRedo }` and 'history.UNDO' / 'history.REDO'.
 */
export function undo(options: UndoBehaviorOptions): Behavior<UndoHistory, { UNDO: any; REDO: any }, { canUndo: boolean; canRedo: boolean }, UndoBehaviorOptions>

/** The top-level state keys of STATE (any string while STATE is unknown) */
type PersistKey<STATE> = 0 extends (1 & STATE) ? string : keyof STATE & string

/**
 * A synchronous storage for `persist({ storage })` (async storages are not supported).
 * `subscribe` (optional) is what `sync: true` listens to instead of the window `storage` event:
 * call `fn(key, newValue)` when another writer changes a key; return the unsubscribe function.
 */
export interface PersistStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  subscribe?(fn: (key: string, newValue: string | null) => void): () => void
}

/** PLAN-4 GS-5: `persist()` options */
export interface PersistOptions<STATE = any> {
  /** The storage key */
  key: string
  /** The top-level state keys to save (default: all but `omit`) */
  pick?: ReadonlyArray<PersistKey<STATE>>
  /** The top-level state keys not to save (calculated fields are never saved) */
  omit?: ReadonlyArray<PersistKey<STATE>>
  /** The version saved with the state (default 1). A stored entry with another version goes through `migrate` */
  version?: number
  /**
   * Turns a stored entry of another version into this version's picked keys; nothing (undefined
   * or null) discards it. Without migrate such an entry is ignored. If it throws: SYG642.
   */
  migrate?: (old: any, fromVersion: number) => Partial<STATE> | null | undefined | void
  /** 'local' (localStorage, the default), 'session' (sessionStorage) or a synchronous adapter */
  storage?: 'local' | 'session' | PersistStorage
  /** Apply other tabs' writes to this key (a RESTORE action) */
  sync?: boolean
  /**
   * Restore in a RESTORE action after the first render (so the first render matches the server's
   * HTML) instead of before INITIALIZE. Detected when omitted: run()'s mount point holds
   * renderToString markup (its root element has `data-sygnal-ssr`), a server-rendered Astro
   * island, a Vike hydration. true / false override it
   */
  hydrate?: boolean
  /** Writes wait for this many ms without a state change (default 100); flushed on pagehide and dispose */
  debounceMs?: number
}

/** The value `persist()` returns: set it as the root component's `persist` static */
export interface Persist<STATE = any> {
  readonly options: PersistOptions<STATE>
  /** Called by the core on the root component (internal) */
  setup(component: any): void
}

/**
 * PLAN-4 GS-5: save the root component's state and restore it at startup:
 * `TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'], version: 2, migrate })`.
 * Stored as JSON `{ version, state }`. The restore is merged into initialState (part of
 * INITIALIZE); writes are debounced (`debounceMs`) and flushed on pagehide and dispose.
 * `PERSIST: { clear: true }` in a model entry removes the stored copy. Root component only
 * (SYG224); failures are SYG642 (warn) and the app continues on initialState.
 */
export function persist<STATE = any>(options: PersistOptions<[STATE] extends [infer S] ? S : never>): Persist<STATE>

type EventsSelect = keyof SygnalEvents extends never
  ? { select<T = any>(type: string): Stream<T>; }
  : { select<TYPE extends keyof SygnalEvents & string>(type: TYPE): Stream<SygnalEvents[TYPE]>; }

export type EventsSource<EVENTS = any> = Stream<Event<EVENTS>> & EventsSelect

export type DefaultDrivers<STATE, EVENTS = any> = {
  STATE: {
    source: StateSource<STATE>;
    sink: STATE;
  };
  DOM: {
    source: SygnalDOMSource;
    sink: never;
  };
  EVENTS: {
    source: EventsSource<EVENTS>;
    sink: EVENTS;
  };
  LOG: {
    source: never;
    sink: any;
  };
  CHILD: {
    source: ChildSource;
    sink: never;
  };
}

type Sources<DRIVERS> = {
  [DRIVER_KEY in keyof DRIVERS]: DRIVERS[DRIVER_KEY] extends { source: infer SOURCE } ? SOURCE : never
}

/**
 * Maps action types to streams for intent return type.
 * Uses Stream<any> for values to avoid invariance issues with xstream's Stream<T>
 * (e.g., Stream<PointerEvent> from DOM.events('click') not assignable to Stream<Event>).
 * Action data types are enforced at the model layer via reducer signatures.
 */
type IntentActions<ACTIONS> = keyof ACTIONS extends never
  ? { [action: string]: Stream<any> }
  : { [ACTION_KEY in keyof ACTIONS]: Stream<any> }

/**
 * Normalizes driver types. Passes through valid driver specs, returns {} for `any` or invalid types.
 * Supports both `type` aliases and `interface` declarations (interfaces lack implicit index
 * signatures, so a structural fallback check is needed).
 */
export type FixDrivers<DRIVERS> =
  0 extends (1 & DRIVERS)
    ? {}
    : DRIVERS extends DriverSpecs
      ? DRIVERS
      : keyof DRIVERS extends never
        ? {}
        : DRIVERS extends { [K in keyof DRIVERS]: { source: any; sink: any } }
          ? DRIVERS
          : {}

type CombinedSources<STATE, DRIVERS> = Sources<DefaultDrivers<STATE> & DRIVERS> & { dispose$: Stream<boolean> }

/**
 * The sources object an intent function receives (DOM, STATE, EVENTS, CHILD, dispose$, plus
 * any custom drivers). Use it to annotate an intent declared before its component:
 *
 *   const intent = ({ DOM }: IntentSources<State>) => ({ INC: DOM.click('.inc') })
 */
export type IntentSources<STATE = any, DRIVERS = {}> = CombinedSources<STATE, FixDrivers<DRIVERS>>

type StreamPayload<STREAM> = STREAM extends Stream<infer T> ? T : any

type IntentReturnToActions<RETURN> = {
  [ACTION_KEY in keyof RETURN & string]-?: StreamPayload<Exclude<RETURN[ACTION_KEY], undefined>>
}

/**
 * Derives the ACTIONS map (action name → payload type) from an intent function's type
 * (or from its return object type): each key's `Stream<T>` becomes `T`.
 *
 *   const intent = ({ DOM }: IntentSources<State>) => ({
 *     INC:  DOM.click('.inc').mapTo(1),          // Stream<number>
 *     NAME: DOM.input('.name').value(),         // Stream<string>
 *   })
 *   const Counter: Component<State, {}, {}, ActionsOf<typeof intent>> = ...
 *   Counter.intent = intent
 *   Counter.model  = { INC: (state, n) => ..., NAME: (state, name) => ... }  // n: number, name: string
 *
 * With it, model keys not returned by the intent are type errors (the built-ins BOOTSTRAP,
 * INITIALIZE and DISPOSE stay allowed). Actions reached only through `next()` or as reply actions
 * of a request (`ok: 'LOADED'`, `error: 'FAILED'`) are added explicitly, typed by their data:
 *
 *   type Actions = ActionsOf<typeof intent> & { SAVED: { id: string }; LOADED: Quote; FAILED: FetchFailure }
 */
export type ActionsOf<INTENT> = INTENT extends (...args: any[]) => infer RETURN
  ? IntentReturnToActions<RETURN>
  : IntentReturnToActions<INTENT>

interface ComponentIntent<STATE, DRIVERS, ACTIONS, CALCULATED = {}> {
  (args: IntentArgs<STATE, DRIVERS, CALCULATED>): Partial<IntentActions<ACTIONS>>
}

/**
 * What a component's intent receives. With calculated fields, STATE also matches
 * `StateSource<STATE>` (a stream of STATE & CALCULATED is also one of STATE), so an intent
 * annotated with the documented `IntentSources<State>` is accepted as well as
 * `IntentSources<State & Calculated>`; an inline intent sees the calculated fields.
 */
type IntentArgs<STATE, DRIVERS, CALCULATED> = keyof CALCULATED extends never
  ? CombinedSources<STATE, DRIVERS>
  : CombinedSources<STATE & CALCULATED, DRIVERS> & { STATE: StateSource<STATE> }

type CalculatedFieldValue<FULL_STATE, RETURN> =
  | StateOnlyReducer<FULL_STATE, RETURN>
  | [ReadonlyArray<string & keyof FULL_STATE>, StateOnlyReducer<FULL_STATE, RETURN>]

type Calculated<STATE, CALCULATED> = keyof CALCULATED extends never
  ? { [field: string]: boolean | CalculatedFieldValue<STATE, any> }
  : { [CALCULATED_KEY in keyof CALCULATED]: boolean | CalculatedFieldValue<STATE & CALCULATED, CALCULATED[CALCULATED_KEY]> }

type Context<STATE, CONTEXT> = keyof CONTEXT extends never
  ? { [field: string]: boolean | StateOnlyReducer<STATE, any> }
  : { [CONTEXT_KEY in keyof CONTEXT]: boolean | StateOnlyReducer<STATE, CONTEXT[CONTEXT_KEY]> }

export type Lense<PARENT_STATE = any, CHILD_STATE = any> = {
  get: (state: PARENT_STATE) => CHILD_STATE;
  set: (state: PARENT_STATE, childState: CHILD_STATE) => PARENT_STATE;
}

export type Lens<PARENT_STATE = any, CHILD_STATE = any> = Lense<PARENT_STATE, CHILD_STATE>

export type Filter<ITEM = any> = (item: ITEM) => boolean

export type SortFunction<ITEM = any> = (a: ITEM, b: ITEM) => number

/** Sort by one field: `{ name: 'asc' }`, `{ priority: -1 }` (one key; 1 = ascending). */
export type SortObject<ITEM = any> = {
  [field: string]: 'asc' | 'desc' | 1 | -1
}

/**
 * A Collection `sort`: 'asc'/'desc' (whole items), a field name (ascending), a comparator,
 * a SortObject, or an array of field names, SortObjects and comparators applied in order.
 */
export type SortSpec<ITEM = any> =
  | string
  | SortFunction<ITEM>
  | SortObject<ITEM>
  | ReadonlyArray<string | SortFunction<ITEM> | SortObject<ITEM>>

/**
 * Sygnal Component
 */
export type Component<
  STATE = any,
  PROPS = { [prop: string]: any },
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {},
  SINK_RETURNS extends NonStateSinkReturns = {},
  PROVIDED_CONTEXT = CONTEXT
> = ComponentProps<STATE & CALCULATED, PROPS, CONTEXT> & {
  label?: string;
  DOMSourceName?: string;
  stateSourceName?: string;
  model?: ComponentModel<STATE, PROPS, FixDrivers<DRIVERS>, ACTIONS, CALCULATED, SINK_RETURNS, CONTEXT>;
  intent?: ComponentIntent<STATE, FixDrivers<DRIVERS>, ACTIONS, CALCULATED>;
  initialState?: STATE;
  /**
   * Give a sub-component its own state instead of the slice its parent passes in.
   * Required to use `initialState` on a sub-component (otherwise SYG405). Without a
   * `state` prop the state is local to the instance and never written to the parent.
   */
  isolatedState?: boolean;
  calculated?: Calculated<STATE, CALCULATED>;
  storeCalculatedInState?: boolean;
  /**
   * Context this component provides to itself and its descendants. Typed by PROVIDED_CONTEXT,
   * which defaults to CONTEXT (the context the view and reducers see).
   */
  context?: Context<STATE & CALCULATED, PROVIDED_CONTEXT>;
  peers?: { [name: string]: Component };
  components?: { [name: string]: Component };
  onError?: (error: Error, info: { componentName: string }) => any;
  debug?: boolean;
  /**
   * WebSocket / server-sent events connections derived from state (`makeSocketDriver()`):
   * `Chat.connections = (state) => ({ room: state.room && { socket: '/ws/rooms/' + state.room, message: 'RECEIVED' } })`.
   * Recomputed from the current state (after the action's reducer) and sent to the socket
   * driver's sink whenever the result changes structurally (once at startup too): a new name
   * opens, a removed or falsy one closes, a changed URL reconnects. Events arrive as the named
   * actions on this instance; send with `{ to: 'room', json }` from a model entry (a connection
   * the same action opens or changes is declared first). Dispose closes them.
   */
  connections?: (state: STATE & CALCULATED) => Connections;
  /**
   * PLAN-3: declarative reads (`makeFetchDriver()`). Each entry derives a
   * request from state; falsy means idle:
   * `Quote.resources = { quote: (state) => state.id && '/api/quotes/' + state.id }`.
   * `state.quote` is a `Resource`: `{ status: 'idle' | 'loading' | 'success' | 'error', data,
   * error, refreshing }`, written by the built-in RESOURCE action (idle until the first request).
   * A changed request is fetched with latest semantics (the stale one aborted, its reply never
   * shown): 'loading' with no data (unless `keepPrevious: true`). A refetch of the same request
   * (`{ refresh: 'quote' }` on the HTTP sink, `{ invalidate }`, focus, `refetchEvery`) keeps
   * `data`, `error` and `status` and sets `refreshing: true` (D78). `ok` / `error` on the
   * request also dispatch those actions after the write.
   */
  resources?: { [name: string]: (state: STATE & CALCULATED) => ResourceRequest | false | null | undefined | '' | 0 };
  /**
   * The router's reply action (`makeRouter()`): `App.route = 'ROUTE'`. The driver sends this
   * instance ROUTE with the `Route` (`{ name, params, query, hash, path }`) once declared and on
   * every change; the reducer stores it (`ROUTE: (state, route) => ({ ...state, route })`).
   * The first (outermost) declarer gets each route first and may redirect from that entry
   * (`ROUTER: { to: 'login', replace: true }`); the others get it a task later, only if no
   * redirect happened. A function of state may return a falsy value to stop listening. Works
   * with or without a model; a root needs `initialState` (SYG132), seeded with `router.current()`.
   */
  route?: string | ((state: STATE & CALCULATED) => string | false | null | undefined);
  /**
   * Document head values for `makeHeadDriver()`, derived from state: `App.head = (state) =>
   * ({ title: state.task?.title })`. Recomputed when the result changes; removed on dispose.
   * A later-mounted component's `title` wins; `meta` keys and `link`s merge. Also collected by
   * `renderToString(App, { head: list })` for SSR (`renderHead(list)`). Like every declaration
   * static, it is sent with or without a model; a root needs `initialState` (SYG132).
   */
  head?: (state: STATE & CALCULATED) => HeadValue | false | null | undefined;
  /**
   * PLAN-4 GS-1: behaviors this component uses, each under its state key:
   * `TaskList.uses = { pager: pager({ pageSize: 10, next: Newer, prev: Older }) }` gives
   * `state.pager` and the actions 'pager.NEXT', 'pager.PREV'. See `defineBehavior`.
   */
  uses?: { [key: string]: Behavior<any, any, any, any> };
  /**
   * PLAN-4 GS-7: timers derived from state, run by `makeTimerDriver()` (registered:
   * `run(App, { TIMER: makeTimerDriver() })`; renderComponent provides it) and delivered as this
   * instance's own actions:
   * `Stopwatch.timers = (state) => ({ tick: state.running && { every: 100, action: 'TICK' } })`.
   * Diffed by name whenever the result changes structurally: a new name starts, a falsy or
   * removed one stops, a changed spec restarts. `every` is drift-free (data `{ n, t }`), `after`
   * fires once (`{ t }`), `frame` runs every animation frame (`{ t, dt }`). A hidden Switchable
   * page's timers stop unless `background: true`; dispose stops them; nothing runs during SSR.
   */
  timers?: (state: STATE & CALCULATED) => Timers<ActionNameOf<ACTIONS>>;
  /**
   * PLAN-4 GS-5: save this root component's state and restore it at startup:
   * `TodoApp.persist = persist({ key: 'todo-app', pick: ['todos', 'filter'] })`. `pick` / `omit`
   * are typed against STATE's keys. Root component only (SYG224 elsewhere).
   */
  persist?: Persist<STATE>;
  /**
   * PLAN-4 GS-12: actions whose state change animates as a View Transition:
   * `Board.viewTransitions = ['MOVE']`, `App.viewTransitions = ['ROUTE']` (the router's reply
   * action) for route changes. The DOM patch that the action's STATE reducer causes runs inside
   * `document.startViewTransition()`, which needs the app's DOM driver from
   * `makeViewTransitionDOMDriver()` (SYG645 in dev otherwise). Patched at once, without a
   * transition, under `prefers-reduced-motion: reduce` and where the browser has no API.
   */
  viewTransitions?: Array<ActionNameOf<ACTIONS>>;
}

/** The action names of an ACTIONS map (any string when it names none) */
type ActionNameOf<ACTIONS> = keyof ACTIONS extends never ? string : keyof ACTIONS & string;

/**
 * Sygnal Root Component (the one passed to `run()`): a Component without props, so the
 * view's `state` is typed by STATE (& CALCULATED).
 */
export type RootComponent<
  STATE = any,
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {},
  SINK_RETURNS extends NonStateSinkReturns = {},
  PROVIDED_CONTEXT = CONTEXT
> = Component<STATE, {}, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS, PROVIDED_CONTEXT>

/**
 * A component function that can be used in Collection/Switchable.
 * Uses a permissive type to avoid contravariance issues with typed custom drivers.
 */
type AnyComponent = ((...args: any[]) => any) & Record<string, any>

/** Keys of STATE whose value is an array (optional/nullable arrays included). */
export type ArrayKeysOf<STATE> = {
  [KEY in keyof STATE]-?: NonNullable<STATE[KEY]> extends ReadonlyArray<any> ? KEY : never
}[keyof STATE] & string

/**
 * Valid `from` values for a Collection: any string or Lense while the parent STATE is unknown
 * (`any`); otherwise an array-valued key of STATE or a Lense over STATE.
 */
export type CollectionFrom<STATE = any> = 0 extends (1 & STATE)
  ? string | Lense
  : ArrayKeysOf<STATE> | Lense<STATE, any>

/**
 * Collection props. Pass the parent component's state type as STATE to type-check `from`:
 *
 *   const TaskCollection = Collection<{}, LaneState>   // instantiation expression
 *   <TaskCollection of={TaskCard} from="tasks" />       // 'tasks' must be an array key of LaneState
 */
export type CollectionProps<PROPS = any, STATE = any> = {
  of: AnyComponent;
  from: CollectionFrom<STATE>;
  filter?: Filter;
  sort?: SortSpec;
  /**
   * Item field used as the key that tracks each item (its component instance, isolation
   * scope and DOM) across updates. Items are keyed by `id` by default; keys should be
   * unique and stable (an item without the field is keyed by its index).
   */
  idfield?: string;
} & Omit<PROPS, 'of' | 'from' | 'filter' | 'sort' | 'idfield'>

export type SwitchableProps<PROPS = any> = {
  of: Record<string, AnyComponent>;
  current: string;
  /**
   * The current page's instance key. When it changes, the current page is disposed and created
   * again (fresh state); a hidden page shown with another key than it last had is re-created on
   * show. Switching `current` alone keeps pages alive. Router recipe: `instance={state.route.path}`
   */
  instance?: string | number;
  state?: string | Lense;
} & Omit<PROPS, 'of' | 'state' | 'current' | 'instance'>

export type PortalProps = {
  target: string;
  children?: any;
}

export type TransitionProps = {
  name?: string;
  duration?: number;
  appear?: boolean;
  children?: any;
}

export type SuspenseProps = {
  /**
   * Shown (wrapped in `<div data-sygnal-suspense="pending">`) while any child is not ready:
   * a `lazy()` component still loading, or a component with an explicit READY model entry
   * that hasn't emitted true. A string renders as text. Without it the children render as-is.
   */
  fallback?: JSX.Element | string;
  children?: any;
}

export type SlotProps = {
  name?: string;
  children?: any;
}

export type ClassesType = (string | string[] | { [className: string]: boolean | undefined })[]

/**
 * Diagnostics mode.
 * - 'off'     — no checks, no collection (default in production)
 * - 'collect' — collect diagnostics silently (read with getDiagnostics())
 * - 'warn'    — collect and print warn/error diagnostics to the console (default in Vite dev)
 * - 'error'   — collect and throw on warn/error diagnostics
 */
export type DiagnosticsMode = 'off' | 'collect' | 'warn' | 'error'

/** Stable diagnostic code, e.g. 'SYG101'. See https://sygnal.js.org/reference/errors */
export type DiagnosticCode = `SYG${number}`

export type DiagnosticSeverity = 'error' | 'warn' | 'info'

export type Diagnostic = {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  /** Name of the component the diagnostic is about */
  component?: string;
  /** What is wrong */
  message: string;
  /** How to fix it */
  fix?: string;
  /** Structured payload (check-specific) */
  data?: any;
  /** Link to the docs entry for this code */
  docsUrl: string;
  /** Fully formatted message: `[Sygnal SYG123] Component: message. fix docsUrl` */
  text: string;
  timestamp: number;
}

export type DiagnosticsOptions = {
  mode?: DiagnosticsMode;
  /** Codes to ignore entirely */
  ignore?: DiagnosticCode[];
  /**
   * Strict (canonical-form, SYG5xx) runtime checks. Needs the 'sygnal/diagnostics' dev entry
   * (otherwise SYG608 is printed once). Without a `mode`, `strict: true` also turns diagnostics
   * on ('warn'). Omitted: an earlier `configureStrict()` setting is kept.
   */
  strict?: boolean;
}

/**
 * Where an error reported to the app-level `onError` hook happened (PLAN-4 GS-11). `'widget'` is
 * reserved for widgets (PLAN-5); nothing in the core reports it.
 */
export type AppErrorPhase = 'view' | 'reducer' | 'effect' | 'declaration' | 'driver' | 'instantiate' | 'widget'

/** What the app-level `onError` hook gets with the error */
export interface AppErrorInfo {
  /** The component whose view, reducer, EFFECT or sub-component threw (not for 'driver') */
  componentName?: string
  /** The action whose reducer or EFFECT threw ('reducer', 'effect') */
  action?: string
  phase: AppErrorPhase
  /** The driver (sink) name, for 'driver' */
  driver?: string
}

/**
 * App-level error hook: reporting only (e.g. to an error tracker). It is called after the
 * component's own `onError` boundary chose the fallback, once per error, in every diagnostics
 * mode. An exception thrown by the hook is logged with console.error and swallowed.
 */
export type AppErrorHook = (error: any, info: AppErrorInfo) => void

export type RunOptions = {
  mountPoint?: string;
  fragments?: boolean;
  useDefaultDrivers?: boolean;
  /**
   * Runtime diagnostics. Takes precedence over `globalThis.__SYGNAL_DEV__`
   * (set by the Sygnal Vite plugin in dev), which enables 'warn'. Default: 'off'.
   */
  diagnostics?: DiagnosticsMode | DiagnosticsOptions;
  /** App-level error hook for this app (each run() has its own); see AppErrorHook */
  onError?: AppErrorHook;
  /**
   * The root of this app's `uid()` strings (default 'u'). Give each app on one page its own
   * (`run(Signup, {}, { mountPoint: '#signup', uid: 'signup' })`), and pass the same value to
   * renderToString's `uid` when hydrating server markup.
   */
  uid?: string;
}

/** All diagnostics collected so far (most recent last). */
export function getDiagnostics(): Diagnostic[]

/** Clear the collected diagnostics. */
export function clearDiagnostics(): void

/** Subscribe to diagnostics as they are reported. Returns an unsubscribe function. */
export function onDiagnostic(callback: (diagnostic: Diagnostic) => void): () => void

export type {
  InspectGraph,
  InspectComponent,
  InspectAction,
  InspectActionTrigger,
  InspectChild,
  InspectSelector,
  InspectDiagnostic,
  InspectRecentAction,
  InspectCommand,
  InspectTimer,
} from './extra/diagnostics/checks/public'

/**
 * The Sygnal DevTools bridge (also `window.__SYGNAL_DEVTOOLS__`), installed in a
 * browser by the dev-only 'sygnal/devtools' entry, which sygnal/vite injects in dev.
 * Only the stable, documented members are typed.
 */
export interface SygnalDevTools {
  /** true while the browser extension is connected */
  readonly connected: boolean
  /** Diagnostics collected so far (same as getDiagnostics()) */
  getDiagnostics(): Diagnostic[]
  /**
   * The machine-readable app graph of the live components. Present only when the
   * 'sygnal/diagnostics' dev entry is loaded (it attaches this method); needs diagnostics on.
   */
  inspect?(): InspectGraph
  /** PLAN-4 3-E (G-226): defaults for "Copy as test" from the extension panel (componentImport, drivers, ...) */
  configureCopyAsTest(options: DevToolsCopyAsTestOptions): void
  /**
   * PLAN-4 3-E (G-226): one instance's recorded session: undefined (the newest root), an
   * instance id, a component, or run()'s result
   */
  getSession(target?: string | number | ((...args: any[]) => any) | { sources: any }): DevToolsSessionRecording
}

/** "Copy as test" options (the same as CopyAsTestOptions in 'sygnal/devtools') */
export interface DevToolsCopyAsTestOptions {
  /** The import line(s) for the component (default: `import <Name> from './<Name>.js'`) */
  componentImport?: string
  /** The component's identifier in the test (default: its recorded name) */
  componentName?: string
  /** More import lines (drivers, helpers) */
  imports?: string[]
  /** Drivers for renderComponent, as source code by sink name: { DND: 'mockDragDriver().driver' } */
  drivers?: Record<string, string>
  /** More renderComponent options, as source code: 'strict: true' */
  renderOptions?: string
  /** The test's name */
  testName?: string
  /** Adds a `// @vitest-environment <env>` first line */
  environment?: string
}

export type DevToolsActionCause = 'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior'

/** One instance's recorded session (the same as SessionRecording in 'sygnal/devtools') */
export interface DevToolsSessionRecording {
  version: 1
  component: string
  instance: string
  /** The state when the session started for this instance */
  initialState?: any
  /** The component's own initialState (renderComponent's default) */
  definitionInitialState?: any
  finalState: any
  /** The action names the component can be sent (model keys, behavior actions) */
  actionNames?: string[]
  /** Source names beyond DOM / EVENTS / STATE / LOG / CHILD / PARENT / READY */
  drivers: string[]
  /** Those of `drivers` renderComponent fakes (makeFetchDriver sources) */
  fakeable: string[]
  /** The instance's own actions, in order */
  actions: Array<{ type: string; data: any; cause: DevToolsActionCause; sinks: string[]; at: number; replySink?: string; replyKind?: 'fetch' | 'other'; echo?: true }>
  /** State changes in descendant instances a replay at this instance can't reproduce */
  foreign: Array<{ type: string; component: string; instance: string; cause: DevToolsActionCause }>
  truncated?: boolean
}

/** The installed DevTools bridge; undefined unless 'sygnal/devtools' was loaded (always in production builds). */
export function getDevTools(): SygnalDevTools | undefined

export type SygnalSinks<STATE = any, DRIVERS = {}> = {
  [SINK_NAME in keyof (DefaultDrivers<STATE> & FixDrivers<DRIVERS>) | string]?: Stream<any>
}

export type AnyComponentModule<COMPONENT = any> =
  | COMPONENT
  | { default: COMPONENT }
  | Array<COMPONENT | { default: COMPONENT } | null | undefined>
  | null
  | undefined

export type SygnalApp<STATE = any, DRIVERS = {}> = {
  sources: CombinedSources<STATE, FixDrivers<DRIVERS>>;
  sinks: SygnalSinks<STATE, DRIVERS>;
  dispose: () => void;
  hmr: (newComponent?: AnyComponentModule<RootComponent<STATE, DRIVERS>>, state?: STATE) => void;
}

export type HotModuleAPI = {
  accept: (...args: any[]) => any;
  dispose?: (callback: () => void) => void;
}

export function run<
  STATE = any,
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {}
>(
  component: RootComponent<STATE, DRIVERS, ACTIONS, CALCULATED, CONTEXT>,
  drivers?: Partial<DriverFactories<FixDrivers<DRIVERS>>> & Record<string, CycleDriver<any, any>>,
  options?: RunOptions
): SygnalApp<STATE & CALCULATED, FixDrivers<DRIVERS>>

export function run(
  component: any,
  drivers?: Record<string, CycleDriver<any, any>>,
  options?: RunOptions
): SygnalApp<any, {}>

export function enableHMR<STATE = any, DRIVERS = {}>(
  app: SygnalApp<STATE, DRIVERS>,
  hot: HotModuleAPI,
  loadComponent?: () => Promise<AnyComponentModule<RootComponent<STATE, DRIVERS>>> | AnyComponentModule<RootComponent<STATE, DRIVERS>>,
  acceptDependencies?: string | string[]
): SygnalApp<STATE, DRIVERS>

export function classes(...classes: ClassesType): string
export function exactState<STATE>(): <ACTUAL extends STATE>(state: ExactShape<STATE, ACTUAL>) => STATE

// ── Reducer helpers ────────────────────────────────────────────────

/**
 * Create a reducer that merges a partial update into state.
 *
 * Static form — merge a fixed object:
 *   `set({ isEditing: true })`
 *
 * Dynamic form — function receives (state, data, next, props) and
 * returns the partial update to merge:
 *   `set((state, title) => ({ title }))`
 *
 * Not a field name: `set('title')` is a type error (and SYG221 in the dev checks).
 */
export function set<S = any>(
  partial: (Partial<S> & object) | ((state: S, data: any, next: Function, props: any) => Partial<S>)
): (state: S, data: any, next: Function, props: any) => S

/**
 * Create a reducer that toggles a boolean field on state.
 *
 *   `toggle('showModal')`
 */
export function toggle<S = any>(field: keyof S & string): (state: S) => S

type EmitEntry<TYPE extends string> = keyof SygnalEvents extends never
  ? { EVENTS: (state: any, actionData: any, next: Function, props: any) => { type: string; data: any } }
  : { EVENTS: (state: any, actionData: any, next: Function, props: any) => EmittedEvent<TYPE> }

/**
 * Create a model entry that emits an EVENTS bus event.
 * Prefer `event()` inside the object form: `ACTION: { EVENTS: event('TYPE', fn) }`.
 *
 *   `emit('DELETE_LANE', (state) => ({ laneId: state.id }))`
 *   `emit('REFRESH')`
 *
 * With a `SygnalEvents` registry, `type` and the payload are checked against it.
 */
export function emit<TYPE extends EventName>(
  type: TYPE,
  data: (state: any, actionData: any, next: Function, props: any) => EventPayload<TYPE>
): EmitEntry<TYPE>
export function emit<TYPE extends EventName>(
  type: TYPE,
  ...data: StaticEventArgs<TYPE>
): EmitEntry<TYPE>

/**
 * Create an EVENTS sink function that puts `{ type, data }` on the EVENTS bus.
 * Use it as the `EVENTS` value inside an object-form model entry:
 *
 *   DELETE: {
 *     STATE:  (state) => ({ ...state, deleting: true }),
 *     EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })),
 *   }
 *
 * The payload is either a function `(state, data, next, props) => payload` or a static value:
 *   `event('RESET')`, `event('SET_MODE', 'dark')`.
 *
 * With a `SygnalEvents` registry, `type` must be a registered name and the payload must match
 * its type. When used inside a model, the payload function's `state` and `data` parameters are
 * typed from the component.
 */
export function event<TYPE extends EventName, STATE = any, DATA = any>(
  type: TYPE,
  ...payload: EventArgs<TYPE, STATE, DATA>
): EventSink<TYPE, STATE, DATA>

/**
 * The payload argument of `event()`: a payload function or a static value (one signature, not
 * overloads, so an unregistered name is reported as one "not assignable to parameter" error).
 */
type EventArgs<TYPE extends string, STATE, DATA> = keyof SygnalEvents extends never
  ? [payload?: EventPayloadFunction<TYPE, STATE, DATA> | AnySinkConstant]
  : undefined extends EventPayload<TYPE>
    ? [payload?: EventPayloadFunction<TYPE, STATE, DATA> | EventPayload<TYPE>]
    : [payload: EventPayloadFunction<TYPE, STATE, DATA> | EventPayload<TYPE>]

/**
 * Any object with an events() method (e.g., DOM.select('form')).
 * Uses permissive signature to be compatible with MainDOMSource's overloaded events().
 */
export type FormSource = {
  events(eventName: string, ...args: any[]): Stream<any>
}

export type FormData<FIELDS extends Record<string, string> = Record<string, string>> = FIELDS & {
  event: globalThis.Event;
  eventType: string;
}

export type ProcessFormOptions = {
  events?: string | string[];
  preventDefault?: boolean;
}

/**
 * Extracts form field values from a DOM source's form events.
 *
 * @example
 * // Untyped — all fields are `string`
 * const form$ = processForm(DOM.select('form'))
 * // form$ is Stream<FormData>  →  { event, eventType, [field]: string }
 *
 * @example
 * // Typed — specify expected field names
 * const form$ = processForm<{ username: string; email: string }>(DOM.select('form'))
 * // form$ is Stream<FormData<{ username: string; email: string }>>
 * // form$.username is typed as string ✓
 */
export function processForm<FIELDS extends Record<string, string> = Record<string, string>>(
  target: FormSource,
  options?: ProcessFormOptions
): Stream<FormData<FIELDS>>

/**
 * Any object with an events() method (e.g., DOM.select('.draggable')).
 * Uses permissive signature to be compatible with MainDOMSource's overloaded events().
 */
export type DragSource = {
  events(eventName: string, ...args: any[]): Stream<any>
}

export function processDrag(
  sources?: { draggable?: DragSource; dropZone?: DragSource },
  options?: { effectAllowed?: string }
): {
  dragStart$: Stream<DragEvent>
  dragEnd$: Stream<null>
  dragOver$: Stream<null>
  drop$: Stream<DragEvent>
}

export type DragDriverRegistration = {
  category:   string;
  draggable?: string;
  dropZone?:  string;
  /** Restricts which dragging category this drop zone will accept. Omit to accept any. */
  accepts?:   string;
  /** CSS selector for a drag preview element. Resolved as the nearest ancestor of the draggable element. */
  dragImage?: string;
}

export type DragStartPayload = {
  element: HTMLElement;
  dataset: Record<string, string>;
}

export type DropPayload = {
  dropZone:     HTMLElement;
  insertBefore: HTMLElement | null;
}

export type DragDriverCategory = {
  events(eventType: 'dragstart'): Stream<DragStartPayload>;
  events(eventType: 'dragend'):   Stream<null>;
  events(eventType: 'drop'):      Stream<DropPayload>;
  events(eventType: string):      Stream<any>;
}

export type DragDriverSource = {
  select(category: string): DragDriverCategory;
  dragstart(category: string): Stream<DragStartPayload>;
  dragend(category: string): Stream<null>;
  drop(category: string): Stream<DropPayload>;
  dragover(category: string): Stream<any>;
  dispose(): void;
}

export function makeDragDriver(): (sink$: Stream<DragDriverRegistration | DragDriverRegistration[]>) => DragDriverSource

export type ComponentFactoryOptions<
  STATE = any,
  PROPS = any,
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {},
  SINK_RETURNS extends NonStateSinkReturns = {}
> = {
  name?: string;
  view: Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>;
  model?: Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>['model'];
  intent?: Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>['intent'];
  hmrActions?: string | string[];
  context?: Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>['context'];
  peers?: { [name: string]: Component };
  components?: { [name: string]: Component };
  initialState?: STATE;
  calculated?: Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>['calculated'];
  storeCalculatedInState?: boolean;
  DOMSourceName?: string;
  stateSourceName?: string;
  debug?: boolean;
}

export function component<
  STATE = any,
  PROPS = any,
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {},
  SINK_RETURNS extends NonStateSinkReturns = {}
>(
  options: ComponentFactoryOptions<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>
): Component<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>

export function collection(...args: any[]): any
export function switchable(...args: any[]): any
export function portal(...args: any[]): any

export function Collection<PROPS extends { [prop: string]: any }, STATE = any>(props: CollectionProps<PROPS, STATE>): JSX.Element
export function Switchable<PROPS extends { [prop: string]: any }>(props: SwitchableProps<PROPS>): JSX.Element
export function Portal(props: PortalProps): JSX.Element
export function Transition(props: TransitionProps): JSX.Element
export function Suspense(props: SuspenseProps): JSX.Element
export function Slot(props: SlotProps): JSX.Element

/**
 * What `lazy()` returns: a sub-component used in JSX with its own props only
 * (`<Chart title="Sales" />`; `state` is optional, as for any sub-component), that
 * still carries the component statics (`model`, `intent`, …) once loaded.
 */
export type LazyComponent<PROPS = any> = ((
  props: PROPS & { state?: any; children?: JSX.Element | JSX.Element[] }
) => JSX.Element) & Omit<Component<any, PROPS>, never>

export function lazy<PROPS = any>(
  loadFn: () => Promise<{ default: Component<any, PROPS> } | Component<any, PROPS>>
): LazyComponent<PROPS>

/**
 * The reply-action keys of a request to makeFetchDriver or driverFromAsync: the
 * outcome becomes an action on exactly the component instance that sent the request, instead
 * of reaching `select()` / `errors()`.
 *
 *   LOAD:    { HTTP: (state) => ({ url: `/api/q/${state.id}`, ok: 'LOADED', error: 'FAILED' }) },
 *   LOADED:  (state, quote) => ({ ...state, quote }),          // data: the parsed body
 *   FAILED:  (state, { status }) => ({ ...state, status }),     // data: { error, status?, body?, request }
 *
 * The action's data type is not inferred from the request: type it in the component's ACTIONS
 * (`{ LOADED: Quote; FAILED: FetchFailure }`). `ok` / `error` are plain strings in the types (D70);
 * a name with no model entry is SYG112 (sygnal-check and the dev entry).
 */
export type ReplyRequest = {
  /** Action that receives the success value (fetch: the parsed body; driverFromAsync: the resolved value) */
  ok?: string;
  /** Action that receives the failure (`{ error, request }`, plus `status` / `body` for fetch) */
  error?: string;
  /** Not allowed: a `then` key makes the request a thenable (SYG610, not sent). Use `ok` */
  then?: never;
  /** Not allowed (SYG610, not sent). Use `error` */
  catch?: never;
}

/**
 * A request to a driverFromAsync() sink: your own fields (`value`, the args, ...) plus the
 * reply-action keys `ok` / `error`. Type the driver's sink with it: `{ QUOTE: { source:
 * AsyncDriverFromFunction; sink: AsyncRequest<{ value: number }> } }`.
 */
export type AsyncRequest<FIELDS = { [field: string]: any }> = FIELDS & ReplyRequest

/** Payload on `errors()` of a driverFromAsync source when a request fails */
export type AsyncDriverError<INCOMING = any> = {
  /** The rejection reason (or what `post` threw) */
  error: any;
  /** The request that failed */
  request: INCOMING;
  /** The request's selector property (default 'category') is copied here (not for an `error` reply action) */
  [selectorProperty: string]: any;
}

export type AsyncDriverFromFunction<INCOMING = any, OUTGOING = any> = {
  select: (selector?: string | ((value: OUTGOING) => boolean)) => Stream<OUTGOING>
  /**
   * Failed requests (rejected promise, rejected/throwing `post`). Filters like
   * `select()`. Failures are only console.error'd while nothing listens here.
   */
  errors: (selector?: string | ((error: AsyncDriverError<INCOMING>) => boolean)) => Stream<AsyncDriverError<INCOMING>>
}

export type DriverFromAsyncOptions<INCOMING = any, OUTGOING = any, RETURN = any> = {
  selector?: string;
  args?: string | string[] | ((incoming: INCOMING) => any | any[]);
  return?: string | undefined;
  pre?: (incoming: INCOMING) => INCOMING;
  post?: (value: RETURN, incoming: INCOMING) => OUTGOING | Promise<OUTGOING>;
}

export function driverFromAsync<INCOMING = any, RETURN = any, OUTGOING = any>(
  promiseReturningFunction: (...args: any[]) => Promise<RETURN>,
  options?: DriverFromAsyncOptions<INCOMING, OUTGOING, RETURN>
): (fromApp$: Stream<INCOMING>) => AsyncDriverFromFunction<INCOMING, OUTGOING>

/** fetch() options a request (or the driver) may set under `init`; the driver owns `signal` */
export type FetchInit = {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: any;
  mode?: string;
  credentials?: 'omit' | 'same-origin' | 'include';
  cache?: string;
  redirect?: string;
  referrer?: string;
  referrerPolicy?: string;
  integrity?: string;
  keepalive?: boolean;
  priority?: 'high' | 'low' | 'auto';
  window?: null;
  duplex?: 'half';
}

/**
 * A request sent to a makeFetchDriver() sink. A plain string is a GET of that URL.
 * Other fetch() options go under `init` (`init: { credentials: 'include' }`). Any other key is
 * the app's own: not sent, but returned on the reply's `request`.
 *
 * Reply actions (canonical): `{ url, ok: 'LOADED', error: 'FAILED' }` delivers the parsed body as
 * LOADED, a failure as FAILED (`FetchFailure`), to exactly the sending instance (see
 * ReplyRequest). Without `ok` / `error` the reply goes to `select()` / `errors()`.
 *
 * Isolation: the replies, `latest` and `abort` of a component instance are its own (and its
 * descendants'): two instances, or Collection items, using the same category never see or
 * cancel each other's requests. The root component sees every reply.
 */
export type FetchRequest = string | {
  /** Request URL (prefixed with the driver's `baseUrl`) */
  url: string;
  /** Reply action that receives the parsed body of a 2xx response (the Response with `parse: 'response'`) */
  ok?: string;
  /** Reply action that receives a failure, `{ error, status?, body?, request }` (FetchFailure) */
  error?: string;
  /**
   * Reply actions: the `latest` / `abort` group (default: the `ok` action, else `error`). Requests with
   * the same key from the same instance supersede each other under `latest: true`
   */
  key?: string;
  /** Without reply actions: tag read back with `select(category)` / `errors(category)`; also the `latest` / `abort` group */
  category?: string;
  /** Default: 'POST' when `json` or `body` is set, else 'GET' */
  method?: string;
  /** Merged over the driver's `headers`, case-insensitively (names are sent lowercased) */
  headers?: Record<string, string> | Headers;
  /**
   * Appended as a query string (`{ q: 'dune' }` → `?q=dune`), before any `#fragment`; null/undefined
   * values are skipped; an array repeats the key (`{ tag: ['a', 'b'] }` → `?tag=a&tag=b`)
   */
  query?: Record<string, string | number | boolean | null | undefined | Array<string | number | boolean | null | undefined>>;
  /** Sent as JSON.stringify(json), with `Content-Type: application/json` unless set */
  json?: any;
  /** Raw body (string, FormData, Blob, ...) */
  body?: any;
  /**
   * Latest only: sending this request aborts this component's requests still in flight in the
   * same category; their responses and errors are never delivered. Default: the driver's `latest`
   * option.
   */
  latest?: boolean;
  /** Fail with a TimeoutError (on `errors()`) after this many ms. Default: the driver's `timeoutMs` */
  timeoutMs?: number;
  /**
   * How the 2xx body becomes `value`: 'auto' (default; JSON when the content-type says json,
   * else text; 204 → null), 'json', 'text', 'response' (the Response), or a function.
   */
  parse?: 'auto' | 'json' | 'text' | 'response' | ((response: Response) => any);
  /** Other fetch() options (merged over the driver's `init`) */
  init?: FetchInit;
  /** Not allowed: a `then` key makes the request a thenable (SYG610, not sent). Use `ok` */
  then?: never;
  /** Not allowed (SYG610, not sent). Use `error` */
  catch?: never;
  /**
   * PLAN-3 5-3 (D79): cache this request's reply in the driver's `queryCache()` (any method; a
   * POST is SYG630; without a queryCache nothing is cached, SYG635). `false`: never cached (a
   * resource under `makeFetchDriver({ cache: queryCache() })` too). A request with reply actions
   * is otherwise one-send-one-request
   */
  cache?: boolean;
  /** How long a cached reply stays fresh, in ms (served without a fetch). Implies `cache` */
  staleTime?: number;
  /** Invalidation tags of this request (and its cache entry): `{ invalidate: 'quotes' }` matches `tags: ['quotes']` */
  tags?: string[];
  /**
   * After a 2xx reply: invalidate these tags / URL prefixes / the predicate's matches (like
   * `{ invalidate }`). A read of them already in flight is aborted, so an older reply never lands
   */
  invalidates?: FetchInvalidate;
  /**
   * PLAN-3 6-A (G-184; React Query's setQueryData): after a 2xx reply, write it into this
   * component's resources with these names (and their `queryCache()` entries) before the `ok`
   * action and before `invalidates`: `updates: 'item'` (the reply becomes `state.item.data`), or
   * `{ items: (list, reply) => newList }` to derive it. A read of them in flight is aborted;
   * other mounted resources on the same cache entry show it too. Resources without a request
   * (idle) are skipped. The `ok` action still gets the reply
   */
  updates?: string | string[] | Record<string, true | ((data: any, reply: any) => any)>;
  /**
   * Retries (default 0): a count, or a count with the backoff of makeSocketDriver's reconnect
   * (`{ count: 3, delayMs: 500, maxDelayMs: 10000, jitter: 0.2 }`; count defaults to 3).
   * Network errors, 408, 429 (a Retry-After in seconds wins) and 5xx are retried, never other
   * 4xx; the failure arrives once, after the last attempt, with `attempts`
   */
  retry?: number | FetchRetry;
  /**
   * A Standard Schema (zod, valibot, arktype, ...) the parsed 2xx body must pass; the reply is the
   * schema's (possibly transformed) value. A failure is an error with `issues`
   */
  validate?: StandardSchemaLike;
  /** Your own fields (an id, ...): not sent, returned on the reply's `request` */
  [appData: string]: any;
} | {
  /**
   * Cancel. Reply actions: `{ abort: 'LOADED' }` aborts this instance's requests in flight whose key
   * (`key`, else `ok`, else `error`) is 'LOADED'; `{ abort: true, key: 'search' }` does the same
   * by key. Without reply actions: `{ category: 'search', abort: true }` aborts this component's requests in
   * that category (all of them, reply-action ones included, without a category or key). Nothing is
   * delivered for a cancelled request.
   */
  abort: true | string;
  key?: string;
  category?: string;
} | {
  /** PLAN-3 3-A: refetch this instance's resource(s) by name, keeping data (nothing while idle) */
  refresh: string | string[];
} | {
  /**
   * PLAN-3 5-3 (D80), from any component: matching cache entries go stale and matching mounted
   * resources refetch, keeping data. With or without the cache
   */
  invalidate: FetchInvalidate;
} | {
  /**
   * PLAN-3 5-5 (H-7): fetch this request into the driver's `queryCache()` without a reply (a
   * fresh entry or the same fetch in flight: nothing new), so a resource that reads it later
   * renders 'success' at once. Without a queryCache it does nothing (SYG635)
   */
  prefetch: string | { url: string; [field: string]: any };
}

/**
 * What `{ invalidate }` / `invalidates` match: a tag (`tags: ['quotes']` on the request), a URL
 * prefix of the request's `url` (a string starting with '/'), several of them, or a predicate
 */
export type FetchInvalidate = string | string[] | ((request: any) => boolean);

/** Retry policy of a makeFetchDriver() request: the reconnect backoff of makeSocketDriver plus a count */
export type FetchRetry = SocketReconnect & {
  /** Retries after the first attempt. Default 3 in this object form */
  count?: number;
}

/** Any Standard Schema (https://standardschema.dev): an object with `~standard.validate` */
export type StandardSchemaLike = {
  readonly '~standard': {
    validate: (value: unknown) => {value?: any; issues?: ReadonlyArray<{message: string; path?: ReadonlyArray<any>}>} | Promise<{value?: any; issues?: ReadonlyArray<{message: string; path?: ReadonlyArray<any>}>}>;
    [key: string]: any;
  };
}

/** PLAN-3 5-3 (D79), D88: `queryCache(options)` */
export type FetchCacheOptions = {
  /** How long a reply stays fresh, in ms: a fresh entry is served without a fetch. Default 0 (always refetch, showing the cached data meanwhile) */
  staleTime?: number;
  /** How long an entry no resource uses is kept, in ms. Default 300000 (5 min); Infinity keeps it */
  gcTime?: number;
  /** Refetch stale mounted resources when the window regains focus / the page becomes visible. Default true */
  refetchOnFocus?: boolean;
  /** Refetch stale mounted resources when the browser comes back online. Default true */
  refetchOnReconnect?: boolean;
  /** PLAN-3 5-5 (H-7): entries to start with, from `dehydrate()` (SSR seeding) */
  initial?: QueryCacheSnapshot;
}

/** PLAN-3 5-5 (H-7): one entry of a `dehydrate()` snapshot (JSON-safe when `data` is) */
export type QueryCacheSnapshotEntry = {
  /** method, URL as written (query sorted), body and parse: `'GET /api/quotes/1'` */
  key: string;
  /** the parsed (and validated) body */
  data: any;
  /** when it was fetched (ms since the epoch): it is fresh until `updatedAt + staleTime` */
  updatedAt: number;
  /** the request's invalidation tags */
  tags?: string[];
}
export type QueryCacheSnapshot = QueryCacheSnapshotEntry[];

/** PLAN-3 D88: the query cache of a makeFetchDriver (`makeFetchDriver({ cache: queryCache() })`) */
export interface QueryCache {
  /** the entries with data, as a JSON-safe snapshot (serialise it into the page) */
  dehydrate(): QueryCacheSnapshot;
  /** writes a snapshot's entries (an entry newer than the snapshot's is kept) */
  hydrate(snapshot: QueryCacheSnapshot | null | undefined): void;
  /** writes one entry, keyed like the request (a loader on the server: `cache.set('/api/quotes/1', quote)`) */
  set(request: ResourceRequest, data: any): void;
  /** the driver given this cache fetches the request into it, without a reply (like the `{ prefetch }` command) */
  prefetch(request: ResourceRequest): void;
}

/**
 * PLAN-3 D88: the opt-in query cache, passed to `makeFetchDriver({ cache: queryCache({ staleTime: 30000 }) })`.
 * Resources' GET/HEAD replies are cached (stale-while-revalidate: cached data shows at once,
 * `refreshing` while it refetches; an entry younger than `staleTime` is served without a fetch),
 * identical cacheable requests in flight share one fetch, focus / reconnect refetch stale
 * mounted resources, and unused entries are dropped after `gcTime`. SSR seeding:
 * `renderToString(App, { cache })` renders cached resources as 'success', `dehydrate()` /
 * `queryCache({ initial })` carry the entries to the client. One cache per driver
 */
export function queryCache(options?: FetchCacheOptions): QueryCache

/** PLAN-3: a request a `resources` entry derives (a URL, or a request without `abort`) */
export type ResourceRequest = string | (Exclude<FetchRequest, string | { abort: true | string } | { refresh: string | string[] }> & {
  /**
   * Keep this resource live while its component is in a hidden Switchable page (default: a
   * hidden page's resources are paused, keeping their last result, and refetched when it is shown)
   */
  background?: boolean;
  /** D78: on a new request (key change), keep the previous `data` (status unchanged, `refreshing: true`) instead of 'loading' (pagination) */
  keepPrevious?: boolean;
  /** Refetch every this many ms after each result (skipped while the document is hidden) */
  refetchEvery?: number;
})

/**
 * PLAN-3: the state slot of a resource (`state.quote`), written by the built-in RESOURCE action.
 * `data` is the parsed (validated) body; `error` is the Error (`error.status` / `error.body` for
 * a non-2xx response, `error.issues` for a validation failure). D78: a refetch of the same
 * request keeps `data` and `error` with `refreshing: true`; a failed refetch keeps `data`.
 */
export type Resource<DATA = any, ERROR = any> =
  | { status: 'idle' | 'loading'; data?: undefined; error?: undefined; refreshing?: undefined }
  | { status: 'success'; data: DATA; error?: undefined; refreshing?: boolean }
  | { status: 'error'; data?: DATA; error: ERROR; refreshing?: boolean }

/** The data of the `error` reply action of a makeFetchDriver() request (`error: 'FAILED'`) */
export type FetchFailure<REQUEST = any> = {
  /**
   * 'HTTP 404 ...' for a non-2xx status (with `.status` and `.body`), the network error
   * (TypeError), the body parse error, a TimeoutError (`.name === 'TimeoutError'`), or
   * "fetch is not available"
   */
  error: any;
  /** HTTP status, for a non-2xx response (undefined for a network error or timeout) */
  status?: number;
  /** The non-2xx response's body, parsed like 'auto' */
  body?: any;
  /** The request as the app sent it */
  request: REQUEST;
  /** With `retry`: how many attempts were made */
  attempts?: number;
  /** With `validate`: the schema's issues (the body didn't validate) */
  issues?: ReadonlyArray<{message: string; path?: ReadonlyArray<any>}>;
}

/** A successful (2xx) response on `select()` of a makeFetchDriver() source */
export type FetchResponse<VALUE = any, REQUEST = any> = {
  /** The request's category */
  category: string | undefined;
  /** The parsed body (see `parse`) */
  value: VALUE;
  /** HTTP status */
  status: number;
  /** The request as the app sent it (any extra fields you put on it come back here) */
  request: REQUEST;
}

/** A failure on `errors()` of a makeFetchDriver() source */
export type FetchError<REQUEST = any> = {
  /**
   * 'HTTP 404 ...' for a non-2xx status (with `.status` and `.body`), the network error
   * (TypeError), the body parse error, a TimeoutError (`.name === 'TimeoutError'`), or
   * "fetch is not available"
   */
  error: any;
  category: string | undefined;
  request: REQUEST;
  /** HTTP status, for a non-2xx response (undefined for a network error or timeout) */
  status?: number;
  /** The non-2xx response's body, parsed like 'auto' */
  body?: any;
}

export type FetchSource<VALUE = any> = {
  /** 2xx responses: all of them, one category, or those a predicate accepts */
  select: (category?: string | ((response: FetchResponse<VALUE>) => boolean)) => Stream<FetchResponse<VALUE>>
  /** Failures. Filters like select(). While nothing listens, failures are console.error'd */
  errors: (category?: string | ((failure: FetchError) => boolean)) => Stream<FetchError>
}

export type FetchDriverOptions = {
  /** Prefix for every request URL, e.g. '/api' or 'https://api.example.com' */
  baseUrl?: string;
  /** Headers for every request (a request's own `headers` win, case-insensitively) */
  headers?: Record<string, string> | Headers;
  /** fetch() options for every request, e.g. `{ credentials: 'include' }` (a request's `init` wins) */
  init?: FetchInit;
  /**
   * Latest only for every request (a request's own `latest` wins). Default false. renderComponent's
   * fake can't see this option: write `latest: true` on the request (the canonical form)
   */
  latest?: boolean;
  /** Timeout for every request, in ms. Default: none */
  timeoutMs?: number;
  /** Default `parse` for every request. Default 'auto' */
  parse?: 'auto' | 'json' | 'text' | 'response' | ((response: Response) => any);
  /** The fetch implementation. Default: `globalThis.fetch`, read at each request (so test stubs apply) */
  fetch?: (input: string, init?: any) => Promise<any>;
  /**
   * PLAN-3 D88: the query cache, off by default: `cache: queryCache({ staleTime })`. On:
   * resources' GET/HEAD replies are cached (stale-while-revalidate: cached data shows at once,
   * `refreshing` while it refetches), identical cacheable requests in flight share one fetch,
   * and focus / reconnect refetch stale mounted resources
   */
  cache?: QueryCache;
  /** Default `retry` for GET/HEAD requests (a request's own `retry` applies to any method). Default 0 */
  retry?: number | FetchRetry;
}

/**
 * An HTTP driver over `fetch`: `run(App, { HTTP: makeFetchDriver() })`. Canonical: a request with reply actions
 * (`HTTP: (state) => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' })`) whose
 * outcome arrives as the LOADED (parsed body) or FAILED (FetchFailure) action of the sending
 * instance. Without reply actions: the model sends a
 * request (`HTTP: (state) => ({ category: 'quote', url: '/api/quote' })`); the intent reads
 * `HTTP.select('quote')` (`{ category, value, status, request }`) and `HTTP.errors('quote')`
 * (`{ error, category, request, status?, body? }`). Non-2xx statuses, network errors and
 * timeouts go to errors(), never select(). `latest: true` drops superseded requests;
 * `{ category, abort: true }` cancels; disposing the app aborts everything in flight.
 * During SSR no requests are made (server rendering runs views only). In renderComponent
 * tests, pass no driver and answer with `t.respond('HTTP', value)` / `t.fail('HTTP', 404)`.
 */
export function makeFetchDriver(options?: FetchDriverOptions): ((request$: Stream<any>) => FetchSource) & { cache?: QueryCache }

/**
 * Reconnect policy of a makeSocketDriver() connection. Delay of retry n (from 0):
 * `min(maxDelayMs, delayMs * 2^n)`, varied by ±`jitter` (a fraction). A fixed 1 s retry:
 * `{ delayMs: 1000, maxDelayMs: 1000, jitter: false }`. Defaults: 500 ms, 10 s, 0.2.
 */
export type SocketReconnect = {
  delayMs?: number;
  maxDelayMs?: number;
  /** false (or 0): no jitter; true: 0.2; a number: that fraction (0.2 = ±20%) */
  jitter?: boolean | number;
}

/** The reply actions of a connection. Each is optional; an event without one goes to `select()` */
export type SocketActions = {
  /** Action for each incoming message: the JSON-parsed frame when it parses, else the raw data (binary as is) */
  message?: string;
  /** Action when the connection opens, every time: `SocketOpen` (`{ reconnected }`) */
  open?: string;
  /**
   * Action when the connection closes or fails to open without the app closing it (never for a
   * connection the app removed or replaced, or on dispose): `SocketClose`
   */
  close?: string;
  /** Action on an error event: `{ error }` (`SocketError`) */
  error?: string;
  /**
   * Reconnect after a drop (default on, with jittered backoff; the driver's `reconnect` option
   * is the default). `false`: a drop closes the connection for good. SSE: EventSource retries
   * transient drops itself; this applies when it gives up
   */
  reconnect?: false | SocketReconnect;
  /** Default true: connections to the same URL (and protocols) share one socket. false: a socket of its own */
  share?: boolean;
  /**
   * Keep this connection open while its component is in a hidden Switchable page (default: a
   * hidden page's connections close, and open again as new ones when it is shown)
   */
  background?: boolean;
  /** Not allowed: a `then` key makes the value a thenable (SYG610). Use `message` / `open` */
  then?: never;
  catch?: never;
}

/** A WebSocket connection of `{ connections }` */
export type SocketConnection = SocketActions & {
  /** URL or path (`/ws/rooms/general`: resolved against the page, ws: for http:, wss: for https:), after `baseUrl` */
  socket: string;
  /** WebSocket subprotocols (part of the connection's identity: a change reconnects) */
  protocols?: string | string[];
}

/** A server-sent events (EventSource) connection of `{ connections }`: read-only */
export type SseConnection = SocketActions & {
  /** URL (after `baseUrl`) */
  sse: string;
  withCredentials?: boolean;
  /** Named events → actions: `{ 'price-update': 'PRICE' }` (data JSON-parsed when it parses) */
  events?: Record<string, string>;
}

/**
 * A value sent to a makeSocketDriver() sink: the sender's whole set of connections (a falsy
 * entry or a missing name closes that connection), or a message to send on one of them.
 */
/** A component's whole set of connections: a falsy entry (`state.room && { ... }`) means closed */
export type Connections = Record<string, SocketConnection | SseConnection | false | null | undefined | '' | 0>

export type SocketRequest =
  | { connections: Connections }
  | {
      /** The name of one of this instance's own WebSocket connections (else SYG611, not sent) */
      to: string;
      /** Sent as JSON.stringify(json) */
      json?: any;
      /** Sent as is */
      text?: string;
      /** Sent as is (ArrayBuffer, Blob, typed array) */
      binary?: any;
    }

/** Data of a connection's `open` action */
export type SocketOpen = { reconnected: boolean }
/** Data of a connection's `close` action (SSE: no code / reason) */
export type SocketClose = { code?: number; reason?: string; willReconnect: boolean }
/** Data of a connection's `error` action: the error Event (or the constructor's exception) */
export type SocketError = { error: any }

/** An event without a reply action, on `select(name?)` */
export type SocketEvent<DATA = any> =
  | { name: string; type: 'message'; data: DATA }
  | { name: string; type: 'open'; data: SocketOpen }
  | { name: string; type: 'close'; data: SocketClose }
  | { name: string; type: 'error'; data: SocketError }

export type SocketSource = {
  /** Events of connections without an action name for that event type, for one connection name or all */
  select: (name?: string) => Stream<SocketEvent>
}

export type SocketDriverOptions = {
  /** Prefix for relative URLs, e.g. '/api' or 'https://api.example.com' */
  baseUrl?: string;
  /** Default reconnect policy (a connection's `reconnect` wins, merged over it). Default on */
  reconnect?: false | SocketReconnect;
  /** Messages kept per connection while it (re)connects; the oldest are dropped. Default 100 */
  queueLimit?: number;
  /** The WebSocket class. Default: `globalThis.WebSocket`, read at connect time (so test stubs apply) */
  WebSocket?: any;
  /** The EventSource class. Default: `globalThis.EventSource`, read at connect time */
  EventSource?: any;
}

/**
 * WebSocket and server-sent events: `run(App, { WS: makeSocketDriver() })`. A component sends
 * `{ connections: { room: { socket: '/ws/rooms/general', message: 'RECEIVED', open: 'ONLINE',
 * close: 'DROPPED' } } }` to declare its connections (diffed by name: new ones open, removed or
 * falsy ones close, a changed URL reconnects) and `{ to: 'room', json: { text } }` to send.
 * Events arrive as the named actions on exactly that instance. Drops reconnect with backoff;
 * connections to the same URL are shared; a disposed instance's connections close. No
 * connections during SSR.
 */
export function makeSocketDriver(options?: SocketDriverOptions): (sink$: Stream<any>) => SocketSource

/** The names of the `:params` in a route pattern: ParamNames<'/tasks/:id'> = 'id' */
export type ParamNames<P extends string> =
  P extends `${string}:${infer K}/${infer Rest}` ? K | ParamNames<`/${Rest}`> :
  P extends `${string}:${infer K}` ? K : never;

/** Route names of a route table, without the `'*'` not-found route (`string` when not literal) */
export type RouteName<R extends Record<string, string>> =
  string extends keyof R ? string : { [K in keyof R & string]: R[K] extends '*' ? never : K }[keyof R & string];

/** href()'s params for one pattern: required when it has `:params`, none otherwise */
export type RouteParamsArg<P extends string> =
  string extends P ? [params?: Record<string, string | number>] :
  [ParamNames<P>] extends [never] ? [params?: Record<string, never>] :
  [params: { [K in ParamNames<P>]: string | number }];

export type RouteQuery = Record<string, string | number | boolean | null | undefined>;

/** The route value the `route` reply action carries */
export interface Route<NAME extends string = string> {
  /** the matched route's name (the `'*'` route's name when nothing matched; null without one) */
  name: NAME | null;
  /** decoded `:params` */
  params: Record<string, string>;
  /** the query string as an object (the last value of a repeated key) */
  query: Record<string, string>;
  /** the decoded fragment without '#' ('' when none) */
  hash: string;
  /** the path without `base`, normalised: no trailing slash, no empty segments */
  path: string;
}

/** A value for the router's sink (`ROUTER`); `{ route }` is reserved for the `route` static */
export type RouterCommand<R extends Record<string, string> = Record<string, string>> =
  | { to: RouteName<R>; params?: Record<string, string | number>; query?: RouteQuery; hash?: string; replace?: boolean; scroll?: boolean; force?: boolean; block?: string | false | null }
  | { url: string; replace?: boolean; scroll?: boolean; force?: boolean; block?: string | false | null }
  | { back: true; force?: boolean; block?: string | false | null } | { forward: true; force?: boolean; block?: string | false | null } | { go: number; force?: boolean; block?: string | false | null }
  | { block: string | false | null }
  | { prefetch: RouteName<R> | string; params?: Record<string, string | number>; query?: RouteQuery };

/**
 * The data of a block action (`{ block: 'CONFIRM_LEAVE' }`): the navigation that was not made.
 * Send `proceed` to the router's sink to make it anyway.
 */
export interface RouterBlocked {
  /** the URL the navigation would go to */
  to: string;
  route: Route;
  proceed: RouterCommand;
}

export interface RouterOptions<R extends Record<string, string> = Record<string, string>> {
  /** `{ name: '/path/:param' | '*' }`; first match wins; `'*'` is the not-found route */
  routes: R;
  /** path prefix the app lives under ('/app'); in hash mode, the page's path */
  base?: string;
  /** 'history' (default) or 'hash' (`/#/tasks/1`) */
  mode?: 'history' | 'hash';
  /** scroll to top on a push, restore on back/forward. Default true (false with `navigate`) */
  scroll?: boolean;
  /**
   * After a push or back/forward, once the DOM is quiet, focus the first match of these
   * comma-separated selectors, tried in order. Default '[data-router-focus],main h1,h1'; false disables
   */
  focus?: string | false;
  /** quiet time (ms) before scroll restore and focus. Default 30 */
  settleMs?: number;
  /**
   * called for `{ prefetch }` commands, e.g. to warm a route's data in the fetch driver's cache:
   * `prefetch: (route) => routeData[route.name]?.(route).forEach(cache.prefetch)`
   */
  prefetch?: (route: Route, url: string) => void;
  /** Vike: its `navigate()` (from 'vike/client/router'); the router then leaves links and history to Vike */
  navigate?: (url: string, options: { overwriteLastHistoryEntry: boolean }) => any;
  /** test seams: default the global window and its history, location and document */
  window?: any;
  history?: any;
  location?: any;
  document?: any;
}

/** The ROUTER source: reply actions plus the latest route */
export interface RouterSource {
  current(): Route | null;
  href: (name: string, params?: Record<string, string | number>, query?: RouteQuery, hash?: string) => string;
  dispose(): void;
}

export interface Router<R extends Record<string, string> = Record<string, string>> {
  routes: R;
  /** a link to a named route (pure, SSR-safe): href('task', { id: 2 }, { tab: 'notes' }) */
  href<N extends RouteName<R>>(name: N, ...args: [...RouteParamsArg<R[N]>, query?: RouteQuery, hash?: string]): string;
  /** the Route of a URL (a path or an absolute URL); pure */
  match(url: string): Route<RouteName<R>>;
  /** the Route of the current location, or of `url` (SSR: the request URL). The `initialState.route` seed */
  current(url?: string): Route<RouteName<R>>;
  /** the driver: `run(App, { ROUTER: router.driver })` */
  driver: (sink$: Stream<any>) => RouterSource;
  options: RouterOptions<R>;
}

/**
 * The SPA router: `export const router = makeRouter({ routes: { home: '/', task: '/tasks/:id',
 * notFound: '*' } })`, then `run(App, { ROUTER: router.driver })`. Components declare
 * `App.route = 'ROUTE'` and store the route; views link with `<a href={router.href('task', { id })}>`
 * (clicks are intercepted at the document); models navigate with `ROUTER: { to: 'task', params }`.
 */
export function makeRouter<const R extends Record<string, string>>(options: RouterOptions<R>): Router<R>

/** `makeRouter(options).driver` */
export function makeRouterDriver<const R extends Record<string, string>>(options: RouterOptions<R>): (sink$: Stream<any>) => RouterSource

/** A `head` static value or HEAD sink value */
export interface HeadValue {
  title?: string;
  /** `{ description: '...', 'og:title': '...' }`: og:/article:/... keys use `property`, others `name`; null removes */
  meta?: Record<string, string | null | undefined>;
  /** link tags; merged by `key`, else by `rel` for canonical, else by `rel` + `href` */
  link?: Array<{ rel: string; href: string; key?: string; [attr: string]: any }>;
}

/**
 * Document title, meta and link tags: `run(App, { HEAD: makeHeadDriver() })` with a `head`
 * static (`App.head = (state) => ({ title })`) or HEAD sink values from a model entry.
 * `titleTemplate: '%s · Tasks'` formats every title.
 */
/**
 * PLAN-4 GS-12: a DOM driver that runs the patches asked for by a component's
 * `viewTransitions` static inside `document.startViewTransition()`:
 * `run(App, { DOM: makeViewTransitionDOMDriver('#root') })`. It is `makeDOMDriver(mountPoint,
 * options)` with run()'s defaults (fragments on), plus the hook: one action's patches (a
 * Collection move is several) are folded into one transition (20 ms quiet window, capped at
 * 200 ms); `prefers-reduced-motion: reduce` and browsers without the API patch at once.
 */
export function makeViewTransitionDOMDriver(mountPoint?: string | Element | DocumentFragment, options?: import('./cycle/dom/makeDOMDriver').DOMDriverOptions): (vnode$: Stream<any>, name?: string) => MainDOMSource

export function makeHeadDriver(options?: { titleTemplate?: string; document?: any }): (sink$: Stream<any>) => { dispose(): void }

/**
 * PLAN-4 GS-7: one timer of a `timers` static. `every`: a positive interval in ms, drift-free
 * (tick n is due at start + n * every; a late tick coalesces the missed ones and n jumps);
 * `after`: once, after ms (0 or more); `frame`: every animation frame (requestAnimationFrame,
 * else every 16 ms). `background: true` keeps it running while its Switchable page is hidden.
 * An invalid spec is not started (SYG422 in dev).
 */
export type TimerSpec<ACTION extends string = string> =
  | { every: number; action: ACTION; background?: boolean; after?: never; frame?: never }
  | { after: number; action: ACTION; background?: boolean; every?: never; frame?: never }
  | { frame: ACTION; background?: boolean; every?: never; after?: never; action?: never }

/** A component's whole set of timers, by name: a falsy entry (`state.running && { ... }`) is stopped */
export type Timers<ACTION extends string = string> = { [name: string]: TimerSpec<ACTION> | false | null | undefined | 0 | '' }

/** The data of an `every` timer's action: the tick number from 1 (it jumps over coalesced ticks) and Date.now() */
export interface TimerTick { n: number; t: number }
/** The data of an `after` timer's action: Date.now() */
export interface TimerAfter { t: number }
/** The data of a `frame` timer's action: Date.now() and the ms since the previous frame (0 on the first) */
export interface TimerFrame { t: number; dt: number }

/**
 * PLAN-4 GS-7: runs the components' `timers` statics: `run(App, { TIMER: makeTimerDriver() })`.
 * The key is free (the core finds the driver by the static it takes); `TIMER` by convention.
 * Each timer's action goes to the instance that declared it. A disposed instance's timers stop;
 * app dispose stops them all. A component declaring `timers` with no timer driver gets SYG643 in dev.
 */
export function makeTimerDriver(): (sink$: Stream<any>) => { dispose(): void }

/** The tags for the head values `renderToString(App, { head: list })` collected (SSR) */
export function renderHead(list: Array<HeadValue | null | undefined | false>, options?: { titleTemplate?: string }): string

export interface Ref<T = HTMLElement> {
  current: T | null;
}

export interface Ref$<T = HTMLElement> extends Ref<T> {
  stream: MemoryStream<T | null>;
}

export function createRef<T = HTMLElement>(): Ref<T>
export function createRef$<T = HTMLElement>(): Ref$<T>

export interface Command {
  send(type: string, data?: any): void;
}

export interface CommandSource {
  select(type: string): Stream<any>;
}

export function createCommand(): Command

// ── PWA Helpers ──────────────────────────────────────────────

export interface ServiceWorkerSource {
  select(type?: 'installed' | 'activated' | 'waiting' | 'controlling' | 'error' | 'message' | string): Stream<any>;
}

export interface ServiceWorkerCommand {
  action: 'skipWaiting' | 'postMessage' | 'unregister';
  data?: any;
}

export interface ServiceWorkerOptions {
  scope?: string;
}

export function makeServiceWorkerDriver(
  scriptUrl: string,
  options?: ServiceWorkerOptions
): (sink$: Stream<ServiceWorkerCommand>) => ServiceWorkerSource

export const onlineStatus$: Stream<boolean>

export interface InstallPrompt {
  select(type: 'beforeinstallprompt' | 'appinstalled'): Stream<any>;
  prompt(): Promise<any> | undefined;
}

export function createInstallPrompt(): InstallPrompt

export interface SimulatedEventInit {
  /** Merged into `event.target` (value, checked, dataset, ...) */
  target?: Record<string, any>;
  /** Shorthand for target.value */
  value?: any;
  /** Shorthand for target.checked */
  checked?: boolean;
  /** Merged into target.dataset (values become strings, like the DOM) */
  dataset?: Record<string, any>;
  /** Alias for dataset */
  data?: Record<string, any>;
  /** Keyboard key (e.key) */
  key?: string;
  /**
   * Don't fail when the selector matches no rendered element: wait up to 300ms for it, then
   * drop the event with SYG103 (info). Not copied onto the event.
   */
  allowMissing?: boolean;
  /**
   * Target the matching element inside the first element matching this selector or control
   * (e.g. one Collection item): `t.simulateEvent(Done, 'click', { within: '[data-id="2"]' })`.
   * Not copied onto the event.
   */
  within?: string | AnyControl;
  /** Any other event properties are copied onto the event */
  [prop: string]: any;
}

/**
 * Which request a t.respond()/t.fail() answers, as options. An object with only these keys is
 * options; any other object is a request pattern (see `respond`).
 */
export interface FakeReplyOptions {
  /** Only requests with this category */
  category?: string;
  /**
   * The request to answer, compared by value: a request object (e.g. an element of
   * t.requests(name), or the constant the model returns; among equal pending requests that very
   * object, else the newest), a partial request (`{ url: '/a' }`), a URL string, or a predicate
   * `(request) => boolean`. `null`: push the value without a request (for a source that emits
   * on its own); `category` then sets its category.
   */
  request?: any;
  /** respond(): the status (default 200). fail(): an HTTP error response with this status */
  status?: number;
  /** fail(): the parsed error body */
  body?: any;
  /**
   * That very request by its position in t.requests(name) (counting only those matching
   * `request`/`category`): 0 the first, -1 the newest. Answers the older of two identical
   * requests; throws at the call when it is no longer pending (answered, aborted, superseded).
   */
  nth?: number;
}

/** A connection on a driverless socket sink, as `t.connections(name)` lists it: the spec as declared plus these */
export interface FakeConnection {
  /** Its name in `{ connections: { [name]: spec } }` */
  name: string;
  /** The URL as declared (WebSocket) */
  socket?: string;
  /** The URL as declared (server-sent events) */
  sse?: string;
  /** The URL it opened (a socket path resolves to ws:/wss: on the page's host) */
  url: string;
  /** 'closed': dropped (t.drop), waiting for a retry, or gone (reconnect: false) */
  state: 'connecting' | 'open' | 'closed';
  /** The name of the component that declared it */
  sender: string;
  [key: string]: any;
}
/**
 * Which connections t.open / t.push / t.drop act on: a connection name or URL (as declared or
 * opened), a partial FakeConnection compared by value (`{ socket: '/ws/a' }`), or a predicate.
 * Nothing: the newest connection that can take the call.
 */
export type FakeConnectionTarget = string | Record<string, any> | ((connection: FakeConnection) => boolean);

/** PLAN-3 5-3: a cache entry of an HTTP fake (t.cache) */
export type FakeCacheEntry = {
  /** method, URL (query sorted), body and parse */
  key: string;
  /** ms since the reply was cached (undefined before data arrives) */
  age?: number;
  /** older than staleTime, or invalidated */
  stale: boolean;
  /** mounted resources using it */
  subscribers: number;
  /** the parsed body */
  data: any;
}

export interface RenderOptions {
  /** Override initial state (defaults to component's .initialState) */
  initialState?: any;
  /** Mock DOM configuration — maps selectors to event streams */
  mockConfig?: Record<string, any>;
  /** The app-level error hook, as run()'s `onError` (PLAN-4 GS-11) */
  onError?: AppErrorHook;
  /**
   * Additional drivers beyond DOM, EVENTS, STATE, and LOG. A custom sink without a driver, in
   * the component or any child, gets a recording one (read it with sinkValues / requests), and
   * a source without a driver a scriptable fake (answer with respond / fail).
   */
  drivers?: Record<string, any>;
  /**
   * Diagnostics mode while rendered. Default: 'collect' (error-severity messages still print),
   * or the current mode when diagnostics are already on. Restored when the last instance is
   * disposed. Dev checks require `import 'sygnal/diagnostics'` (the Vite plugin adds it under Vitest).
   */
  diagnostics?: DiagnosticsMode;
  /** Enable strict (canonical-form) runtime checks while rendered (requires 'sygnal/diagnostics') */
  strict?: boolean;
  /**
   * settle()'s quiet window in ms (default 20). A model `next('X', data, ms)` with a longer
   * delay fires after settle() resolved: raise this, or wait with `t.next(pred)`.
   */
  settleMs?: number;
  /** How long simulateEvent waits for a matching element / its listeners, in ms (default 300) */
  eventWaitMs?: number;
  /** Default timeout of next(), waitForState() and settle(), in ms (default 2000) */
  timeoutMs?: number;
  /**
   * 'mock' (default): the mock DOM. 'real': mount into a real container element (needs a DOM:
   * `// @vitest-environment jsdom`, or `environment: 'jsdom'` / 'happy-dom'), so `checked`,
   * `value`, `disabled`, focus, refs and Portals are real. simulateEvent then dispatches a real
   * event on the first element matching any CSS selector (a value/checked init is set on the
   * element first; 'click' runs the default action and skips disabled controls; 'focus'/'blur'
   * move focus). Read elements with `t.query(sel)` / `t.queryAll(sel)` / `t.container`.
   */
  dom?: 'mock' | 'real';
  /**
   * Fake socket connections open by themselves (default true; reconnects too; a t.push / t.drop
   * right after the declaration opens it first). false: they stay 'connecting' until t.open(),
   * for "Connecting…" assertions and failures to open (t.drop on a connecting one).
   */
  autoConnect?: boolean;
  /**
   * PLAN-3 G-160: the driverless sink that receives the components' `connections` static
   * (default 'WS'). It is created even when no model entry names it. Pass a driver for it in
   * `drivers` to use a real one.
   */
  socketSink?: string;
  /**
   * PLAN-3: the driverless sink that receives the components' `resources`
   * static (default 'HTTP'); each resource fetch is pending until t.respond / t.fail, and is
   * listed in t.requests as `{ url, ...request, resource: name }`.
   */
  resourceSink?: string;
  /**
   * PLAN-3 5-3: options for the HTTP fakes' makeFetchDriver (all but `fetch`), e.g.
   * `{ cache: queryCache() }`. Focus / reconnect refetches come only from t.focus() / t.online()
   */
  http?: FetchDriverOptions;
  /**
   * The app's router (the object `makeRouter()` returns). With no driver for `routerSink` in
   * `drivers`, renderComponent runs its real driver over an in-memory window (location, history,
   * popstate a task later, document listeners): read with `t.location`, drive with
   * `t.navigate` / `t.back` / `t.forward`; the commands the app sent are `t.sent('ROUTER')`.
   * Required when the component declares `route` (renderComponent throws naming it otherwise).
   * The real `window.location` is never changed.
   */
  router?: Router<any>;
  /** The router fake's start URL (default '/'), e.g. '/tasks/2?tab=notes' */
  url?: string;
  /** The sink the router fake serves (default 'ROUTER') */
  routerSink?: string;
  /** Run the router's scroll handling in the fake (default false; positions are kept in memory) */
  routerScroll?: boolean;
  /** Run the router's focus handling (default false; true: the router's own `focus` selectors; a string: these selectors). Needs `dom: 'real'` */
  routerFocus?: boolean | string;
  /** The sink the HEAD fake serves (default 'HEAD'); with no driver for it, `t.head()` reads what the components declared */
  headSink?: string;
  /** The HEAD fake's `titleTemplate` (`'%s · App'`), as passed to makeHeadDriver */
  titleTemplate?: string;
  /** PLAN-4 GS-7: the sink the timer fake serves (default 'TIMER'); with no driver for it, the real makeTimerDriver() runs on the test's timers and `t.timers()` lists them */
  timerSink?: string;
  /**
   * PLAN-4 GS-5: the fake storage behind the root's `persist()` ('local' and 'session' alike), as
   * key -> stored entry (`{ version, state }`, or a raw string). Used as is, not copied: writes
   * land in it, and renderComponent calls given the same object share one storage (`sync: true`
   * applies one's writes in the other). Default: a new empty object.
   */
  storage?: Record<string, PersistedEntry | string>;
}

/** PLAN-4 GS-5: a stored persist() entry (as `t.storage(key)` returns it) */
export interface PersistedEntry<STATE = any> {
  version: number
  state: Partial<STATE>
}

/** PLAN-4 GS-7: an active timer, as `t.timers()` lists it: the spec as declared plus these */
export type ActiveTimer = TimerSpec & {
  /** Its name in the `timers` static */
  name: string;
  /** The action it sends (a `frame` timer's is its `frame`) */
  action: string;
  /** The declaring component's name */
  component: string;
}

/**
 * What renderComponent() returns. STATE is the component's state type (calculated fields
 * included), inferred by renderComponent; name it for a handle declared before it is assigned:
 * `let t: RenderResult<State>`. Defaults to `any` (untyped tests compile as before).
 */
/** PLAN-4 GS-10: where an action in `t.actions` came from */
export type ActionCause = 'intent' | 'next' | 'reply' | 'built-in' | 'simulateAction' | 'behavior'

/**
 * PLAN-4 GS-10: one action in renderComponent's `t.actions`. `sinks` fills in as the action's
 * reducers run (STATE a microtask later), so an entry is live.
 */
export interface TestAction {
  /** The action name (a behavior's actions are namespaced: `pager.NEXT`) */
  type: string
  /** Its data (the DOM event for a DOM intent stream) */
  data: any
  /** The name of the component that ran it */
  component: string
  /** That component instance's id (stable for its life; inspect()'s component id) */
  instance: string
  /** The sinks that produced a value: not ABORT; STATE not the unchanged state; EFFECT when it ran */
  sinks: string[]
  /** 'intent' | 'next' (a reducer's or EFFECT's next()) | 'reply' (reply actions) | 'built-in' (INITIALIZE, BOOTSTRAP, DISPOSE, RESOURCE) | 'simulateAction' | 'behavior' */
  cause: ActionCause
  /** ms since renderComponent() was called (the fake clock under fake timers) */
  at: number
}

/** PLAN-4 GS-10: what `t.explain()` returns */
export interface ExplainedAction<STATE = any> extends TestAction {
  /** The root state the action produced (the first recorded after its STATE reducer ran) */
  state: STATE
  /** Its STATE reducer: the model's function and its source text (JS exposes no source location) */
  reducer?: { action: string; sink: string; fn: Function; source: string }
}

export interface RenderResult<STATE = any> {
  /** Stream of state values */
  state$: Stream<STATE>;
  /** Stream of rendered VNode trees */
  dom$: Stream<any>;
  /** Event bus source — call .select(type) to filter */
  events$: any;
  /** All sink streams by driver name */
  sinks: Record<string, any>;
  /** All source objects by driver name */
  sources: Record<string, any>;
  /** Push an action into the intent→model pipeline under its real name (all sinks of the entry run) */
  simulateAction: (actionName: string, data?: any) => void;
  /**
   * Dispatch a synthetic DOM event through the mock DOM source so the component's real intent
   * streams fire (DOM.click('.x'), DOM.select('.x').events('click'), .value(), .data()).
   * Targets the first rendered element matching `selector` and bubbles within its isolation scope.
   * Selectors match the rendered tree like the real DOM: tag, .class, #id, [attr], [attr="v"]
   * (^= $= *= ~=), :first-child, :last-child, :only-child, :nth-child(an+b|odd|even),
   * :nth-last-child(), :first/last/only/nth-of-type, :not(), descendant ' ' and child '>'
   * combinators, ',' lists. Other syntax (:has(), '+', '~', pseudo-elements...) throws.
   * If nothing matches yet, the event waits (up to 300ms, re-checked on every render) for a
   * matching element, then targets the first one. If none renders, the test fails with an
   * error naming the selector: it rejects the pending next()/waitForState()/settle(), or is
   * thrown by the next t.* call or dispose() (or by simulateEvent itself when nothing is
   * pending and the tree is quiet). Pass `{ allowMissing: true }` to drop the event with SYG103
   * instead. It is never sent to every listener with that selector string. It also waits until
   * the listeners it reaches are subscribed (a just-mounted child subscribes a few ms late).
   * `'document'` / `'body'` go to the DOM.select('document' | 'body') listeners.
   * simulateAction/simulateEvent calls are delivered in call order; a waiting event holds the
   * calls after it. Reports SYG104 (selector only matches inside a child component).
   */
  simulateEvent: (selector: string | AnyControl, eventType: string, eventInit?: SimulatedEventInit) => void;
  /**
   * Resolves once the component is subscribed (earlier simulate* calls are buffered and replayed).
   * Also a cursor: the first next() after `await t.ready()` also matches the states the replayed
   * calls produced, unless another t.* call came in between.
   */
  ready: () => Promise<void>;
  /**
   * Wait for a state that satisfies the predicate. Matches the recorded HISTORY too: a state
   * from before the call resolves it (e.g. `count === 0` right after a reset resolves at once
   * with the initial state). Resolves with the matching state once the whole tree (children
   * included) has rendered it. Use `next()` to wait for a new state.
   */
  waitForState: (predicate: (state: STATE) => boolean, timeoutMs?: number) => Promise<STATE>;
  /**
   * Wait for the next state emitted AFTER this call (right after `await t.ready()`: after the
   * component became ready) that satisfies the predicate (default: any state). Resolves with it
   * once the whole tree (children included) has rendered it; rejects after timeoutMs (default:
   * the timeoutMs option, 2000). The error names a model next() still scheduled, and a recorded
   * state that already matched. With `{ dom: 'real' }`, a next() right after another wait (no
   * input in between) starts after the state that wait resolved with, so
   * `await t.next(a); await t.next(b)` sees a `b` that arrived while the DOM showed `a`.
   */
  next: (predicate?: (state: STATE) => boolean, timeoutMs?: number) => Promise<STATE>;
  /**
   * Resolves once nothing is pending: the component is ready, no simulated input is waiting,
   * and nothing in the tree has rendered, reduced or changed state for settleMs (default 20,
   * longer than a model next()'s default delay). Rejects after timeoutMs if it never calms down.
   */
  settle: (timeoutMs?: number) => Promise<void>;
  /** Collected state values — grows as new states are emitted */
  states: STATE[];
  /**
   * PLAN-4 GS-10: every action the rendered tree ran (children and Collection items included),
   * in order, as `{ type, data, component, instance, sinks, cause, at }`. Live array.
   */
  actions: TestAction[];
  /**
   * PLAN-4 GS-10: the first action whose resulting root state matches the predicate, with that
   * state and its STATE reducer; undefined when none did.
   */
  explain: (predicate: (state: STATE) => boolean) => ExplainedAction<STATE> | undefined;
  /** The latest recorded state (`t.states.at(-1)`; undefined before the first one), calculated fields current. Read-only */
  readonly state: STATE;
  /** Live array of values emitted on a sink (EVENTS as {type, data}, PARENT unwrapped, custom sinks of any component in the tree) */
  sinkValues: (sinkName: string) => any[];
  /**
   * Live array of the requests a sink was sent, as objects: a string request is `{ url }`, a
   * resource fetch `{ url, ...request, resource: name }`. Never the `{ abort }` commands,
   * `{ resources }` declarations or `{ refresh }` commands (sinkValues has every value, as sent)
   */
  requests: (sinkName: string) => any[];
  /**
   * Answer a pending request on a driverless sink/source (e.g. `HTTP` with no
   * `drivers: { HTTP }`, which runs makeFetchDriver over an in-memory fetch) with a response whose
   * body is `value` (JSON; text for a string): a request with reply actions (`ok: 'LOADED'`) gets
   * the parsed body as its `LOADED` action, on exactly the component that sent it; a plain one gets
   * `{ category, value, status: 200, request }` on `HTTP.select(category)`.
   * Which request (the newest pending one that matches): `target` is an `ok`/`error` action
   * name, key, category, resource name or URL (`'LOADED'`); a partial request compared by value
   * with its t.requests form (`{ url: '/a' }`,
   * the constant the model returns); a predicate `(request) => boolean`; or FakeReplyOptions.
   * Nothing: the newest pending request. Requests answered, superseded by `latest: true`,
   * aborted, or whose component is gone aren't pending.
   * Throws at the call when nothing matching is pending, unless simulateEvent/simulateAction/
   * respond/fail calls are still queued before it or the component isn't ready yet: then it is
   * delivered after them, waiting up to 1s (half of timeoutMs if lower) for the request.
   * Resolves once the reply has been reduced and the tree rendered; rejects (and, if not
   * awaited, fails the next wait) when no request comes or nothing receives a plain reply.
   */
  respond: (sinkName: string, value: any, target?: string | FakeReplyOptions | Record<string, any> | ((request: any) => boolean)) => Promise<void>;
  /**
   * Fail a pending request (chosen as in respond): one with reply actions (`error: 'FAILED'`) gets
   * `{ error, request, status?, body? }` as its `FAILED` action, on its sender; a plain one
   * `{ error, category, request, status, body }` on `HTTP.errors(category)`. `error`: an HTTP
   * status (an error response: 404 → the driver's Error 'HTTP 404: url', status 404), or an
   * Error / message (a network failure: no status).
   */
  fail: (sinkName: string, error: any, target?: string | FakeReplyOptions | Record<string, any> | ((request: any) => boolean)) => Promise<void>;
  /**
   * A driverless sink that gets `{ connections }` / `{ to }` values (e.g. `WS` with no
   * `drivers: { WS }`) is a fake makeSocketDriver: diffed per component and connection name,
   * `open`/`message`/`close`/`error` as reply actions of the sender (no `close` for closes the
   * app makes), other events on `WS.select(name)`, shared by URL, reconnect per the spec on
   * the test's timers (fake timers included). The connections declared now, in order.
   * t.open / t.push / t.drop throw at the call when no connection matches (unless input is still
   * queued before them, as for respond) and resolve once the result has been reduced and rendered.
   */
  connections: (sinkName: string) => FakeConnection[];
  /** PLAN-3 5-3: the cache entries of an HTTP fake (`renderComponent(C, { http: { cache: queryCache() } })`) */
  cache: (sinkName: string) => FakeCacheEntry[];
  /** PLAN-3 5-3: the window regains focus (queued like simulate*): stale mounted resources refetch (cache on) */
  focus: () => void;
  /** PLAN-3 5-3: the browser comes back online (queued like simulate*): stale mounted resources refetch (cache on) */
  online: () => void;
  /** Complete the open of connecting connection(s) (`autoConnect: false`, or a pending retry): `open` fires with `{ reconnected }` */
  open: (sinkName: string, target?: FakeConnectionTarget) => Promise<void>;
  /**
   * The server sends `data` (objects as JSON text) on open connection(s): `message` fires with
   * the data, JSON-parsed when it parses. `{ event, connection? }` sends an SSE named event.
   */
  push: (sinkName: string, data: any, target?: FakeConnectionTarget | { event?: string; connection?: FakeConnectionTarget }) => Promise<void>;
  /**
   * Connection(s) close without the app closing them: `close` fires with `{ code, reason,
   * willReconnect }` (default `{ code: 1006, reason: '' }`; a connecting one fails to open: `error`
   * first), then the fake reconnects per the spec's `reconnect`.
   */
  drop: (sinkName: string, close?: { code?: number; reason?: string } | FakeConnectionTarget, target?: FakeConnectionTarget) => Promise<void>;
  /**
   * Live array of the `{ to, json | text | binary }` values sent (`to`: only those to that connection).
   * For the router fake's sink (`t.sent('ROUTER')`): the commands the components sent
   * (`{ to, params }`, `{ back: true }`, `{ block }`...), not the `route` declarations
   */
  sent: (sinkName: string, to?: string) => any[];
  /**
   * Router fake (`renderComponent(App, { router })`): navigate as a click on a link with this
   * href (`'/tasks/2'`), or as the command `{ to: 'task', params: { id: 2 }, query?, hash?,
   * replace? }`. Goes through `{ block }` like the real thing. Throws at the call for an unknown
   * route name, a missing param or another origin; resolves once the route has been reduced
   * and the tree rendered.
   */
  navigate: (target: string | { to: string; params?: Record<string, string | number>; query?: Record<string, any>; hash?: string; replace?: boolean }) => Promise<void>;
  /** Router fake: the browser's back button (popstate a task later; a block undoes it). Throws with no entry to go back to */
  back: () => Promise<void>;
  /** Router fake: the browser's forward button. Throws with no entry to go forward to */
  forward: () => Promise<void>;
  /** Router fake: the in-memory location: `path` (pathname), `search` ('?tab=x' or ''), `hash` ('#c' or ''), `href` */
  readonly location: { path: string; search: string; hash: string; href: string };
  /**
   * HEAD fake (no HEAD driver passed): the head the components declare now (`head` statics and
   * HEAD sink values), merged as makeHeadDriver merges them: `{ title, meta: { name: content },
   * link: [{ rel, href }] }`, `titleTemplate` applied
   */
  head: () => { title: string | undefined; meta: Record<string, string>; link: Array<Record<string, any>> };
  /**
   * PLAN-4 GS-7: the timer fake's active timers, in start order (`{ name, every | after | frame,
   * action, background?, component }`): a fired `after`, a stopped one or an invalid spec is not
   * listed. The fake is the real makeTimerDriver(), so fake timers drive it
   * (`vi.useFakeTimers()`, then `await vi.advanceTimersByTimeAsync(ms)`). Throws when a driver
   * was passed for the timer sink.
   */
  timers: () => ActiveTimer[];
  /**
   * PLAN-4 GS-5: the fake storage's entry for `key` (`{ version, state }`), undefined when none
   * (a raw string when what is stored isn't JSON). Pending persist() writes are flushed by t.settle()
   */
  storage: (key: string) => PersistedEntry<STATE> | undefined;
  /** Live array of EVENTS sink emissions ({type, data}) */
  emitted: Array<{ type: string; data: any }>;
  /** Live array of diagnostics reported while rendered */
  diagnostics: Diagnostic[];
  /**
   * PLAN-4 GS-2: the element commands the tree's instances sent on `ELEMENT`, one entry per command
   * (arrays flattened), as sent: `expect(t.commands('ELEMENT')).toEqual([{ focus: Email }])`. The
   * mock DOM records them (and reports SYG640/SYG641); `dom: 'real'` also runs them (jsdom gets
   * `<dialog>` show/showModal/close, the popover methods and a no-op scrollIntoView). Another sink
   * name gives its sinkValues.
   */
  commands: {
    (sinkName?: 'ELEMENT'): ElementCommand[];
    (sinkName: string): any[];
  };
  /** Throws (with the formatted texts) if any warn/error diagnostics were collected */
  expectNoDiagnostics: () => void;
  /**
   * Latest rendered VNode serialized to HTML like innerHTML (text escapes only & < >, so
   * `Couldn't`, not `&#39;`). Throws if called before the first render: wait
   * with `await t.ready()` (or `t.next(...)`) first. '' for a component that renders nothing.
   */
  html: () => string;
  /** Tear down the component, clean up listeners and restore the diagnostics mode */
  dispose: () => void;
  /**
   * The app graph of the rendered tree (components, actions, selectors with the mock DOM's
   * match / isolation results, EVENTS, diagnostics). Throws unless 'sygnal/diagnostics' is loaded.
   * `{ actions: true }` (or a number: the last n) adds `recentActions` (GS-10).
   */
  inspect: (options?: Pick<InspectOptions, 'actions'>) => InspectGraph;
  /** `{ dom: 'real' }`: the element the tree is mounted in (removed by dispose()); otherwise null */
  container: Element | null;
  /**
   * The first element matching a selector in the rendered tree (Portal content included), or
   * null: `expect(t.query('input[name="plan"]:checked').value).toBe('team')`. With `dom: 'real'`
   * a real element (any CSS selector); with the mock DOM a read-only snapshot of what the view
   * rendered (simulateEvent's selectors plus `:checked`/`:disabled`/`:enabled`; textContent,
   * value, checked, disabled, getAttribute, classList, dataset, querySelector, closest...; no
   * focus()). Throws before the first render (`await t.ready()` first). Right after
   * `await t.next(pred)` / `waitForState` / `settle()` / `ready()` it shows the state the wait resolved with.
   */
  query: {
    (selector: string): Element | null;
    /** A control's element (`t.query(Draft)` is an HTMLInputElement for an 'input' control), or null */
    <CONTROL extends AnyControl>(control: CONTROL): ControlElementOf<CONTROL> | null;
  };
  /** Every element matching a selector (or a control) in the rendered tree (Portals included), as query() */
  queryAll: {
    (selector: string): Element[];
    <CONTROL extends AnyControl>(control: CONTROL): Array<ControlElementOf<CONTROL>>;
  };
}

/**
 * A component renderComponent() accepts. STATE is inferred from its view's `state` (a
 * `Component<State, ...>` annotation, or a typed `({ state }: { state: State })` parameter;
 * calculated fields included), else from its `initialState` (INITIAL).
 */
export type RenderableComponent<STATE = any, INITIAL = STATE> =
  // a method signature: parameters are compared bivariantly, so views with their own required
  // props are accepted
  & { view(props: { state: STATE }, state: STATE, ...rest: any[]): any }['view']
  & { initialState?: INITIAL }

/**
 * STATE, or INITIAL when STATE is unknown (an untyped view with a typed `initialState`). `never`
 * (a generic call inlined as the argument, `renderComponent(component({...}))`) becomes `any`.
 */
type RenderedState<STATE, INITIAL> =
  [STATE] extends [never] ? any
  : 0 extends (1 & STATE) ? AnyIfNever<INITIAL>
  : STATE

/**
 * Render a component in tests (mock DOM, fake drivers). The handle's state is typed from the
 * component, so `await t.next(s => s.count > 0)` needs no annotation. Pass the state type
 * explicitly for an untyped component: `renderComponent<State>(Counter)`.
 */
export function renderComponent<STATE = any, INITIAL = STATE>(
  componentDef: RenderableComponent<STATE, INITIAL>,
  options?: RenderOptions
): RenderResult<RenderedState<STATE, INITIAL>>

export interface RenderToStringOptions {
  /** Initial state for the root component */
  state?: any
  /** Props to pass to the root component */
  props?: Record<string, any>
  /** Context from a parent (for nested rendering) */
  context?: Record<string, any>
  /**
   * Embed serialized state in a <script> tag for client hydration.
   * When true, appends `<script>window.__SYGNAL_STATE__=...</script>`.
   * When a string, uses that as the variable name.
   */
  hydrateState?: boolean | string
  /** An array that receives each rendered component's `head` static value; pass it to `renderHead()` */
  head?: any[]
  /**
   * PLAN-3 5-5 (H-7): a seeded `queryCache()` the components' `resources` render from: a cached
   * entry as `{ status: 'success', data }`, any other request as `{ status: 'loading' }` (nothing
   * is fetched during SSR)
   */
  cache?: QueryCache
  /** The app-level error hook, as run()'s `onError`: phase 'view' only (PLAN-4 GS-11) */
  onError?: AppErrorHook
  /** The root of the `uid()` strings (default 'u'), as run()'s `uid`: the same value on both sides */
  uid?: string
}

/**
 * Render a Sygnal component to an HTML string on the server.
 *
 * ```ts
 * renderToString(App, { state: { count: 0 } })
 * // → '<div data-sygnal-ssr=""><h1>Count: 0</h1></div>'
 * ```
 *
 * The root element carries an empty `data-sygnal-ssr` attribute, which marks the markup as
 * Sygnal's server HTML (persist() under plain run() then restores after the first render); the
 * first client render removes it.
 */
export function renderToString(componentDef: any, options?: RenderToStringOptions): string

export const xs: typeof xsDefault

export { default as debounce } from 'xstream/extra/debounce.js'
export { default as throttle } from 'xstream/extra/throttle.js'
export { default as delay } from 'xstream/extra/delay.js'
export { default as dropRepeats } from 'xstream/extra/dropRepeats.js'
export { default as sampleCombine } from 'xstream/extra/sampleCombine.js'
export { default as flattenConcurrently } from 'xstream/extra/flattenConcurrently.js'
export { default as flattenSequentially } from 'xstream/extra/flattenSequentially.js'
export { default as concat } from 'xstream/extra/concat.js'

export * from './cycle/dom/index'
export type { MemoryStream, Stream }

/**
 * JSX Types
 *
 * Focus management props (available on all HTML elements):
 * - `autoFocus={true}` — Focus the element when it enters the DOM
 * - `autoSelect={true}` — Select the element's text after focusing (input/textarea)
 */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
      collection: CollectionProps<any>;
      switchable: SwitchableProps<any>;
      slot: SlotProps;
    }

    interface Element {
      children?: JSX.Element;
    }

    interface ElementChildrenAttribute {
      children: {};
    }

    /**
     * A component's view receives `state: STATE` and `context`, but in JSX the parent passes
     * an optional `state` slice name or lens (`<Editor state="editor" />`, `<Panel />`).
     */
    type LibraryManagedAttributes<C, P> = ElementProps<P>
  }
}
