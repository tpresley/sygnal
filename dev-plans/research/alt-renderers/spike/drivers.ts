/**
 * In-memory stand-ins for examples/todomvc's two app drivers (localStorage, hash router), with the
 * same source shapes: the app's intent and model use them unchanged. Drivers are where platform
 * services live in Sygnal, so this is the whole port for them.
 */
import xs, {Stream} from 'xstream'

export function makeMemoryStore(seed: Record<string, any> = {}) {
  const data = new Map(Object.entries(seed))
  const driver = (fx$: Stream<{key: string, value: any}>) => {
    fx$.addListener({next: ({key, value}) => data.set(key, JSON.parse(JSON.stringify(value)))})
    return {get: (key: string, dflt?: any) => xs.of(data.has(key) ? data.get(key) : dflt)}
  }
  return {driver, data}
}

/** the router's routes come from the app (ADD_ROUTE); go('#/active') emits 'active' when known */
export function makeMemoryRouter() {
  const routes = new Set<string>()
  let out: any
  const driver = (route$: Stream<string | string[]>) => {
    route$.addListener({next: (r) => [r].flat().forEach((x) => routes.add(x))})
    return xs.create<string>({start: (l) => { out = l }, stop: () => { out = null }})
  }
  const go = (href: string) => { const r = href.replace(/^#\//, ''); if (routes.has(r)) out?.next(r) }
  return {driver, go, routes}
}
