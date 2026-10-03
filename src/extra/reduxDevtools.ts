/**
 * PLAN-4 3-E (GS-10 stretch): a dev-only bridge to the Redux DevTools extension
 * (window.__REDUX_DEVTOOLS_EXTENSION__), in 'sygnal/devtools'. Sends each recorded action
 * (./devtoolsActions; built-in ones left out) with the root's state after it, as
 * `{ type: '<Component>/<ACTION>', payload, cause, instance }`. Jump to state / action in the
 * extension replaces the root's state (the Sygnal DevTools time-travel path). sygnal/vite calls it
 * in dev with sygnal({ devtools: { redux: true } }).
 */
import {recordActions, onAction, resolveInstance, preview} from './devtoolsActions'
import type {DevtoolsAction} from './devtoolsActions'

export interface ReduxDevtoolsOptions {
  /** the instance name in the extension (default 'Sygnal') */
  name?: string
  /** which actions to send (default: all but 'built-in' ones) */
  filter?: (action: DevtoolsAction) => boolean
}

const clone = (s: any) => preview(s)

let shared: (() => void) | undefined

/**
 * Connect the app's root (run()'s result, a component, an instance id; default: the newest root)
 * to the Redux DevTools extension. Returns a disconnect function; does nothing without the
 * extension.
 */
export function connectReduxDevtools(target?: any, options?: ReduxDevtoolsOptions): () => void {
  // the default connection (sygnal/vite may inject the call in several files) is made once
  if (target === undefined && options === undefined) {
    if (!shared) {
      const off = connect(undefined, {})
      shared = () => { off(); shared = undefined }
    }
    return shared
  }
  return connect(target, options || {})
}

function connect(target: any, options: ReduxDevtoolsOptions): () => void {
  const ext = typeof window != 'undefined' && (window as any).__REDUX_DEVTOOLS_EXTENSION__
  if (!ext || typeof ext.connect != 'function') return () => {}
  recordActions()
  const conn = ext.connect({name: options.name || 'Sygnal', features: {jump: true, pause: true, export: true}})
  const keep = options.filter || ((a: DevtoolsAction) => a.cause != 'built-in')
  let root: any, started = false, timer: any = null
  const queue: DevtoolsAction[] = []

  const rootOf = () => {
    if (!root || root.disposed || !root.c) root = resolveInstance(target)
    return root
  }
  const flush = () => {
    timer = null
    const r = start()
    if (!r) return
    for (const a of queue.splice(0)) {
      const state = a.instance === r.id && 'after' in a ? a.after : r.c.currentState
      conn.send({type: `${a.component}/${a.type}`, payload: preview(a.data), cause: a.cause, instance: a.instance}, clone(state))
    }
  }
  const start = () => {
    const r = rootOf()
    if (r && !started) { started = true; conn.init(clone(r.c.currentState)) }
    return r
  }
  start()
  const off = onAction((a, kind) => {
    if (kind == 'reset') { queue.length = 0; started = false; start(); return }
    if (kind != 'add') return
    // connected before run() (sygnal/vite): the root's first action, its state still the initial one
    if (!started) start()
    if (!keep(a!)) return
    queue.push(a!)
    if (timer === null) timer = setTimeout(flush, 0)
  })
  const unsubscribe = conn.subscribe((msg: any) => {
    if (msg?.type !== 'DISPATCH' || !msg.state) return
    const t = msg.payload?.type
    if (t !== 'JUMP_TO_STATE' && t !== 'JUMP_TO_ACTION') return
    const r = rootOf()
    const dt = (window as any).__SYGNAL_DEVTOOLS__
    if (!r || !dt || typeof dt._timeTravel != 'function') return
    try { dt._timeTravel({componentId: Number(r.id), componentName: r.name, state: JSON.parse(msg.state)}) } catch (_) { /* a bad state from the extension */ }
  })
  return () => {
    off()
    if (timer !== null) clearTimeout(timer)
    if (typeof unsubscribe == 'function') unsubscribe()
    try { ext.disconnect?.() } catch (_) { /* ignore */ }
  }
}
