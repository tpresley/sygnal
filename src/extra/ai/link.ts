/*
 * PLAN-6 (D283): how the sygnal/ai behaviors (`chat`, L-3; `commandBar`, M-3) reach their app's
 * runtime, with 0 core bytes. The agent layer (A-1) needs the app's runtime API and the host
 * instance, which a behavior's handlers don't get. The first factory call (`chat()`,
 * `commandBar()`) adds one hook-layer factory to the core bridge's `layers`
 * (`globalThis.__SYGNAL_DIAGNOSTICS__.layers`, which every App reads when it is constructed, as
 * the dev entries do), so each app made after it hands the layer its runtime API. The layer's
 * onAction (called synchronously right before an action's handlers) records the instance and its
 * pre-action state; a handler takes them when its `props.state` is that state (an app made before
 * the first factory call, e.g. a host loaded lazily into a running app, never has a match: its
 * host is reported as SYG442).
 *
 * Per (host instance, uses key) a behavior keeps one engine (`engineOf`); the layer's onDispose
 * stops the host's engines.
 */
import {error as logError} from '../diagnostics/legacy'

const G: any = globalThis
/** marks a `uses` value whose host needs the link (`linked()`) */
const AI = Symbol.for('sygnal.aiBehavior')

interface Ctx {api: any; iv: any; pre: any}
export interface Engine {api: any; iv: any; k: string; stop(): void}

/** the instance whose action is being handled (set by the layer's onAction; one object per app) */
let cur: Ctx | undefined
const engines = new WeakMap<any, Map<string, Engine>>()
/** the dispose$ of each linked host an app with the layer created (SYG442 otherwise) */
const known = new WeakSet<any>()
const isHost = (iv: any) => {
  const u = iv.def.view.uses
  for (const k in u) if (u[k]?.[AI]) return true
  return false
}

const layer = (api: any) => {
  const c: Ctx = {api, iv: null, pre: null}
  return {
    onCreate: (iv: any) => { if (isHost(iv)) known.add(iv.sources.dispose$) },
    onAction: (iv: any) => { c.iv = iv; c.pre = iv.state; cur = c },
    onDispose: (iv: any) => { engines.get(iv)?.forEach(e => e.stop()) },
  }
}

/** install the layer (before run()) and mark the behavior value `b` as needing it */
export function linked<B>(b: B): B {
  const D = G.__SYGNAL_DIAGNOSTICS__ ||= {}, L = D.layers ||= new Set()
  if (L.add) L.add(layer)
  else if (!L.includes(layer)) L.push(layer)
  ;(b as any)[AI] = true
  return b
}

/**
 * The engine of the host whose action runs now, made by `make(api, iv)` on first use (undefined
 * when the app has no layer, or `props` isn't the acting instance's)
 */
export function engineOf<E extends Engine>(props: any, k: string, make: (api: any, iv: any) => E): E | undefined {
  const c = cur
  if (!c || !props || props.state !== c.pre || c.iv.disposed) return
  const iv = c.iv
  let m = engines.get(iv)
  if (!m) engines.set(iv, m = new Map())
  let e = m.get(k) as E | undefined
  if (!e) m.set(k, e = make(c.api, iv))
  return e
}

const warned = new Set<string>()
/** SYG442, once per behavior: an intent's host has no link (its app was made before the factory call) */
export function checkLinked(sources: any, name: string, without: string) {
  if (known.has(sources.dispose$) || warned.has(name)) return
  warned.add(name)
  logError('SYG442', name, `the ${name} behavior has no connection to its app (the app was started before the first ${name}() call): ${without}`, `Call ${name}() in a module imported before run(), not only in a component loaded later`)
}
