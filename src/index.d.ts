import type { MainDOMSource } from './cycle/dom/MainDOMSource'
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
 */
type ComponentProps<STATE, PROPS, CONTEXT> = (
  props: PROPS & { state?: STATE; children?: JSX.Element | JSX.Element[]; context?: CONTEXT },
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

type Reducer<STATE, PROPS, ACTIONS = any, DATA = any, RETURN = any> = (
  state: STATE,
  args: DATA,
  next: NextFunction<ACTIONS>,
  props: PROPS
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
type SinkValue<STATE, PROPS, ACTIONS, DATA, RETURN, CALCULATED> =
  | true
  | Reducer<STATE & CALCULATED, PROPS, ACTIONS, DATA, RETURN>

type DefaultSinks<STATE, PROPS, ACTIONS, DATA, CALCULATED, SINK_RETURNS extends NonStateSinkReturns = {}> = {
  STATE?: SinkValue<STATE, PROPS, ACTIONS, DATA, STATE, CALCULATED>;
  EVENTS?: SinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['EVENTS'], CALCULATED>;
  LOG?: SinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['LOG'], CALCULATED>;
  PARENT?: SinkValue<STATE, PROPS, ACTIONS, DATA, ResolvedNonStateSinkReturns<SINK_RETURNS>['PARENT'], CALCULATED>;
}

type CustomDriverSinks<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY, CALCULATED> = keyof DRIVERS extends never
  ? {
      [driver: string]: SinkValue<STATE, PROPS, ACTIONS, any, any, CALCULATED>
    }
  : {
      [DRIVER_KEY in keyof DRIVERS]: SinkValue<
        STATE,
        PROPS,
        ACTIONS,
        ACTION_ENTRY,
        DRIVERS[DRIVER_KEY] extends { source: any; sink: any } ? DRIVERS[DRIVER_KEY]['sink'] : any,
        CALCULATED
      >
    }

type ModelEntry<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY, CALCULATED, SINK_RETURNS extends NonStateSinkReturns = {}> =
  | SinkValue<STATE, PROPS, ACTIONS, ACTION_ENTRY, STATE, CALCULATED>
  | Partial<
      DefaultSinks<STATE, PROPS, ACTIONS, ACTION_ENTRY, CALCULATED, SINK_RETURNS> &
      CustomDriverSinks<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY, CALCULATED>
    >

type WithDefaultActions<STATE, ACTIONS> = ACTIONS & {
  BOOTSTRAP?: never;
  INITIALIZE?: STATE;
  HYDRATE?: any;
}

type ComponentModel<STATE, PROPS, DRIVERS, ACTIONS, CALCULATED, SINK_RETURNS extends NonStateSinkReturns = {}> = keyof ACTIONS extends never
  ? {
      [action: string]: ModelEntry<
        STATE,
        PROPS,
        DRIVERS,
        WithDefaultActions<STATE, { [action: string]: any }>,
        any,
        CALCULATED,
        SINK_RETURNS
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
        SINK_RETURNS
      >
    }

type ChildSource = {
  select<T = any>(component: (...args: any[]) => any): Stream<T>;
  select<T = any>(name: string): Stream<T>;
}

export type SygnalDOMSource = MainDOMSource & {
  [eventName: string]: (selector: string) => Stream<Event>
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

type Actions<ACTIONS> = keyof ACTIONS extends never
  ? { [action: string]: Stream<any> }
  : { [ACTION_KEY in keyof ACTIONS]: Stream<ACTIONS[ACTION_KEY]> }

export type FixDrivers<DRIVERS> =
  0 extends (1 & DRIVERS)
    ? {}
    : DRIVERS extends DriverSpecs
      ? DRIVERS
      : {}

type CombinedSources<STATE, DRIVERS> = Sources<DefaultDrivers<STATE> & DRIVERS>

interface ComponentIntent<STATE, DRIVERS, ACTIONS> {
  (args: CombinedSources<STATE, DRIVERS>): Partial<Actions<ACTIONS>>
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
  [field: string]: 'asc' | 'dec' | SortFunction<ITEM>
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
  model?: ComponentModel<STATE, PROPS, FixDrivers<DRIVERS>, ACTIONS, CALCULATED, SINK_RETURNS>;
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

export type CollectionProps<PROPS = any> = {
  of: Component<any, PROPS, any, any, any, any> | ((props: PROPS) => JSX.Element);
  from: string | Lense;
  filter?: Filter;
  sort?: string | SortFunction | SortObject;
} & Omit<PROPS, 'of' | 'from' | 'filter' | 'sort'>

export type SwitchableProps<PROPS = any> = {
  of: Record<string, Component<any, PROPS, any, any, any, any> | ((props: PROPS) => JSX.Element)>;
  current: string;
  state?: string | Lense;
} & Omit<PROPS, 'of' | 'state' | 'current'>

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

export type FormSource = {
  events: (eventName: string) => Stream<Event>
}

export function processForm<FIELDS extends { [field: string]: any }>(
  target: FormSource,
  options?: { events?: string | string[]; preventDefault?: boolean }
): Stream<FIELDS & { event: Event; eventType: string }>

export type DragSource = {
  events: (eventName: string) => Stream<Event>
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

export function Collection<PROPS extends { [prop: string]: any }>(props: CollectionProps<PROPS>): JSX.Element
export function Switchable<PROPS extends { [prop: string]: any }>(props: SwitchableProps<PROPS>): JSX.Element

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

export const xs: typeof xsDefault

export { default as debounce } from 'xstream/extra/debounce'
export { default as throttle } from 'xstream/extra/throttle'
export { default as delay } from 'xstream/extra/delay'
export { default as dropRepeats } from 'xstream/extra/dropRepeats'
export { default as sampleCombine } from 'xstream/extra/sampleCombine'

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
    }

    interface Element {
      children?: JSX.Element;
    }

    interface ElementChildrenAttribute {
      children: {};
    }
  }
}
