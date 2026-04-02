import type { MainDOMSource } from './cycle/dom/MainDOMSource'
import type { EnrichedEventStream } from './cycle/dom/enrichEventStream'
import type { StateSource } from './cycle/state/index'
import xsDefault from 'xstream'
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

export type NonStateSinkReturns = {
  EVENTS?: unknown;
  LOG?: unknown;
  PARENT?: unknown;
}

type ResolvedNonStateSinkReturns<SINK_RETURNS extends NonStateSinkReturns = {}> = {
  EVENTS: SINK_RETURNS extends { EVENTS: infer EVENTS_RETURN } ? EVENTS_RETURN : Event<any>;
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

type ChildSource = {
  select<T = any>(component: (...args: any[]) => any): Stream<T>;
  select<T = any>(name: string): Stream<T>;
}

export type SygnalDOMSource = MainDOMSource & {
  [eventName: string]: (selector: string) => EnrichedEventStream<globalThis.Event>
}

export type EventsSource<EVENTS = any> = Stream<Event<EVENTS>> & {
  select<T = any>(type: string): Stream<T>;
}

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

export type CollectionProps<PROPS = any> = {
  of: AnyComponent;
  from: string | Lense;
  filter?: Filter;
  sort?: string | SortFunction | SortObject;
} & Omit<PROPS, 'of' | 'from' | 'filter' | 'sort'>

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

export type SlotProps = {
  name?: string;
  children?: any;
}

export type ClassesType = (string | string[] | { [className: string]: boolean | undefined })[]

export type RunOptions = {
  mountPoint?: string;
  fragments?: boolean;
  useDefaultDrivers?: boolean;
}

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

/**
 * Create a model entry that emits an EVENTS bus event.
 *
 *   `emit('DELETE_LANE', (state) => ({ laneId: state.id }))`
 *   `emit('REFRESH')`
 */
export function emit(
  type: string,
  data?: any | ((state: any, actionData: any, next: Function, props: any) => any)
): { EVENTS: (state: any, actionData: any, next: Function, props: any) => { type: string; data: any } }

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

export function Collection<PROPS extends { [prop: string]: any }>(props: CollectionProps<PROPS>): JSX.Element
export function Switchable<PROPS extends { [prop: string]: any }>(props: SwitchableProps<PROPS>): JSX.Element
export function Portal(props: PortalProps): JSX.Element
export function Transition(props: TransitionProps): JSX.Element
export function Slot(props: SlotProps): JSX.Element

export function lazy<PROPS = any>(
  loadFn: () => Promise<{ default: Component<any, PROPS> } | Component<any, PROPS>>
): Component<any, PROPS>

export type AsyncDriverFromFunction<INCOMING = any, OUTGOING = any> = {
  select: (selector?: string | ((value: OUTGOING) => boolean)) => Stream<OUTGOING>
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

export interface RenderOptions {
  /** Override initial state (defaults to component's .initialState) */
  initialState?: any;
  /** Mock DOM configuration — maps selectors to event streams */
  mockConfig?: Record<string, any>;
  /** Additional drivers beyond DOM, EVENTS, STATE, and LOG */
  drivers?: Record<string, any>;
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
  /** Push an action directly into the intent→model pipeline */
  simulateAction: (actionName: string, data?: any) => void;
  /** Wait for state to satisfy a predicate (resolves with the matching state) */
  waitForState: (predicate: (state: any) => boolean, timeoutMs?: number) => Promise<any>;
  /** Collected state values — grows as new states are emitted */
  states: any[];
  /** Tear down the component and clean up all listeners */
  dispose: () => void;
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
