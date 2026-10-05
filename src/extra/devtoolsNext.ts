/**
 * PLAN-4.6 R4: 'sygnal/devtools' on the next component core (04 §3.5).
 *
 * The core calls no `window.__SYGNAL_DEVTOOLS__` method itself: each app reads the dev
 * entries' hook layers once (`__SYGNAL_DIAGNOSTICS__.layers`), and this file's layer maps the
 * hooks onto the bridge's existing methods (onComponentCreated, onStateChanged, ...). The bridge
 * keeps a facade per instance with the fields it reads from today's instances (currentState,
 * model, sourceNames, ...); time travel and the debug toggle go through the app's runtime API
 * (`setState`, `setDebug`) instead of `sinks.STATE.shamefullySendNext` and `instance._debug`.
 */
const facades = new WeakMap<object, any>()

/** the bridge's view of a core instance (an InstanceView + its app's runtime API) */
export function devFacade(iv: any, api: any): any {
  let f = facades.get(iv)
  if (f) return f
  f = {
    __next: iv,
    __api: api,
    get _componentNumber() { return iv.id },
    get name() { return iv.name },
    get isSubComponent() { return !iv.isRoot },
    get parentId() { return iv.parentId },
    get view() { return iv.def.view },
    get model() {
      const m: Record<string, any> = {}
      iv.def.handlers.forEach((hs: any[], a: string) => { const e: any = m[a] = {}; for (const [s, fn] of hs) e[s] = fn })
      return m
    },
    get intent() { return iv.def.intent },
    get context() { return iv.def.view.context },
    get calculated() { return iv.def.view.calculated },
    get _behaviorActions() { return iv.def.behaviorActions },
    get currentState() { return iv.state },
    get currentContext() { return iv.context },
    get currentProps() { return iv.props },
    get sources() { return iv.sources },
    get sourceNames() { return Object.keys(iv.sources) },
    stateSourceName: 'STATE',
    get _debug() { return false },
    /** the state without its calculated fields (as today's cleanupCalculated) */
    cleanupCalculated(s: any) {
      const c = iv.def.calcNames
      if (!c || !s || typeof s != 'object' || Array.isArray(s)) return s
      const out = {...s}
      c.forEach((k: string) => { delete out[k] })
      return out
    },
  }
  facades.set(iv, f)
  return f
}

/** the hook layer of the DevTools bridge `dt` for one app */
export function devtoolsHooks(dt: any, api: any): any {
  const mounted = new WeakSet<object>()
  return {
    onCreate(iv: any) {
      const f = devFacade(iv, api)
      dt.onComponentCreated(iv.id, iv.name, f)
      if (iv.parentId !== undefined) dt.onSubComponentRegistered(iv.parentId, iv.id)
      // a Collection's first item (today's onCollectionMounted)
      if (iv.kind == 'item' && iv.parentId !== undefined) {
        const p = api.get(iv.parentId)
        if (p && !mounted.has(p)) { mounted.add(p); dt.onCollectionMounted(p.id, p.name, iv.name, null) }
      }
    },
    onStateChanged(iv: any, s: any) { dt.connected && dt.onStateChanged(iv.id, iv.name, s) },
    onPropsChanged(iv: any, p: any) { dt.connected && dt.onPropsChanged(iv.id, iv.name, p) },
    onContextChanged(iv: any, c: any) { dt.connected && dt.onContextChanged(iv.id, iv.name, c) },
    onAction(iv: any, a: any) { dt.connected && dt.onActionDispatched(iv.id, iv.name, a.type, a.data) },
    onReady(p: any, c: any, ready: boolean) { dt.connected && dt.onReadyChanged(p.id, p.name, c.name, ready) },
    onDispose(iv: any) { dt.onComponentDisposed(iv.id, iv.name) },
  }
}

/** register a hook layer factory with the core (read by each app at its start) */
export function addLayer(f: (api: any) => any): () => void {
  const core = (globalThis as any).__SYGNAL_DIAGNOSTICS__
  if (!core) return () => {}
  ;(core.layers ||= new Set()).add(f)
  return () => { core.layers?.delete(f) }
}
