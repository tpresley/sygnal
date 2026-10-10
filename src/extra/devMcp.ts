/**
 * PLAN-6 E-1: the page side of the dev MCP endpoint (`sygnal({ mcp: true })` in sygnal/vite).
 * Dev only: it is part of the 'sygnal/devtools' entry, and sygnal/vite's 'virtual:sygnal/mcp'
 * module (served by the dev server, never in a build) calls installMcpBridge(import.meta.hot).
 *
 * The protocol, over Vite's HMR channel (custom events):
 *   page → server  'sygnal:mcp:hello'     { url, title, focused, apps, update? }   on load, focus,
 *                                         when shown, and (update: true) when the apps change
 *   server → page  'sygnal:mcp:request'   { id, tool, args }
 *   page → server  'sygnal:mcp:response'  { id, ok: true, result } | { id, ok: false, error }
 *                                         | { id, waiting: true }   (a confirm dialog is open:
 *                                           the server waits longer)
 *
 * The tools read the page's apps through their runtime APIs, the DevTools bridge (diagnostics,
 * action log, copy as test), the diagnostics core's inspect(), and the A-1 agent layer
 * (agentTools, passed in by the virtual module from the app's own 'sygnal', so there is one core).
 *
 * G-638: every run() of the page is served. The bridge registers a dev hook layer
 * (`__SYGNAL_DIAGNOSTICS__.layers`, read by each app at its start: no core bytes), so it sees each
 * app's runtime API in start order; an HMR successor (disposed and started in the same tick)
 * keeps its predecessor's place. `app` (an index, or the root component's name) picks one; the
 * default is the first. An app started before the bridge was installed is still found through
 * window.__SYGNAL_DEVTOOLS_APP__. The hello carries the apps ({ index, component }) and is sent
 * again (`update: true`, not a focus) when they change.
 */
import {getDevTools} from './devtools'
import {getActions, getSession, preview} from './devtoolsActions'
import {sessionToTest} from './copyAsTest'
import {addLayer} from './devtoolsNext'

export const MCP_HELLO = 'sygnal:mcp:hello'
export const MCP_REQUEST = 'sygnal:mcp:request'
export const MCP_RESPONSE = 'sygnal:mcp:response'

export interface McpBridgeOptions {
  /** agentTools from 'sygnal' (the app's core) */
  agentTools?: (target: any, options?: any) => any
  /**
   * Consequential agent tools (A-1 `consequential: true`): 'page' asks in the page with
   * window.confirm() (default), true runs them, false declines them.
   */
  confirm?: boolean | 'page'
  /** the app to serve, alone (default: every run() of the page) */
  app?: () => any
}

interface Hot {
  on(event: string, cb: (data: any) => void): void
  send(event: string, data?: any): void
}

class ToolError extends Error {}

const g: any = globalThis

/** JSON-safe copy (functions, DOM nodes, cycles, Maps, Sets described) */
const plain = (v: any) => (v === undefined ? null : preview(v))

// ---------------------------------------------------------------- the page's apps (G-638)

/** runtime APIs of the apps started since the bridge was installed, in start order */
const started: any[] = []
let gone = -1
let tracking = false
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(f => { try { f() } catch (_) {} })
const alive = (api: any) => {
  try { const r = api?.root; return !!r && !r.disposed } catch (_) { return false }
}

/** the dev hook layer: each app's runtime API at its start; its root's dispose ends it */
function appLayer(api: any) {
  // an HMR swap (or any app started in the tick its predecessor ended) takes the same place
  if (gone >= 0 && gone < started.length && !alive(started[gone])) started[gone] = api
  else started.push(api)
  gone = -1
  changed()
  return {
    onDispose(iv: any) {
      if (!iv?.isRoot) return
      const i = started.indexOf(api)
      if (i < 0) return
      gone = i
      queueMicrotask(() => {
        if (gone === i) gone = -1
        const j = started.indexOf(api)
        if (j >= 0) started.splice(j, 1)
        changed()
      })
    },
  }
}

function trackApps() {
  if (tracking) return
  tracking = true
  addLayer(appLayer)
}

interface AppRef { api: any; target: any }

/** the live apps of the page, the first app first */
export function pageApps(o: McpBridgeOptions = {}): AppRef[] {
  if (o.app) {
    const app = o.app()
    return app?.__runtime && alive(app.__runtime) ? [{api: app.__runtime, target: app}] : []
  }
  // each runtime.api() is a new object: an app is known by its root instance (ids are page-unique)
  const first = g.window?.__SYGNAL_DEVTOOLS_APP__
  const firstRoot = first?.__runtime && alive(first.__runtime) ? first.__runtime.root.id : undefined
  const ref = (api: any): AppRef => ({api, target: firstRoot !== undefined && api.root.id === firstRoot ? first : api})
  const out = started.filter(alive).map(ref)
  if (firstRoot !== undefined && !out.some(a => a.api.root.id === firstRoot)) out.unshift({api: first.__runtime, target: first})
  return out
}

const appSummary = (a: AppRef, index: number) => {
  let component = '?'
  try { component = a.api.root.name } catch (_) {}
  return {index, component}
}

const appsLine = (apps: AppRef[]) => apps.map((a, i) => `${i} ${appSummary(a, i).component}`).join(', ')

/** the app `want` names (an index, or the root component's name); the first when omitted */
function pickApp(o: McpBridgeOptions, want: any): AppRef {
  const apps = pageApps(o)
  if (!apps.length) throw new ToolError('no Sygnal app is running on this page (run() has not been called, or the app was disposed)')
  if (want === undefined || want === null || want === '') return apps[0]
  if (typeof want == 'number' || /^\d+$/.test(String(want))) {
    const a = apps[Number(want)]
    if (!a) throw new ToolError(`no app ${want}; apps: ${appsLine(apps)}`)
    return a
  }
  const named = apps.filter(a => { try { return a.api.root.name === want } catch (_) { return false } })
  if (!named.length) throw new ToolError(`no app ${JSON.stringify(want)}; apps: ${appsLine(apps)}`)
  if (named.length > 1) throw new ToolError(`${named.length} apps have the root ${want}; pass an index (apps: ${appsLine(apps)})`)
  return named[0]
}

/**
 * The runtime API to use: `app`'s; without `app`, the first app, unless `component` (a name or
 * an instance id; ids are unique on the page) is only in another one
 */
function runtimeFor(o: McpBridgeOptions, args: any): any {
  const c = args.component
  const first = pickApp(o, args.app).api
  if ((args.app !== undefined && args.app !== null) || c === undefined || c === null || c === '' || find(first, c).length) return first
  const owners = pageApps(o).filter(a => { try { return find(a.api, c).length > 0 } catch (_) { return false } })
  return owners.length == 1 ? owners[0].api : first
}

/** every instance of the app, root first (depth-first) */
function allInstances(rt: any): any[] {
  const out: any[] = []
  const walk = (iv: any) => {
    if (!iv) return
    out.push(iv)
    for (const c of iv.children?.() || []) walk(c)
  }
  walk(rt.root)
  return out
}

/** The instances `component` names: a component name, or an instance id (number or digits); root when omitted */
function find(rt: any, component: any): any[] {
  if (component === undefined || component === null || component === '') return rt.root ? [rt.root] : []
  const all = allInstances(rt)
  if (typeof component == 'number' || /^\d+$/.test(String(component))) {
    const iv = all.find(i => String(i.id) === String(component))
    return iv ? [iv] : []
  }
  return all.filter(i => i.name === component)
}

function names(rt: any): string {
  return [...new Set(allInstances(rt).map(i => i.name))].join(', ')
}

function one(rt: any, component: any, verb: string): any {
  const found = find(rt, component)
  if (!found.length) throw new ToolError(`no component ${JSON.stringify(component)} is shown now; components: ${names(rt) || 'none'}`)
  if (found.length > 1) {
    throw new ToolError(`${found.length} instances of ${component} are shown (ids ${found.map(i => i.id).join(', ')}); pass one id as component to ${verb} one`)
  }
  return found[0]
}

function at(value: any, path: any): any {
  if (path === undefined || path === null || path === '') return value
  const parts = Array.isArray(path) ? path.map(String) : String(path).split('.').filter(Boolean)
  let v = value
  for (const p of parts) {
    if (v === null || v === undefined || typeof v != 'object') throw new ToolError(`state has no ${parts.join('.')} (stopped at ${p})`)
    v = v instanceof Map ? v.get(p) : v[p]
  }
  return v
}

const stateOf = (iv: any) => ({component: iv.name, id: iv.id, ...(iv.kind == 'item' ? {item: true} : {}), state: plain(iv.state)})

function actionNames(iv: any): string[] {
  const def = iv.def || {}
  const out = def.handlers instanceof Map ? [...def.handlers.keys()] : []
  const b = def.behaviorActions
  if (b && typeof b == 'object') out.push(...(b instanceof Map ? [...b.keys()] : Object.keys(b)))
  return [...new Set(out.map(String))]
}

const serializeAction = (a: any) => ({
  seq: a.seq, type: a.type, data: preview(a.data), component: a.component, instance: a.instance, parent: a.parent,
  sinks: [...a.sinks], cause: a.cause, at: a.at,
  ...('after' in a ? {before: plain(a.before), after: plain(a.after)} : {}),
})

/** The tool implementations; `id` is the request id (for the confirm notice). Exported for tests. */
export function pageTools(o: McpBridgeOptions, notifyWaiting: (id: any) => void = () => {}) {
  const agents = new WeakMap<object, any>()
  const agentsOf = (target: any) => {
    if (typeof o.agentTools != 'function') throw new ToolError('the agent layer is not available (agentTools from sygnal/ai)')
    let t = agents.get(target)
    if (!t) agents.set(target, t = o.agentTools(target))
    return t
  }
  const confirmFor = (id: any) => {
    const c = o.confirm === undefined ? 'page' : o.confirm
    if (c !== 'page') return !!c
    return async (info: any) => {
      if (typeof g.window?.confirm != 'function') return false
      notifyWaiting(id)
      // let the notice leave before the dialog blocks the page
      await new Promise(r => setTimeout(r, 30))
      const input = info.input === undefined ? '' : `\n\nInput: ${JSON.stringify(info.input)}`
      return !!g.window.confirm(`An agent (MCP, sygnal dev server) wants to run "${info.tool}" on ${info.component}${info.label ? ` (${info.label})` : ''}: ${info.description}${input}\n\nAllow it?`)
    }
  }

  const tools: Record<string, (args: any, id: any) => any> = {
    apps() {
      return {apps: pageApps(o).map((a, i) => {
        let id, instances = 0
        try { id = a.api.root.id; instances = allInstances(a.api).length } catch (_) {}
        return {...appSummary(a, i), id, instances, ...(i === 0 ? {default: true} : {})}
      })}
    },

    get_state(args) {
      const rt = runtimeFor(o, args)
      const found = find(rt, args.component)
      if (!found.length) throw new ToolError(`no component ${JSON.stringify(args.component)} is shown now; components: ${names(rt) || 'none'}`)
      const withPath = (iv: any) => {
        const s = stateOf(iv)
        if (args.path === undefined) return s
        return {...s, path: args.path, state: plain(at(iv.state, args.path))}
      }
      if (found.length == 1) return withPath(found[0])
      return {component: args.component, instances: found.map(withPath)}
    },

    async dispatch(args) {
      if (typeof args.action != 'string' || !args.action) throw new ToolError('dispatch needs action: the action name, e.g. "ADD"')
      const rt = runtimeFor(o, args)
      const iv = one(rt, args.component, 'dispatch to')
      const known = actionNames(iv)
      if (!known.includes(args.action) && !args.action.includes('.')) {
        throw new ToolError(`${iv.name} has no action ${args.action}; its actions: ${known.join(', ') || 'none'}`)
      }
      const before = iv.state
      rt.dispatch(iv.id, args.action, args.data, 'agent')
      await rt.flushed()
      const after = iv.disposed ? undefined : iv.state
      return {ok: true, component: iv.name, id: iv.id, action: args.action, changed: after !== before, ...(iv.disposed ? {disposed: true} : {state: plain(after)})}
    },

    component_tree(args) {
      // every app's instances, unless `app` names one
      const app = pickApp(o, args.app)
      const inspect = g.__SYGNAL_DIAGNOSTICS__?.inspect || (getDevTools() as any).inspect
      if (typeof inspect != 'function') {
        throw new ToolError("component_tree needs the runtime diagnostics ('sygnal/diagnostics'), which sygnal({ diagnostics: 'off' }) leaves out")
      }
      const graph = inspect()
      if (!graph || !Array.isArray(graph.components)) return graph
      let keep = graph.components
      if (args.app !== undefined && args.app !== null) {
        const ids = new Set(allInstances(app.api).map((i: any) => String(i.id)))
        keep = keep.filter((c: any) => ids.has(String(c.id)))
      }
      if (args.component) keep = keep.filter((c: any) => c.name === args.component || String(c.id) === String(args.component))
      return keep === graph.components ? graph : {...graph, components: keep}
    },

    recent_actions(args) {
      const limit = Math.max(1, Math.min(500, Number(args.limit) || 20))
      const filter: any = {}
      if (args.component) filter.component = String(args.component)
      if (args.type) filter.type = String(args.type)
      if (args.cause) filter.cause = args.cause
      const all = getActions(Object.keys(filter).length ? filter : undefined)
      return {total: all.length, actions: all.slice(-limit).map(serializeAction)}
    },

    get_diagnostics(args) {
      let list: any[] = getDevTools().getDiagnostics() || []
      if (args.code) list = list.filter(d => d.code === String(args.code).toUpperCase())
      if (args.severity) list = list.filter(d => d.severity === args.severity)
      const count = (s: string) => list.filter(d => d.severity === s).length
      const limit = Math.max(1, Math.min(500, Number(args.limit) || 100))
      return {
        summary: {error: count('error'), warn: count('warn'), info: count('info')},
        diagnostics: list.slice(-limit).map(d => ({
          code: d.code, severity: d.severity, component: d.component, message: d.message,
          ...(d.fix ? {fix: d.fix} : {}), docsUrl: d.docsUrl, ...(d.data !== undefined ? {data: plain(d.data)} : {}),
        })),
      }
    },

    copy_as_test(args) {
      // the default app's root by default (the DevTools default would be the newest root)
      const target = String(one(runtimeFor(o, args), args.component, 'copy').id)
      try {
        const rec = getSession(target)
        // a module path ('./App.jsx') or a whole import line
        const ci = args.componentImport === undefined ? '' : String(args.componentImport)
        const componentImport = !ci ? undefined : /^\s*import\s/.test(ci) ? ci : `import ${rec.component} from '${ci.replace(/'/g, "\\'")}'`
        return sessionToTest(rec, componentImport ? {componentImport} : {})
      } catch (e: any) {
        throw new ToolError(String(e?.message || e))
      }
    },

    async agent_tools(args, id) {
      const t = agentsOf(pickApp(o, args.app).target)
      if (args.call === undefined) return {tools: t.list(args.all ? {all: true} : undefined), context: plain(t.context())}
      if (typeof args.call != 'string') throw new ToolError('call must be a tool name (see agent_tools without call)')
      const result = await t.call(args.call, args.input, {confirm: confirmFor(id)})
      return plain(result)
    },
  }
  return tools
}

let installed: Hot | null = null

/**
 * Connect this page to the dev server's MCP endpoint (sygnal/vite with `mcp: true` calls it from
 * 'virtual:sygnal/mcp'). Once per page; no-op without a hot channel.
 */
export function installMcpBridge(hot: Hot | undefined, options: McpBridgeOptions = {}): void {
  if (!hot || installed === hot) return
  installed = hot
  if (!options.app) trackApps()
  const tools = pageTools(options, (id) => hot.send(MCP_RESPONSE, {id, waiting: true}))
  const hello = (update?: boolean) => {
    const d = g.document
    let apps: any[] = []
    try { apps = pageApps(options).map(appSummary) } catch (_) {}
    hot.send(MCP_HELLO, {url: String(g.location?.href || ''), title: String(d?.title || ''), focused: !!d?.hasFocus?.(), apps, ...(update ? {update: true} : {})})
  }
  // the apps changed: tell the server after the tick (when the new roots exist)
  let queued = false
  listeners.add(() => {
    if (queued) return
    queued = true
    setTimeout(() => { queued = false; hello(true) }, 0)
  })
  hot.on(MCP_REQUEST, async (msg: any) => {
    if (!msg || msg.id === undefined) return
    const fn = Object.prototype.hasOwnProperty.call(tools, msg.tool) ? tools[msg.tool] : undefined
    try {
      if (!fn) throw new ToolError(`unknown page tool ${msg.tool}`)
      const args = msg.args && typeof msg.args == 'object' && !Array.isArray(msg.args) ? msg.args : {}
      const result = await fn(args, msg.id)
      hot.send(MCP_RESPONSE, {id: msg.id, ok: true, result: result === undefined ? null : result})
    } catch (e: any) {
      hot.send(MCP_RESPONSE, {id: msg.id, ok: false, error: e instanceof ToolError ? e.message : `${msg.tool} failed: ${e?.message || e}`})
    }
  })
  // the server answers this after a reconnect too (a restarted dev server)
  hot.on('vite:ws:connect', () => hello())
  hello()
  if (typeof g.addEventListener == 'function') {
    g.addEventListener('focus', () => hello())
    g.document?.addEventListener?.('visibilitychange', () => { if (g.document.visibilityState == 'visible') hello() })
  }
}
