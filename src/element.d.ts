// 'sygnal/element' (PLAN-4 GS-13, D127): publish a Sygnal component as a custom element.
// Self-contained (like the other entries' types).

export type ElementPropType =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | ObjectConstructor
  | ArrayConstructor

/** The property type a prop declaration gives (attributes are parsed to it). */
export type ElementPropValue<T> =
  T extends BooleanConstructor ? boolean :
  T extends NumberConstructor ? number | undefined :
  T extends StringConstructor ? string | undefined :
  T extends ArrayConstructor ? any[] | undefined :
  T extends ObjectConstructor ? Record<string, any> | undefined :
  never

/** The element's prop properties for a `props` option (an array means all String). */
export type ElementProps<P> =
  P extends readonly (infer K extends string)[] ? { [N in K]: string | undefined } :
  P extends Record<string, ElementPropType> ? { -readonly [N in keyof P]: ElementPropValue<P[N]> } :
  {}

export interface ElementOptions<P extends readonly string[] | Record<string, ElementPropType> = readonly string[] | Record<string, ElementPropType>> {
  /**
   * Properties fed into state: camelCase names; each also has a kebab-case attribute
   * (`dueDate` ↔ `due-date`). String/Number attributes are parsed, Boolean is presence,
   * Object/Array are JSON. An array of names means all String.
   */
  props?: P
  /**
   * Sink name → CustomEvent name, e.g. `{ PARENT: 'task-picked' }`. The event bubbles and is
   * composed; `detail` is the sink's value. Use lowercase names (React 19 listens with
   * `on<exact-name>`, e.g. `ontask-picked`). DOM, STATE and EVENTS can't be used.
   */
  events?: Record<string, string>
  /** Render into a shadow root (true = 'open') */
  shadow?: boolean | 'open' | 'closed'
  /** Adopted into the shadow root, shared by every instance (ignored without shadow) */
  styles?: string | CSSStyleSheet | Array<string | CSSStyleSheet>
}

export interface SygnalElementConstructor<P = {}> {
  new (): HTMLElement & ElementProps<P>
  prototype: HTMLElement & ElementProps<P>
  readonly observedAttributes: string[]
}

/**
 * Define `tag` as a custom element that runs `Component` (a plain function component) as
 * its own app. Define it before a host framework renders the tag, so props arrive as
 * properties. Calling it again for the same tag hot-swaps the component in every live
 * element, keeping each one's state (HMR), and returns the same constructor.
 */
export declare function defineElement<
  const P extends readonly string[] | Record<string, ElementPropType> = {}
>(tag: string, Component: (...args: any[]) => any, options?: ElementOptions<P>): SygnalElementConstructor<P>
