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
 * State is always provided by the framework at runtime.
 */
type ComponentProps<STATE, PROPS, CONTEXT> = (
  props: PROPS & { state: STATE; children?: JSX.Element | JSX.Element[]; slots?: Record<string, JSX.Element[]>; context?: CONTEXT },
  state: STATE,
  context: CONTEXT,
  peers: { [peer: string]: JSX.Element | JSX.Element[] }
) => JSX.Element

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
  PARENT: SINK_RETURNS extends { PARENT: infer PARENT_RETURN } ? PARENT_RETURN : any;
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

type EffectReducer<STATE, PROPS, ACTIONS, DATA, CALCULATED, CONTEXT = {}> =
  | ((state: STATE & CALCULATED, args: DATA, next: NextFunction<ACTIONS>, props: ReducerExtras<PROPS, CONTEXT>) => void)

type DefaultSinks<STATE, PROPS, ACTIONS, DATA, CALCULATED, SINK_RETURNS extends NonStateSinkReturns = {}, CONTEXT = {}> = {
  STATE?: SinkValue<STATE, PROPS, ACTIONS, DATA, STATE, CALCULATED, CONTEXT>;
  EVENTS?: SinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['EVENTS'], CALCULATED, CONTEXT>;
  LOG?: SinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['LOG'], CALCULATED, CONTEXT>;
  PARENT?: SinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['PARENT'], CALCULATED, CONTEXT>;
  EFFECT?: EffectReducer<STATE, PROPS, ACTIONS, DATA, CALCULATED, CONTEXT>;
}

type CustomDriverSinks<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY, CALCULATED, CONTEXT = {}> = keyof DRIVERS extends never
  ? {
      [driver: string]: SinkValue<STATE, PROPS, ACTIONS, any, any, CALCULATED, CONTEXT>
    }
  : {
      [DRIVER_KEY in keyof DRIVERS]: SinkValue<
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
  HYDRATE?: any;
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
  VALUE extends (...args: any[]) => infer RETURN ? Exclude<RETURN, ABORT | undefined | void> : never

type ParentPayloadFromEntry<ENTRY> =
  ENTRY extends (...args: any[]) => any ? never
  : ENTRY extends object
    ? 'PARENT' extends keyof ENTRY ? ParentSinkValueReturn<NonNullable<ENTRY['PARENT']>> : never
    : never

type ParentPayloadsOfModel<MODEL> = {
  [ACTION_KEY in keyof MODEL]-?: ACTION_KEY extends `${string}|${infer SINK}`
    ? TrimSpaces<SINK> extends 'PARENT' ? ParentSinkValueReturn<NonNullable<MODEL[ACTION_KEY]>> : never
    : ParentPayloadFromEntry<NonNullable<MODEL[ACTION_KEY]>>
}[keyof MODEL]

type AnyIfNever<T> = [T] extends [never] ? any : T

/**
 * The value type a component sends to its parent through the `PARENT` sink, inferred from the
 * component's `model` (object-form `{ PARENT: fn }` entries and `'ACTION | PARENT'` shorthand).
 * Falls back to `any` when it can't be inferred (no model, a `Component<...>` annotation without
 * a `PARENT` entry in its `SINK_RETURNS`, or `PARENT: true` pass-through entries only).
 */
export type ParentPayloadOf<COMPONENT> =
  COMPONENT extends { model?: infer MODEL }
    ? 0 extends (1 & MODEL) ? any : AnyIfNever<ParentPayloadsOfModel<NonNullable<MODEL>>>
    : any

type ChildSource = {
  /** Typed: the stream type is inferred from the child's PARENT sink (falls back to `any`). */
  select<COMPONENT extends (...args: any[]) => any>(component: COMPONENT): Stream<ParentPayloadOf<COMPONENT>>;
  select<T = any>(component: (...args: any[]) => any): Stream<T>;
  select<T = any>(name: string): Stream<T>;
}

export type SygnalDOMSource = MainDOMSource & {
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
 * INITIALIZE, HYDRATE and DISPOSE stay allowed). Actions reached only through `next()` are
 * added explicitly:
 *
 *   type Actions = ActionsOf<typeof intent> & { SAVED: { id: string } }
 */
export type ActionsOf<INTENT> = INTENT extends (...args: any[]) => infer RETURN
  ? IntentReturnToActions<RETURN>
  : IntentReturnToActions<INTENT>

interface ComponentIntent<STATE, DRIVERS, ACTIONS> {
  (args: CombinedSources<STATE, DRIVERS>): Partial<IntentActions<ACTIONS>>
}

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

export type SortObject<ITEM = any> = {
  [field: string]: 'asc' | 'desc' | SortFunction<ITEM>
}

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
  SINK_RETURNS extends NonStateSinkReturns = {}
> = ComponentProps<STATE & CALCULATED, PROPS, CONTEXT> & {
  label?: string;
  DOMSourceName?: string;
  stateSourceName?: string;
  requestSourceName?: string;
  model?: ComponentModel<STATE, PROPS, FixDrivers<DRIVERS>, ACTIONS, CALCULATED, SINK_RETURNS, CONTEXT>;
  intent?: ComponentIntent<STATE & CALCULATED, FixDrivers<DRIVERS>, ACTIONS>;
  initialState?: STATE;
  /**
   * Give a sub-component its own state instead of the slice its parent passes in.
   * Required to use `initialState` on a sub-component (otherwise SYG405). Without a
   * `state` prop the state is local to the instance and never written to the parent.
   */
  isolatedState?: boolean;
  calculated?: Calculated<STATE, CALCULATED>;
  storeCalculatedInState?: boolean;
  context?: Context<STATE & CALCULATED, CONTEXT>;
  peers?: { [name: string]: Component };
  components?: { [name: string]: Component };
  onError?: (error: Error, info: { componentName: string }) => any;
  debug?: boolean;
}

/**
 * Sygnal Root Component
 */
export type RootComponent<
  STATE = any,
  DRIVERS = {},
  ACTIONS = {},
  CALCULATED = {},
  CONTEXT = {},
  SINK_RETURNS extends NonStateSinkReturns = {}
> = Component<STATE, any, DRIVERS, ACTIONS, CALCULATED, CONTEXT, SINK_RETURNS>

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
  sort?: string | SortFunction | SortObject;
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
 * The Sygnal DevTools bridge (also `window.__SYGNAL_DEVTOOLS__` once run() has
 * initialized it in a browser). Only the stable, documented members are typed.
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

/** The DevTools bridge singleton. */
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
 */
export function set<S = any>(
  partial: Partial<S> | ((state: S, data: any, next: Function, props: any) => Partial<S>)
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
  payload: EventPayloadFunction<TYPE, STATE, DATA>
): EventSink<TYPE, STATE, DATA>
export function event<TYPE extends EventName>(
  type: TYPE,
  ...payload: StaticEventArgs<TYPE>
): EventSink<TYPE>

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
  requestSourceName?: string;
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

/** Payload on `errors()` of a driverFromAsync source when a request fails */
export type AsyncDriverError<INCOMING = any> = {
  /** The rejection reason (or what `post` threw) */
  error: any;
  /** The request that failed */
  request: INCOMING;
  /** The request's selector property (default 'category') is copied here */
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

export interface RenderOptions {
  /** Override initial state (defaults to component's .initialState) */
  initialState?: any;
  /** Mock DOM configuration — maps selectors to event streams */
  mockConfig?: Record<string, any>;
  /** Additional drivers beyond DOM, EVENTS, STATE, and LOG (model sinks without a driver get a no-op one) */
  drivers?: Record<string, any>;
  /**
   * Diagnostics mode while rendered. Default: 'collect' (error-severity messages still print),
   * or the current mode when diagnostics are already on. Restored when the last instance is
   * disposed. Dev checks require `import 'sygnal/diagnostics'` (the Vite plugin adds it under Vitest).
   */
  diagnostics?: DiagnosticsMode;
  /** Enable strict (canonical-form) runtime checks while rendered (requires 'sygnal/diagnostics') */
  strict?: boolean;
}

export interface RenderResult {
  /** Stream of state values */
  state$: Stream<any>;
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
  /** Resolves once the component is subscribed (earlier simulate* calls are buffered and replayed) */
  ready: () => Promise<void>;
  /**
   * Wait for a state that satisfies the predicate. Matches the recorded HISTORY too: a state
   * from before the call resolves it (e.g. `count === 0` right after a reset resolves at once
   * with the initial state). Resolves with the matching state once the whole tree (children
   * included) has rendered it. Use `next()` to wait for a new state.
   */
  waitForState: (predicate: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
  /**
   * Wait for the next state emitted AFTER this call that satisfies the predicate (default: any
   * state). Resolves with it once the whole tree (children included) has rendered it; rejects
   * after timeoutMs (default 2000).
   */
  next: (predicate?: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
  /**
   * Resolves once nothing is pending: the component is ready, no simulated input is waiting,
   * and nothing in the tree has rendered, reduced or changed state for 20ms (longer than
   * next()'s default delay). Rejects after timeoutMs (default 2000) if it never calms down.
   */
  settle: (timeoutMs?: number) => Promise<void>;
  /** Collected state values — grows as new states are emitted */
  states: any[];
  /** Live array of values emitted on a sink (EVENTS as {type, data}, PARENT unwrapped, custom drivers) */
  sinkValues: (sinkName: string) => any[];
  /** Live array of EVENTS sink emissions ({type, data}) */
  emitted: Array<{ type: string; data: any }>;
  /** Live array of diagnostics reported while rendered */
  diagnostics: Diagnostic[];
  /** Throws (with the formatted texts) if any warn/error diagnostics were collected */
  expectNoDiagnostics: () => void;
  /** Latest rendered VNode serialized to HTML ('' before the first render) */
  html: () => string;
  /** Tear down the component, clean up listeners and restore the diagnostics mode */
  dispose: () => void;
  /**
   * The app graph of the rendered tree (components, actions, selectors with the mock DOM's
   * match / isolation results, EVENTS, diagnostics). Throws unless 'sygnal/diagnostics' is loaded.
   */
  inspect: () => InspectGraph;
}

export function renderComponent(componentDef: any, options?: RenderOptions): RenderResult

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
  }
}
