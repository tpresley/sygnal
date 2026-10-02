// The public entry (external in the build), so islands share the app's
// Sygnal core instead of a bundled copy (B-019).
import { run } from 'sygnal'

interface SygnalComponent {
  (args: any): any;
  isSygnalComponent?: boolean;
  model?: any;
  intent?: any;
  hmrActions?: any;
  connections?: any;
  context?: any;
  peers?: any;
  components?: any;
  initialState?: any;
  calculated?: any;
  storeCalculatedInState?: any;
  DOMSourceName?: string;
  stateSourceName?: string;
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
    Component.isSygnalComponent ||
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
    Wrapped.hmrActions = Component.hmrActions
    Wrapped.context = Component.context
    Wrapped.peers = Component.peers
    Wrapped.components = Component.components
    Wrapped.initialState = Component.initialState
    Wrapped.calculated = Component.calculated
    Wrapped.storeCalculatedInState = Component.storeCalculatedInState
    Wrapped.DOMSourceName = Component.DOMSourceName
    Wrapped.stateSourceName = Component.stateSourceName
    Wrapped.onError = Component.onError
    Wrapped.debug = Component.debug
    Wrapped.connections = Component.connections
    Wrapped.componentName = Component.componentName || Component.name
    // run() names the root by `name` first: diagnostics and devtools should
    // say 'Counter', not 'Wrapped'
    try { Object.defineProperty(Wrapped, 'name', { value: Wrapped.componentName, configurable: true }) } catch (_) {}

    const app = run(Wrapped, {}, { mountPoint })
    element.__sygnal = app
  }
}
