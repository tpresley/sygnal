/// <reference path="./sygnal.d.ts" />

import { Stream } from 'xstream'
import { MainDOMSource } from '@cycle/dom'
import { StateSource } from '@cycle/state'

type ABORT = '~#~#~ABORT~#~#~'

/**
 * A function that takes component properties and returns a JSX element.
 *
 * @template STATE - State type
 * @template PROPS - Props type
 * @template CONTEXT - Context type
 *
 * @param { PROPS & { state?: STATE, children?: JSX.Element | JSX.Element[], context?: CONTEXT } } props - Component props augmented with the current state, children, context, and any peers
 * @returns { JSX.Element } The JSX element rendered by the component.
 */
type ComponentProps<STATE, PROPS, CONTEXT> = (
  props: PROPS & { state?: STATE, children?: JSX.Element | JSX.Element[], context?: CONTEXT },
  state: STATE,
  context: CONTEXT,
  peers: { [peer: string]: JSX.Element | JSX.Element[] }
) => JSX.Element;


type NextFunction<ACTIONS=any> = ACTIONS extends object
  ? <ACTION_KEY extends keyof ACTIONS>(
      action: ACTION_KEY,
      data?: ACTIONS[ACTION_KEY],
      delay?: number
    ) => void
  : (action: string, data?: any, delay?: number) => void;

type Reducer<STATE, PROPS, ACTIONS = any, DATA = any, RETURN = any> = (
  state: STATE,
  args: DATA,
  next: NextFunction<ACTIONS>,
  props: PROPS
) => RETURN | ABORT | undefined;

type StateOnlyReducer<STATE, RETURN = any> = (
  state: STATE
) => RETURN | ABORT;

export type Event<DATA=any> = { type: string, data: DATA }

/**
 * Valid values for a sink
 * 
 * - true: Whatever value is received from the intent for this action is passed on as-is.
 * - Function: A reducer
 */
type SinkValue<STATE, PROPS, ACTIONS, DATA, RETURN> = true | Reducer<STATE, PROPS, ACTIONS, DATA, RETURN> 

type DefaultSinks<STATE, PROPS, ACTIONS, DATA> = {
  STATE?: SinkValue<STATE, PROPS, ACTIONS, DATA, STATE>;
  EVENTS?: SinkValue<STATE, PROPS, ACTIONS, DATA, Event>;
  LOG?: SinkValue<STATE, PROPS, ACTIONS, DATA, any>;
  PARENT?: SinkValue<STATE, PROPS, ACTIONS, DATA, any>;
};

type CustomDriverSinks<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY> = keyof DRIVERS extends never ? {
  [driver: string]: SinkValue<STATE, PROPS, ACTIONS, any, any>;
} : {
  [DRIVER_KEY in keyof DRIVERS]: SinkValue<STATE, PROPS, ACTIONS, ACTION_ENTRY, DRIVERS[DRIVER_KEY]>;
}

type ModelEntry<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY> = SinkValue<STATE, PROPS, ACTIONS, ACTION_ENTRY, STATE> | Partial<DefaultSinks<STATE, PROPS, ACTIONS, ACTION_ENTRY> & CustomDriverSinks<STATE, PROPS, DRIVERS, ACTIONS, ACTION_ENTRY>>;

type WithDefaultActions<STATE, ACTIONS> = ACTIONS & {
  BOOTSTRAP?: never;
  INITIALIZE?: STATE;
  HYDRATE?: any;
} 

type ComponentModel<STATE, PROPS, DRIVERS, ACTIONS> = keyof ACTIONS extends never ? {
  [action: string]: ModelEntry<STATE, PROPS, DRIVERS, WithDefaultActions<STATE, ACTIONS>, any>;
} : {
  [ACTION_KEY in keyof WithDefaultActions<STATE, ACTIONS>]?: ModelEntry<STATE, PROPS, DRIVERS, WithDefaultActions<STATE, ACTIONS>, WithDefaultActions<STATE, ACTIONS>[ACTION_KEY]>;
};

type ChildSource = {
  select: (type: string) => Stream<any>
}

type DefaultDrivers<STATE, EVENTS=any> = {
  STATE: {
    source: StateSource<STATE>;
    sink: STATE; 
  };
  DOM: {
    source: MainDOMSource;
    sink: never;
  };
  EVENTS: {
    source: Stream<Event<EVENTS>>;
    sink: EVENTS;
  };
  LOG: {
    source: never;
    sink: any;
  }
  CHILD: {
    source: ChildSource;
    sink: never;
  }
}

type Sources<DRIVERS> = {
  [DRIVER_KEY in keyof DRIVERS]: DRIVERS[DRIVER_KEY] extends { source: infer SOURCE } ? SOURCE : never;
}

type Actions<ACTIONS> = keyof ACTIONS extends never ? {
  [action: string]: Stream<any>;
} : {
  [ACTION_KEY in keyof ACTIONS]: Stream<ACTIONS[ACTION_KEY]>;
}

type CombinedSources<STATE, DRIVERS> = Sources<DefaultDrivers<STATE> & DRIVERS>;

interface ComponentIntent<STATE, DRIVERS, ACTIONS> {
  (args: CombinedSources<STATE, DRIVERS>): Partial<Actions<ACTIONS>>;
}

type Calculated<STATE, CALCULATED> = keyof CALCULATED extends never ? {
  [field: string]: boolean | StateOnlyReducer<STATE, any>;
} : {
  [CALCULATED_KEY in keyof CALCULATED]: boolean | StateOnlyReducer<STATE, CALCULATED[CALCULATED_KEY]>;
}

type Context<STATE, CONTEXT> = keyof CONTEXT extends never ? {
  [field: string]: boolean | StateOnlyReducer<STATE, any>;
} : {
  [CONTEXT_KEY in keyof CONTEXT]: boolean | StateOnlyReducer<STATE, CONTEXT[CONTEXT_KEY]>;
}

export type Lense<PARENT_STATE=any, CHILD_STATE=any> = {
  get: (state: PARENT_STATE) => CHILD_STATE;
  set: (state: PARENT_STATE, childState: CHILD_STATE) => PARENT_STATE;
}

export type Filter<ARRAY=any[]> = (array: ARRAY) => ARRAY

export type SortFunction<ITEM=any> = (a: ITEM, b: ITEM) => number
export type SortObject<ITEM=any> = {
  [field: string]: 'asc' | 'dec' | SortFunction<ITEM>;
}

type FixDrivers<DRIVERS> = 
    0 extends (1 & DRIVERS) 
        ? {} 
        : DRIVERS extends object 
            ? DRIVERS 
            : {};
/**
 * Sygnal Component
 * @template STATE - State
 * @template PROPS - Props (from JSX element)
 * @template DRIVERS - Custom Drivers (default drivers are automatically applied)
 * @template ACTIONS - Actions (key = action name; value = type expected for Observable values for that action)
 * @template CALCULATED - Calculated state values (key = calculated variable name; value = type of the calculated variable)
 * @template CONTEXT - Context (key = context variable name; value = type of the context variable)
 */
export type Component<STATE=any, PROPS={[prop: string]: any}, DRIVERS={}, ACTIONS={}, CALCULATED={}, CONTEXT={}> = ComponentProps<STATE, PROPS, CONTEXT> & {
  label?: string;
  DOMSourceName?: string;
  stateSourceName?: string;
  requestSourceName?: string;
  model?: ComponentModel<STATE, PROPS, FixDrivers<DRIVERS>, ACTIONS>;
  intent?: ComponentIntent<STATE, FixDrivers<DRIVERS>, ACTIONS>;
  initialState?: STATE;
  calculated?: Calculated<STATE, CALCULATED>;
  storeCalculatedInState?: boolean;
  context?: Context<STATE, CONTEXT>;
  peers?: { [name: string]: Component };
  components?: { [name: string]: Component };
  debug?: boolean;
};

/**
 * Sygnal Root Component
 * @template STATE - State
 * @template DRIVERS - Custom Drivers (default drivers are automatically applied)
 * @template ACTIONS - Actions (key = action name; value = type expected for Observable values for that action)
 * @template CALCULATED - Calculated state values (key = calculated variable name; value = type of the calculated variable)
 * @template CONTEXT - Context (key = context variable name; value = type of the context variable)
 */
export type RootComponent<STATE=any, DRIVERS={}, ACTIONS=any, CALCULATED=any, CONTEXT=any> = Component<STATE, any, DRIVERS, ACTIONS, CALCULATED, CONTEXT>

export type CollectionProps<PROPS=any> = {
  of: any;
  from: string | Lense;
  filter?: Filter;
  sort?: string | SortFunction | SortObject;
} & Omit<PROPS, 'of' | 'from' | 'filter' | 'sort'>;

export type SwitchableProps<PROPS=any> = {
  of: any;
  current: string;
  state?: string | Lense;
} & Omit<PROPS, 'of' | 'state' | 'current'>;

/**
 * JSX Types
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
  }
}

export type { Stream, MemoryStream } from 'xstream'
