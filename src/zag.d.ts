// 'sygnal/zag' (PLAN-5 W-2, D203): fromZag, a Zag.js machine as a widget tag. Types for the entry.
import type { Widget, WidgetDefinition } from 'sygnal'

/** snabbdom data for one element, from a Zag prop getter: spread it on the element in JSX */
export interface ZagElementProps {
  attrs: Record<string, any>
  on: Record<string, (event: any) => void>
  props: Record<string, any>
  style: Record<string, any>
}

/** A Zag machine package: `import * as menu from '@zag-js/menu'` */
export interface ZagPackage {
  machine: any
  connect: (service: any, normalize: any) => any
}

/** The adapter instance (`t.widget(sel).instance` with `dom: 'real'`) */
export interface ZagInstance {
  /** The host element */
  el: HTMLElement
  /** The VanillaMachine */
  machine: any
  /** The connected api (prop getters return ZagElementProps) */
  api(): any
  /** Dispatches an event on the host, as `mount`'s `dispatch` */
  dispatch(name: string, detail?: any): void
  /** Recomputes the machine props (`options.props`), notifies the machine and re-renders */
  refresh(): void
  /** Whatever a part keeps per instance */
  [key: string]: any
}

export interface FromZagOptions<P = any> {
  /**
   * Dispatched event name → the Zag callback (detail: Zag's details object), or [callback,
   * (details, x) => detail]; null only declares the name (dispatch it with `x.dispatch`)
   */
  events?: Record<string, string | [string, (details: any, x: ZagInstance) => any] | null>
  /** The machine's props from the widget's props (default: the widget props as they are) */
  props?: (props: P, x: ZagInstance) => Record<string, any>
  /** Element commands: `{ open: (api) => api.setOpen(true) }`, called with the api, the options and the instance */
  commands?: Record<string, (api: any, options: any, x: ZagInstance) => any>
  /** The host element (default 'div') */
  tag?: string
  /** A name for diagnostics */
  name?: string
  /** What server rendering puts in the host */
  fallback?: WidgetDefinition['fallback']
  /** More prop names for the host element */
  hostProps?: string[]
}

/**
 * A Zag machine as a widget tag. `render(api, props, x)` renders the machine's parts with Sygnal
 * JSX, spreading the prop getters: `<button {...api.getTriggerProps()}>`. Machine callbacks named
 * in `events` become bubbling DOM events on the host (`DOM.select('.menu').events('select').detail()`).
 */
export function fromZag<P = any>(zag: ZagPackage, render: (api: any, props: P, x: ZagInstance) => any, options?: FromZagOptions<P>): Widget<P, ZagInstance>

/** One Zag prop bag as snabbdom data `{ attrs, on, props, style }` (what the api's prop getters return inside fromZag) */
export function zagProps(bag: Record<string, any>): ZagElementProps
