import type { MainDOMSource } from './cycle/dom/MainDOMSource'
import type { EnrichedEventStream } from './cycle/dom/enrichEventStream'
import type { StateSource } from './cycle/state/index'
import xsDefault from 'xstream'
import type { InspectGraph } from './extra/diagnostics/checks/public'
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

/** The first argument of a component's view: its props plus `state`, `context`, `children` and `slots`. */
export type ViewProps<STATE = any, PROPS = {}, CONTEXT = {}> =
  PROPS & { state: STATE; context: CONTEXT; children?: JSX.Element | JSX.Element[]; slots?: Record<string, JSX.Element[]> }

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

/** PROPS without `state`, `context` and `slots` (keeps optionality and index signatures, unlike Omit). */
type WithoutViewOnlyProps<PROPS> = {
  [KEY in keyof PROPS as KEY extends 'state' | 'context' | 'slots' ? never : KEY]: PROPS[KEY]
}

type NextFunction<ACTIONS = any> = ACTIONS extends object
  ? <ACTION_KEY extends keyof ACTIONS>(
      action: ACTION_KEY,
      data?: ACTIONS[ACTION_KEY],
      delay?: number
    ) => void
  : (action: string, data?: any, delay?: number) => void

type ReducerExtras<PROPS, CONTEXT> = PROPS & { context: CONTEXT; children?: JSX.Element | JSX.Element[]; slots?: Record<string, JSX.Element[]> }

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
  [EVENT in Exclude<keyof HTMLElementEventMap, keyof MainDOMSource>]: (selector: string) => EnrichedEventStream<HTMLElementEventMap[EVENT]>
}

export type SygnalDOMSource = MainDOMSource & DOMEventShorthands & {
  /** Any other event name (custom events): `DOM['my-event']('.x')` */
  [eventName: string]: (selector: string) => EnrichedEventStream<globalThis.Event>
}

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
   * PLAN-3 3-A (experimental): declarative reads (`makeFetchDriver()`). Each entry derives a
   * request from state; falsy means idle:
   * `Quote.resources = { quote: (state) => state.id && '/api/quotes/' + state.id }`.
   * `state.quote` is a `Resource`: `{ status: 'idle' | 'loading' | 'success' | 'error', data,
   * error }`, written by the built-in RESOURCE action (idle until the first request). A changed
   * request is fetched with latest semantics (the stale one aborted, its reply never shown);
   * `data` is set only while 'success'. Refetch with `{ refresh: 'quote' }` on the HTTP sink.
   * `ok` / `error` on the request also dispatch those actions after the write.
   */
  resources?: { [name: string]: (state: STATE & CALCULATED) => ResourceRequest | false | null | undefined | '' | 0 };
  /**
   * The router's reply action (`makeRouter()`): `App.route = 'ROUTE'`. The driver sends this
   * instance ROUTE with the `Route` (`{ name, params, query, hash, path }`) once declared and on
   * every change; the reducer stores it (`ROUTE: (state, route) => ({ ...state, route })`).
   * The first (outermost) declarer gets each route first and may redirect from that entry
   * (`ROUTER: { to: 'login', replace: true }`); the others get it a task later, only if no
   * redirect happened. A function of state may return a falsy value to stop listening. Needs a
   * model and state (SYG132); seed `initialState.route` with `router.current()`.
   */
  route?: string | ((state: STATE & CALCULATED) => string | false | null | undefined);
  /**
   * Document head values for `makeHeadDriver()`, derived from state: `App.head = (state) =>
   * ({ title: state.task?.title })`. Recomputed when the result changes; removed on dispose.
   * A later-mounted component's `title` wins; `meta` keys and `link`s merge. Also collected by
   * `renderToString(App, { head: list })` for SSR (`renderHead(list)`). Like every declaration
   * static, it is only sent by a component with a model (`{}` is enough) and state (SYG132).
   */
  head?: (state: STATE & CALCULATED) => HeadValue | false | null | undefined;
}

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
  state?: string | Lense;
} & Omit<PROPS, 'of' | 'state' | 'current'>

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

export type RunOptions = {
  mountPoint?: string;
  fragments?: boolean;
  useDefaultDrivers?: boolean;
  /**
   * Runtime diagnostics. Takes precedence over `globalThis.__SYGNAL_DEV__`
   * (set by the Sygnal Vite plugin in dev), which enables 'warn'. Default: 'off'.
   */
  diagnostics?: DiagnosticsMode | DiagnosticsOptions;
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
  /** PLAN-3 3-A (experimental): refetch this instance's resource(s) by name (nothing while idle) */
  refresh: string | string[];
}

/** PLAN-3 3-A (experimental): a request a `resources` entry derives (a URL, or a request without `abort`) */
export type ResourceRequest = Exclude<FetchRequest, { abort: true | string } | { refresh: string | string[] }>

/**
 * PLAN-3 3-A (experimental): the state slot of a resource (`state.quote`), written by the
 * built-in RESOURCE action. `data` is the parsed body, set only while 'success'; `error` (set
 * only while 'error') is the Error: `error.status` / `error.body` for a non-2xx response.
 */
export type Resource<DATA = any, ERROR = any> =
  | { status: 'idle' | 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: DATA; error?: undefined }
  | { status: 'error'; data?: undefined; error: ERROR }

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
export function makeFetchDriver(options?: FetchDriverOptions): (request$: Stream<any>) => FetchSource

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
  | { to: RouteName<R>; params?: Record<string, string | number>; query?: RouteQuery; hash?: string; replace?: boolean; scroll?: boolean; force?: boolean }
  | { url: string; replace?: boolean; scroll?: boolean; force?: boolean }
  | { back: true; force?: boolean } | { forward: true; force?: boolean } | { go: number; force?: boolean }
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
  /** called for `{ prefetch }` commands (until the fetch cache wires it) */
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
export function makeHeadDriver(options?: { titleTemplate?: string; document?: any }): (sink$: Stream<any>) => { dispose(): void }

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
  /** respond(): the status (default 200). fail(): the status (default error.status) */
  status?: number;
  /** fail(): the parsed error body */
  body?: any;
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

export interface RenderOptions {
  /** Override initial state (defaults to component's .initialState) */
  initialState?: any;
  /** Mock DOM configuration — maps selectors to event streams */
  mockConfig?: Record<string, any>;
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
   * PLAN-3 3-A (experimental): the driverless sink that receives the components' `resources`
   * static (default 'HTTP'); each resource request is pending until t.respond / t.fail.
   */
  resourceSink?: string;
}

/**
 * What renderComponent() returns. STATE is the component's state type (calculated fields
 * included), inferred by renderComponent; name it for a handle declared before it is assigned:
 * `let t: RenderResult<State>`. Defaults to `any` (untyped tests compile as before).
 */
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
  simulateEvent: (selector: string, eventType: string, eventInit?: SimulatedEventInit) => void;
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
  /** The latest recorded state (`t.states.at(-1)`; undefined before the first one), calculated fields current. Read-only */
  readonly state: STATE;
  /** Live array of values emitted on a sink (EVENTS as {type, data}, PARENT unwrapped, custom sinks of any component in the tree) */
  sinkValues: (sinkName: string) => any[];
  /**
   * Live array of the requests a sink was sent: `sinkValues(name)` without the `{ abort }`
   * commands (those stay in sinkValues)
   */
  requests: (sinkName: string) => any[];
  /**
   * Answer a pending request on a driverless sink/source (e.g. `HTTP` with no
   * `drivers: { HTTP }`), like makeFetchDriver: a request with reply actions (`ok: 'LOADED'`) gets `value`
   * as its `LOADED` action, on exactly the component that sent it; a plain one gets
   * `{ category, value, status: 200, request }` on `HTTP.select(category)`.
   * Which request (the newest pending one that matches): `target` is an `ok`/`error` action
   * name, key or category (`'LOADED'`); a partial request compared by value (`{ url: '/a' }`,
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
   * `{ error, category, request, status, body }` on `HTTP.errors(category)`. `error`: an
   * Error, a message, or an HTTP status (404 → 'HTTP 404', status 404).
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
  /** Live array of the `{ to, json | text | binary }` values sent (`to`: only those to that connection) */
  sent: (sinkName: string, to?: string) => any[];
  /** Live array of EVENTS sink emissions ({type, data}) */
  emitted: Array<{ type: string; data: any }>;
  /** Live array of diagnostics reported while rendered */
  diagnostics: Diagnostic[];
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
   */
  inspect: () => InspectGraph;
  /** `{ dom: 'real' }`: the element the tree is mounted in (removed by dispose()); otherwise null */
  container: Element | null;
  /**
   * `{ dom: 'real' }`: the first element matching a CSS selector in the rendered tree (Portal
   * content included), or null: `expect(t.query('input[name="plan"][value="team"]').checked).toBe(true)`.
   * Throws in the mock DOM, and before the first render is in the DOM (`await t.ready()` first).
   * Right after `await t.next(pred)` / `waitForState` / `settle()` / `ready()` the DOM shows
   * the state the wait resolved with.
   */
  query: (selector: string) => Element | null;
  /** `{ dom: 'real' }`: every element matching a CSS selector in the rendered tree (Portals included) */
  queryAll: (selector: string) => Element[];
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
}

/**
 * Render a Sygnal component to an HTML string on the server.
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
