type Lense<PARENT_STATE=any, CHILD_STATE=any> = {
  get: (state: PARENT_STATE) => CHILD_STATE;
  set: (state: PARENT_STATE, childState: CHILD_STATE) => PARENT_STATE;
}

type Filter<ARRAY=any[]> = (array: ARRAY) => ARRAY

type SortFunction<ITEM=any> = (a: ITEM, b: ITEM) => number
type SortObject<ITEM=any> = {
  [field: string]: 'asc' | 'dec' | SortFunction<ITEM>;
}

type CollectionProps<PROPS=any> = {
  of: any;
  from: string | Lense;
  filter?: Filter;
  sort?: string | SortFunction | SortObject;
} & Omit<PROPS, 'of' | 'from' | 'filter' | 'sort'>;

type SwitchableProps<PROPS=any> = {
  of: any;
  current: string;
  state?: string | Lense;
} & Omit<PROPS, 'of' | 'state' | 'current'>;

type ClassesType = (string | string[] | { [className: string]: boolean })[]


declare module 'sygnal' {
  export function run(component: any, drivers?: any, options?: any): { hmr: (newComponent: any) => void }
  export function classes(...classes: ClassesType): string;
  export function processForm<FIELDS extends { [field: string]: any }>(target: HTMLFormElement, options: { events: string | string[], preventDefault: boolean }): FIELDS & { event: Event, eventType: string };
  export function Collection<PROPS extends { [prop: string]: any }>(
    props: CollectionProps<PROPS>
  ): JSX.Element;
  export function Switchable<PROPS extends { [prop: string]: any }>(
    props: SwitchableProps<PROPS>
  ): JSX.Element;
  export const ABORT: '~#~#~ABORT~#~#~';
  export { default as xs } from 'xstream';
  export * from '@cycle/dom'
  export { default as debounce } from "xstream/extra/debounce"
  export { default as throttle } from 'xstream/extra/throttle'
  export { default as delay } from "xstream/extra/delay"
  export { default as dropRepeats } from "xstream/extra/dropRepeats"
  export { default as sampleCombine } from 'xstream/extra/sampleCombine'
}