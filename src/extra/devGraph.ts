/**
 * PLAN-10 P-2 (D544): the app side of the graph page's "Live data" (sygnal/vite serves the page at
 * `/__sygnal/graph` in dev, W-2 / D543). Dev only: it is part of the 'sygnal/devtools' entry, and
 * sygnal/vite's 'virtual:sygnal/graph' module (served by the dev server, never in a build) calls
 * installGraphBridge().
 *
 * The page is served by the dev server on the app's own origin, so the two talk over a
 * BroadcastChannel ('sygnal:graph'): no server round trip, no HMR traffic, nothing a page on
 * another origin can join. Every message carries `v: 1`.
 *
 *   page → apps  { type: 'who', watch? }          every 2 s while the page is open; `watch` names
 *                                                 the tab the page follows (it keeps that tab
 *                                                 sending for 6 s)
 *   app  → page  { type: 'here', tab, url, title, at, ok }   the answer, and on load / focus
 *                                                 (`at`: when the tab was last loaded or focused;
 *                                                 `ok`: inspect() is there, i.e. diagnostics on)
 *   app  → page  { type: 'graph', tab, graph }    inspect({ actions: 200 }) of the page's apps, JSON
 *                                                 safe: when it starts being watched, then 150 ms
 *                                                 after the last action or component change
 *   app  → page  { type: 'action', tab, record }  { type, instance, component } at once (a flash)
 *   page → app   { type: 'get-state', tab, req, id }   an instance's state
 *   app  → page  { type: 'state', tab, req, id, value?, error? }
 *   app  → page  { type: 'bye', tab }             the tab is going away (pagehide)
 *
 * State values go through the DevTools preview (JSON safe, as the MCP tools send them). The static
 * keys the page joins on are on the component functions (sygnal/vite's dev transform) and come out
 * of inspect() as `key`.
 */
import {getDevTools} from './devtools'
import {onAction} from './devtoolsActions'
import {addLayer} from './devtoolsNext'
import {pageTools, trackApps} from './devMcp'

export const GRAPH_CHANNEL = 'sygnal:graph'
const WATCH_MS = 6000
const SETTLE_MS = 150

export interface GraphBridgeOptions {
  /** the BroadcastChannel name (default 'sygnal:graph') */
  channel?: string
}

let installed = false

/** Connect this page to the graph page's "Live data" (sygnal/vite calls it in dev). Once per page. */
export function installGraphBridge(options: GraphBridgeOptions = {}): void {
  const g: any = globalThis
  if (installed || typeof g.BroadcastChannel != 'function' || !g.window) return
  installed = true
  trackApps()
  const bc = new g.BroadcastChannel(options.channel || GRAPH_CHANNEL)
  const tab = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  const tools = pageTools({})
  let at = Date.now()
  let watchedUntil = 0
  let timer: any = 0

  const inspect = () => {
    const f = g.__SYGNAL_DIAGNOSTICS__?.inspect || (getDevTools() as any)?.inspect
    return typeof f == 'function' ? f : null
  }
  const post = (m: any) => { try { bc.postMessage({v: 1, tab, ...m}) } catch (_) { /* closed */ } }
  const here = () => post({type: 'here', url: String(g.location?.href || ''), title: String(g.document?.title || ''), at, ok: !!inspect()})
  const watched = () => Date.now() < watchedUntil

  const sendGraph = () => {
    clearTimeout(timer)
    timer = 0
    const f = inspect()
    if (!watched() || !f) return
    let graph: any
    try { graph = JSON.parse(JSON.stringify(f({actions: 200}))) } catch (_) { return }
    post({type: 'graph', graph})
  }
  const settle = () => {
    if (!watched()) return
    clearTimeout(timer)
    timer = setTimeout(sendGraph, SETTLE_MS)
  }
  const watch = () => {
    const was = watched()
    watchedUntil = Date.now() + WATCH_MS
    if (!was) sendGraph()
  }

  bc.onmessage = (e: any) => {
    const m = e && e.data
    if (!m || m.v !== 1 || typeof m.type != 'string') return
    if (m.type == 'who') {
      if (m.watch === tab) watch()
      here()
    } else if (m.type == 'get-state' && m.tab === tab) {
      let value: any, error: string | undefined
      try { value = (tools.get_state({component: String(m.id)}, m.req) as any).state } catch (err: any) { error = String(err?.message || err) }
      post({type: 'state', req: m.req, id: m.id, ...(error ? {error} : {value})})
    }
  }

  onAction((a: any, kind) => {
    if (!watched()) return
    if (kind == 'add' && a) post({type: 'action', record: {type: a.type, instance: String(a.instance), component: a.component}})
    settle()
  })
  addLayer(() => ({onCreate: settle, onDispose: settle}))

  const seen = () => { at = Date.now(); here() }
  g.addEventListener?.('focus', seen)
  g.document?.addEventListener?.('visibilitychange', () => { if (g.document.visibilityState == 'visible') seen() })
  g.addEventListener?.('pagehide', () => post({type: 'bye'}))
  here()
}
