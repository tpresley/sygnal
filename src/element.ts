// 'sygnal/element' (PLAN-4 GS-13, D127): publish a Sygnal component as a custom element.
//
//   defineElement('task-board', TaskBoard, {
//     props: { title: String, tasks: Array, readonly: Boolean },  // or ['a', 'b'] (all String)
//     events: { PARENT: 'task-picked' },                          // sink name → CustomEvent name
//     shadow: true,                                               // true | 'open' | 'closed'
//     styles: '.title { color: green }',                          // string | CSSStyleSheet | array
//   })
//
// Each connected element is its own app: run(Component) mounted on a div inside the element
// (or its shadow root). Props are in state from the first render (the component's
// initialState, overlaid with the props); later property/attribute changes are merged into
// state. Sinks listed in `events` are dispatched as CustomEvents (bubbles + composed; the
// PARENT wrapper is unwrapped to its value). Removing the element disposes the app; a move
// (disconnect + connect in the same task) keeps it running. Calling defineElement again for
// the same tag (HMR) swaps the component in every live element, keeping each one's state.
//
// Separate entry: rollup rewrites './index' to the external 'sygnal' (0 B in the core bundle).
import {run} from './index';

export type ElementPropType =
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | ObjectConstructor
  | ArrayConstructor;

export interface ElementOptions {
  /** Properties fed into state (camelCase; the attribute is kebab-case). An array means all String. */
  props?: readonly string[] | Record<string, ElementPropType>;
  /** Sink name → CustomEvent name, e.g. { PARENT: 'task-picked' } */
  events?: Record<string, string>;
  /** Render into a shadow root (true = 'open') */
  shadow?: boolean | 'open' | 'closed';
  /** Adopted into the shadow root, shared by every instance (ignored without shadow) */
  styles?: string | CSSStyleSheet | Array<string | CSSStyleSheet>;
}

// Sinks that are the app's own drivers, never events
const RESERVED_SINKS = ['DOM', 'STATE', 'EVENTS'];

// Hot-swap functions of the tags this module defined
const swaps = new WeakMap<CustomElementConstructor, (Component: any) => void>();

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

function parseAttribute(type: ElementPropType, value: string | null): any {
  if (type === Boolean) return value !== null;
  if (value === null) return undefined;
  if (type === Number) return Number(value);
  if (type === String) return value;
  return JSON.parse(value); // Object, Array (throws on bad JSON)
}

function toSheet(style: string | CSSStyleSheet): CSSStyleSheet {
  if (typeof style !== 'string') return style;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(style);
  return sheet;
}

const devMode = () => (globalThis as any).__SYGNAL_DEV__ === true;

export function defineElement(tag: string, Component: any, options: ElementOptions = {}): CustomElementConstructor {
  const prior = customElements.get(tag);
  const swap = prior && swaps.get(prior);
  if (swap) {
    swap(Component); // HMR: the defining module ran again
    return prior!;
  }
  if (typeof Component !== 'function' || Component.isSygnalComponent) {
    throw new TypeError(`defineElement('${tag}'): pass a plain function component (not a component() result)`);
  }

  const types: Record<string, ElementPropType> = Array.isArray(options.props)
    ? Object.fromEntries(options.props.map((name: string) => [name, String]))
    : {...(options.props as Record<string, ElementPropType> | undefined)};
  const propOfAttribute: Record<string, string> = Object.fromEntries(Object.keys(types).map((name) => [kebab(name), name]));
  const events = {...options.events};
  for (const sink of RESERVED_SINKS) {
    if (sink in events) throw new TypeError(`defineElement('${tag}'): '${sink}' is a driver of the element's app, not an event sink`);
  }
  const shadowMode = options.shadow ? (options.shadow === 'closed' ? 'closed' : 'open') : undefined;
  const sheets = shadowMode ? ([] as Array<string | CSSStyleSheet>).concat(options.styles || []).map(toSheet) : [];
  // Props that hide a member of HTMLElement (e.g. title, hidden): warned once, in dev
  const shadowedMembers = Object.keys(types).filter((name) => name in HTMLElement.prototype);
  let warned = false;

  const live = new Set<SygnalElement>();
  let instances = 0;

  class SygnalElement extends HTMLElement {
    static observedAttributes = Object.keys(propOfAttribute);

    #props: Record<string, any> = {};
    #app: any = undefined;
    #root: HTMLElement | ShadowRoot = this;
    #uid = `${tag}-${++instances}`;

    static {
      for (const name of Object.keys(types)) {
        Object.defineProperty(this.prototype, name, {
          configurable: true,
          enumerable: true,
          get(this: SygnalElement) {
            return this.#props[name];
          },
          set(this: SygnalElement, value: any) {
            this.#setProp(name, value);
          },
        });
      }
      swaps.set(this, (Next: any) => {
        Component = Next;
        live.forEach((element) => element.#swap());
      });
    }

    constructor() {
      super();
      if (shadowMode) {
        const root = this.attachShadow({mode: shadowMode});
        root.adoptedStyleSheets = sheets;
        this.#root = root;
      }
      // Properties set before the tag was defined are own properties that hide the
      // accessors: move them onto the accessors
      for (const name of Object.keys(types)) {
        if (Object.prototype.hasOwnProperty.call(this, name)) {
          const value = (this as any)[name];
          delete (this as any)[name];
          this.#setProp(name, value);
        }
      }
    }

    attributeChangedCallback(attribute: string, _old: string | null, value: string | null) {
      const name = propOfAttribute[attribute];
      try {
        this.#setProp(name, parseAttribute(types[name], value));
      } catch (_) {
        // bad JSON in an Object/Array attribute: keep the previous value
      }
    }

    connectedCallback() {
      if (this.#app) return; // moved, not removed: keep running
      // (G-216: a hot swap elsewhere on the page is that app's own, so no need to wait it out)
      if (shadowedMembers.length && !warned && devMode()) {
        warned = true;
        console.warn(
          `[sygnal/element] <${tag}>: props hide the HTMLElement members of the same name ` +
            `(${shadowedMembers.join(', ')}). Rename them to keep the native behaviour.`
        );
      }
      const mount = document.createElement('div');
      this.#root.appendChild(mount);
      this.#app = run(this.#component(), this.#eventDrivers(), {mountPoint: mount as any, uid: this.#uid});
      this.#releaseDevtools();
      live.add(this);
    }

    disconnectedCallback() {
      // Deferred: a move is a disconnect + connect in the same task
      queueMicrotask(() => {
        if (this.isConnected || !this.#app) return;
        this.#app.dispose();
        this.#app = undefined;
        live.delete(this);
        this.#root.replaceChildren();
      });
    }

    // Hot swap (defineElement again for this tag): the new component, this element's state
    #swap() {
      if (!this.#app) return;
      this.#app.hmr(this.#component(), this.#app.sources.STATE.stream._v);
      this.#releaseDevtools();
    }

    #setProp(name: string, value: any) {
      this.#props[name] = value;
      this.#app?.sinks.STATE.shamefullySendNext((state: any) => ({...state, [name]: value}));
    }

    // A per-instance copy of the component whose initialState includes the current props
    #component() {
      const wrapped = Object.assign((...args: any[]) => Component(...args), Component, {
        initialState: {...Component.initialState, ...this.#props},
      });
      return Object.defineProperty(wrapped, 'name', {value: Component.name || tag});
    }

    #eventDrivers() {
      return Object.fromEntries(
        Object.entries(events).map(([sink, eventName]) => [
          sink,
          (sink$: any) => {
            sink$.addListener({
              next: (value: any) => {
                // PARENT values arrive wrapped as { name, component, value }
                const detail = sink === 'PARENT' ? value?.value : value;
                this.dispatchEvent(new CustomEvent(eventName, {detail, bubbles: true, composed: true}));
              },
            });
          },
        ])
      );
    }

    // run() registers the first live app for DevTools time travel (G-212). An element gives
    // the slot back, so a host app that starts later gets it
    #releaseDevtools() {
      const w = window as any;
      if (w.__SYGNAL_DEVTOOLS_APP__?.sinks === this.#app.sinks) w.__SYGNAL_DEVTOOLS_APP__ = undefined;
    }
  }

  customElements.define(tag, SygnalElement);
  return SygnalElement;
}
