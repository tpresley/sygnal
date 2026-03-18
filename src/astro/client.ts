import run from '../extra/run'

interface SygnalComponent {
  (args: any): any;
  isSygnalComponent?: boolean;
  model?: any;
  intent?: any;
  hmrActions?: any;
  context?: any;
  peers?: any;
  components?: any;
  initialState?: any;
  calculated?: any;
  storeCalculatedInState?: any;
  DOMSourceName?: string;
  stateSourceName?: string;
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

    const Wrapped: any = (args: any) => Component({ ...args, props: { ...(props || {}) } })
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
    Wrapped.debug = Component.debug
    Wrapped.componentName = Component.componentName || Component.name

    const app = run(Wrapped, {}, { mountPoint })
    element.__sygnal = app
  }
}
