// The public entry (external in the build), so islands share the app's
// Sygnal core instead of a bundled copy (B-019).
import { run } from 'sygnal'
// PLAN-4 GS-11 / D120: the app-level error hook, the default export of the module the
// integration's `onError` option names (undefined without it); served by sygnal/astro's Vite plugin
// @ts-ignore — a virtual module
import onError from 'virtual:sygnal/astro-on-error'

interface SygnalComponent {
  (args: any): any;
  model?: any;
  intent?: any;
  connections?: any;
  resources?: any;
  route?: any;
  head?: any;
  persist?: any;
  uses?: any;
  timers?: any;
  viewTransitions?: any;
  context?: any;
  initialState?: any;
  calculated?: any;
  onError?: (error: Error, info: { componentName: string }) => any;
  debug?: boolean;
  componentName?: string;
  name?: string;
}

interface AstroMetadata {
  client?: string;
}

function looksLikeSygnalComponent(Component: any): Component is SygnalComponent {
  if (typeof Component !== 'function') return false
  return Boolean(
    Component.model ||
      Component.intent ||
      Component.initialState ||
      Component.componentName
  )
}

export default (element: any) => {
  return async (Component: any, props: any, _slotted: any, metadata: AstroMetadata) => {
    if (!looksLikeSygnalComponent(Component)) return

    const mountPoint = element
    const { client } = metadata || {}
    const canHydrate = element.hasAttribute('ssr')

    if (client !== 'only' && !canHydrate) return

    const previous = element.__sygnal
    if (previous && typeof previous.dispose === 'function') {
      previous.dispose()
    }

    // Island props reach the view like any component's props, spread
    // top-level (`{ state, title }`), the same as on the server
    // (renderToString). The view args (state, context, ...) win over a prop
    // with the same name; `props` is kept for older `({ state, props })`
    // views (B-026).
    const islandProps = { ...(props || {}) }
    const Wrapped: any = (args: any) => Component({ ...islandProps, ...args, props: islandProps })
    Wrapped.model = Component.model
    Wrapped.intent = Component.intent
    Wrapped.context = Component.context
    Wrapped.initialState = Component.initialState
    Wrapped.calculated = Component.calculated
    Wrapped.onError = Component.onError
    Wrapped.debug = Component.debug
    Wrapped.connections = Component.connections
    Wrapped.resources = Component.resources
    Wrapped.route = Component.route
    Wrapped.head = Component.head
    // PLAN-4 3-B2: more statics the core reads off the root view: persist (root only: the island
    // is its app's root), uses, timers (they run only with a timer driver) and viewTransitions
    Wrapped.persist = Component.persist
    Wrapped.uses = Component.uses
    Wrapped.timers = Component.timers
    Wrapped.viewTransitions = Component.viewTransitions
    Wrapped.componentName = Component.componentName || Component.name
    // run() names the root by `name` first: diagnostics and devtools should
    // say 'Counter', not 'Wrapped'
    try { Object.defineProperty(Wrapped, 'name', { value: Wrapped.componentName, configurable: true }) } catch (_) {}

    // G-206: a `uid` island prop is the island's uid root (as on the server); the view's own
    // uid() function wins over the prop (args are spread last)
    // 3-B2: `__hydrate` tells persist() whether the island starts over the server's markup
    const app = run(Wrapped, { __hydrate: () => client !== 'only' && canHydrate }, { mountPoint, onError, uid: islandProps.uid })
    element.__sygnal = app
  }
}
