// 'sygnal/react' (PLAN-5 W-2, D203): fromReact, a React component as a widget tag. Needs react
// and react-dom (or preact/compat through a bundler alias).
import type { Widget, WidgetDefinition } from 'sygnal'

/** The adapter instance (`t.widget(sel).instance` with `dom: 'real'`) */
export interface ReactInstance {
  /** The React root on the host */
  root: { render(node: any): void; unmount(): void }
  /** The host element */
  el: HTMLElement
  /** The props of the last render */
  props: Record<string, any>
}

export interface FromReactOptions<P = any> {
  /**
   * The callbacks that become DOM events on the host: `{ rate: 'onChange' }` (event name →
   * callback prop), or `['onChange']` (dispatched under the callback's own name). The detail is
   * the callback's argument (an array when it gets more than one).
   */
  events?: Record<string, string> | readonly string[]
  /** The component's props from the widget's (default: all but className, class, id, style, attrs) */
  props?: (props: P) => Record<string, any>
  /** Element commands, called with the instance */
  commands?: Record<string, (instance: ReactInstance, options: Record<string, any>, el: HTMLElement) => unknown>
  /** The host element (default 'div') */
  tag?: string
  /** A name for diagnostics (default: the component's displayName or name) */
  name?: string
  /** What server rendering puts in the host */
  fallback?: WidgetDefinition['fallback']
  /** More prop names for the host element */
  hostProps?: string[]
  /** Prop names that stay off the host and go only to the component */
  ownProps?: string[]
}

/**
 * A React component as a widget tag (an escape hatch): `fromReact(StarRating, { events: { rate: 'onChange' } })`.
 * Render it with a class (`<Stars className="rating" value={state.rating} />`) and read its events
 * in the intent (`DOM.select('.rating').events('rate').detail()`).
 */
export function fromReact<P = any>(component: any, options?: FromReactOptions<P>): Widget<P, ReactInstance>
