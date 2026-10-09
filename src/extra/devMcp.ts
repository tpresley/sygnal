/**
 * PLAN-6 E-1: the page side of the dev MCP endpoint (`sygnal({ mcp: true })` in sygnal/vite).
 * Dev only: it is part of the 'sygnal/devtools' entry, and sygnal/vite's 'virtual:sygnal/mcp'
 * module (served by the dev server, never in a build) calls installMcpBridge(import.meta.hot).
 *
 * The protocol, over Vite's HMR channel (custom events):
 *   page → server  'sygnal:mcp:hello'     { url, title, focused }   on load, focus and when shown
 *   server → page  'sygnal:mcp:request'   { id, tool, args }
 *   page → server  'sygnal:mcp:response'  { id, ok: true, result } | { id, ok: false, error }
 *                                         | { id, waiting: true }   (a confirm dialog is open:
 *                                           the server waits longer)
 *
 * The tools read the app that registered itself as window.__SYGNAL_DEVTOOLS_APP__ (the first
 * run() of the page) through its runtime API, the DevTools bridge (diagnostics, action log,
 * copy as test), the diagnostics core's inspect(), and the A-1 agent layer (agentTools, passed
 * in by the virtual module from the app's own 'sygnal', so there is one core).
 */
import {getDevTools} from './devtools'
import {getActions, getSession, preview} from './devtoolsActions'
import {sessionToTest} from './copyAsTest'

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
  /** the app (default: window.__SYGNAL_DEVTOOLS_APP__) */
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

function currentApp(o: McpBridgeOptions): any {
  const app = o.app ? o.app() : g.window?.__SYGNAL_DEVTOOLS_APP__
  if (!app || !app.__runtime) throw new ToolError('no Sygnal app is running on this page (run() has not been called, or the app was disposed)')
  return app
}

/** every instance of the app, root first (depth-first) */
function instances(rt: any): any[] {
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
  const all = instances(rt)
  if (typeof component == 'number' || /^\d+$/.test(String(component))) {
    const iv = all.find(i => String(i.id) === String(component))
    return iv ? [iv] : []
  }
  return all.filter(i => i.name === component)
}

function names(rt: any): string {
  return [...new Set(instances(rt).map(i => i.name))].join(', ')
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
  const agentsOf = (app: any) => {
    if (typeof o.agentTools != 'function') throw new ToolError('the agent layer is not available (agentTools from sygnal/ai)')
    let t = agents.get(app)
    if (!t) agents.set(app, t = o.agentTools(app))
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
    get_state(args) {
      const rt = currentApp(o).__runtime
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
      const rt = currentApp(o).__runtime
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
      currentApp(o)
      const inspect = g.__SYGNAL_DIAGNOSTICS__?.inspect || (getDevTools() as any).inspect
      if (typeof inspect != 'function') {
        throw new ToolError("component_tree needs the runtime diagnostics ('sygnal/diagnostics'), which sygnal({ diagnostics: 'off' }) leaves out")
      }
      const graph = inspect()
      if (args.component && graph && Array.isArray(graph.components)) {
        const keep = graph.components.filter((c: any) => c.name === args.component || String(c.id) === String(args.component))
        return {...graph, components: keep}
      }
      return graph
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
      let target: any
      if (args.component !== undefined) {
        const rt = currentApp(o).__runtime
        target = String(one(rt, args.component, 'copy').id)
      }
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
      const t = agentsOf(currentApp(o))
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
  const tools = pageTools(options, (id) => hot.send(MCP_RESPONSE, {id, waiting: true}))
  const hello = () => {
    const d = g.document
    hot.send(MCP_HELLO, {url: String(g.location?.href || ''), title: String(d?.title || ''), focused: !!d?.hasFocus?.()})
  }
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
  hot.on('vite:ws:connect', hello)
  hello()
  if (typeof g.addEventListener == 'function') {
    g.addEventListener('focus', hello)
    g.document?.addEventListener?.('visibilitychange', () => { if (g.document.visibilityState == 'visible') hello() })
  }
}
