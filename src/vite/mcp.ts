/**
 * PLAN-6 E-1: the dev MCP endpoint of sygnal/vite (`sygnal({ mcp: true })`), dev server only.
 *
 * `/__sygnal/mcp` speaks MCP's streamable HTTP transport: JSON-RPC 2.0 over POST, answered as
 * one `application/json` body (no SSE stream: GET and DELETE get 405, which the spec allows;
 * no session ids). Hand-written like sygnal-check's stdio server (no dependency, D209).
 * Methods: initialize, ping, tools/list, tools/call; notifications get 202.
 *
 * Tools that read the page (get_state, dispatch, component_tree, recent_actions,
 * get_diagnostics, copy_as_test, agent_tools) go to an open tab through a PageBridge: in the dev
 * server, Vite's HMR channel (custom events 'sygnal:mcp:*', see src/extra/devMcp.ts), request /
 * response with ids and a timeout. With several tabs the most recently loaded or focused one
 * answers, or the `tab` argument picks one; the result says which (`tab`), and `tabs` lists
 * them. check / graph / explain run sygnal-check's own MCP server in-process when sygnal-check
 * is installed in the project.
 *
 * Security (the endpoint can read and change the running app): requests must come from the
 * loopback interface; the Host header must be localhost, a *.localhost name, a loopback IP or a
 * name in Vite's `server.allowedHosts`; a request with an Origin header must come from a
 * localhost / loopback origin (a web page elsewhere, or a DNS-rebinding page, gets 403).
 */
// @ts-ignore
import fs from 'node:fs'
// @ts-ignore
import path from 'node:path'
// @ts-ignore
import { createRequire } from 'node:module'
// @ts-ignore
import { pathToFileURL } from 'node:url'

export const MCP_PATH = '/__sygnal/mcp'
export const MCP_HELLO = 'sygnal:mcp:hello'
export const MCP_REQUEST = 'sygnal:mcp:request'
export const MCP_RESPONSE = 'sygnal:mcp:response'
/** newest first; the server answers with the client's version when it knows it */
export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 1 << 20

export interface McpPluginOptions {
  /** ms to wait for the page's answer (a confirm dialog extends it to 5 minutes) @default 10000 */
  timeout?: number
  /**
   * Consequential agent tools (`agent.actions.X.consequential`), called with agent_tools:
   * 'page' asks in the page (window.confirm), true runs them, false declines them.
   * @default 'page'
   */
  confirm?: boolean | 'page'
}

export interface TabInfo { id: number; url: string; title: string; active: number }

export interface PageBridge {
  tabs(): TabInfo[]
  request(tab: number, tool: string, args: any, timeout: number): Promise<any>
}

class ToolError extends Error {}

const isObj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v)
const tabSchema = { type: 'integer', description: 'The tab to ask (see tabs); default: the most recently loaded or focused tab' }
const componentSchema = { type: ['string', 'integer'], description: 'A component name, or an instance id (see component_tree); default: the root' }
const obj = (properties: Record<string, any>, required?: string[]) => ({
  type: 'object', properties: { ...properties, tab: tabSchema }, ...(required ? { required } : {}), additionalProperties: false,
})

/** The tools answered by the page */
export const PAGE_TOOLS = [
  {
    name: 'get_state',
    title: 'Get component state',
    description: "The live state of a component instance in the open page (the root by default). With several instances of a component (Collection items) you get each one's id and state. `path` reads one field: 'todos.0.text' or ['todos', 0, 'text'].",
    inputSchema: obj({ component: componentSchema, path: { type: ['string', 'array'], items: { type: ['string', 'integer'] }, description: "A field path: 'a.b.0' or ['a', 'b', 0]" } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'dispatch',
    title: 'Dispatch an action',
    description: "Send an action to a component instance in the open page, as if its intent had produced it (recorded with cause 'agent'), and wait for the render. Returns the instance's new state. The action must be one of the component's model entries (an unknown name lists them).",
    inputSchema: obj({ component: componentSchema, action: { type: 'string', description: "The action name, e.g. 'ADD'" }, data: { description: 'The action data (any JSON value)' } }, ['action']),
  },
  {
    name: 'component_tree',
    title: 'Component tree (inspect)',
    description: "The running app's graph from inspect(): component instances (id, parentId, kind), their actions and what triggers them, state keys, context, EVENTS, children, intent selectors (matched or not) and the runtime diagnostics attached to each. `component` keeps only that component's instances.",
    inputSchema: obj({ component: componentSchema }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'recent_actions',
    title: 'Recent actions',
    description: "The DevTools action log of the open page, newest last: type, data, component, instance, cause ('intent', 'agent', 'reply', ...), the sinks it reached and the state before / after a STATE change.",
    inputSchema: obj({
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'How many (default 20)' },
      component: { type: 'string', description: 'Only this component' },
      type: { type: 'string', description: 'Only this action type' },
      cause: { type: 'string', enum: ['intent', 'next', 'reply', 'built-in', 'simulateAction', 'behavior', 'agent', 'setState'], description: 'Only this cause' },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_diagnostics',
    title: 'Runtime diagnostics',
    description: 'The runtime diagnostics the open page reported (SYG codes): code, severity, component, message, fix and docsUrl, with a summary. Use explain for a code you do not know.',
    inputSchema: obj({
      code: { type: 'string', description: "Only this code, e.g. 'SYG104'" },
      severity: { type: 'string', enum: ['error', 'warn', 'info'] },
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'How many, newest (default 100)' },
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'copy_as_test',
    title: 'Copy session as test',
    description: "DevTools' Copy as test: a Vitest + renderComponent test file that replays what happened to a component instance in the open page (default: the root) and asserts its final state. Returns { code, complete, warnings, replayed }.",
    inputSchema: obj({ component: componentSchema, componentImport: { type: 'string', description: "Where the test imports the component from: a module path ('./App.jsx') or a whole import line" } }),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'agent_tools',
    title: "The app's agent tools",
    description: "The open page's own agent tools (the `agent` statics, sygnal/ai): without `call`, the tools offered now (name, description, inputSchema, annotations) and the readable context; with `call`, runs that tool with `input` under the app's rules (validation, `when`, a consequential tool asks the person in the page first).",
    inputSchema: obj({
      call: { type: 'string', description: 'A tool name from the list' },
      input: { description: 'The tool input' },
      all: { type: 'boolean', description: 'List also the declared tools that are not offered, with why' },
    }),
  },
]

const TABS_TOOL = {
  name: 'tabs',
  title: 'Open pages',
  description: 'The pages of this dev server connected to the endpoint (id, url, title); the page tools use the most recently loaded or focused one unless given `tab`.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
}

/** sygnal-check's MCP server (its `src/mcp.js`), loaded from the project; undefined when missing */
export async function loadCheckServer(root: string): Promise<any> {
  try {
    const main = createRequire(path.join(root, 'package.json')).resolve('sygnal-check')
    const file = path.join(path.dirname(main), 'mcp.js')
    if (!fs.existsSync(file)) return undefined
    const mod = await import(/* @vite-ignore */ pathToFileURL(file).href)
    if (typeof mod.createMcpServer !== 'function' || !Array.isArray(mod.TOOLS)) return undefined
    return { tools: mod.TOOLS, server: mod.createMcpServer({ cwd: root }) }
  } catch (_) {
    return undefined
  }
}

export interface DevMcpServerOptions extends McpPluginOptions {
  bridge: PageBridge
  /** sygnal-check's server: { tools, server: { handle(msg) } } (or a promise of it) */
  check?: any
  version?: string
  /** the dev server's URL, for the "no page open" hint */
  url?: () => string | undefined
}

/** The JSON-RPC side of the endpoint (transport-free; tests drive it directly) */
export function createDevMcpServer(o: DevMcpServerOptions) {
  const timeout = o.timeout && o.timeout > 0 ? o.timeout : 10000
  const result = (id: any, value: any) => ({ jsonrpc: '2.0', id, result: value })
  const error = (id: any, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })
  let check: any
  const getCheck = async () => (check === undefined ? (check = (await o.check) || null) : check)

  const pickTab = (want: any): { tab: TabInfo; note?: string } => {
    const tabs = o.bridge.tabs()
    if (!tabs.length) {
      const url = o.url?.()
      throw new ToolError(`no page is connected: open the app${url ? ` (${url})` : ''} in a browser, with the dev server running`)
    }
    if (want !== undefined && want !== null) {
      const tab = tabs.find(t => t.id === Number(want))
      if (!tab) throw new ToolError(`no tab ${want}; open tabs: ${tabs.map(t => `${t.id} ${t.url}`).join(', ')}`)
      return { tab }
    }
    const tab = tabs.reduce((a, b) => (b.active > a.active ? b : a))
    return { tab, note: tabs.length > 1 ? `${tabs.length} tabs are open; used tab ${tab.id} (the most recently loaded or focused). Pass tab to choose one (see tabs).` : undefined }
  }

  const content = (value: any, isError = false) => {
    const structured = isObj(value) ? value : { value }
    return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured, isError }
  }

  async function callTool(name: string, args: any) {
    if (name === 'tabs') return content({ tabs: o.bridge.tabs().map(({ id, url, title }) => ({ id, url, title })) })
    const { tab: want, ...rest } = args
    const { tab, note } = pickTab(want)
    const value = await o.bridge.request(tab.id, name, rest, timeout)
    const out = isObj(value) ? value : { value }
    return content({ ...out, tab: { id: tab.id, url: tab.url, title: tab.title }, ...(note ? { tabNote: note } : {}) })
  }

  async function handleMessage(msg: any): Promise<any> {
    if (!isObj(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return isObj(msg) && 'id' in msg && !('result' in msg || 'error' in msg) ? error(msg.id ?? null, -32600, 'Invalid Request') : null
    }
    if (!('id' in msg) || msg.id === null) return null // a notification
    const { id, method } = msg
    const params = isObj(msg.params) ? msg.params : {}
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion
        return result(id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'sygnal-dev', title: 'Sygnal dev server', version: o.version || '0.0.0' },
          instructions: 'The running Sygnal app in the dev server\'s open page: component_tree to orient, get_state / recent_actions / get_diagnostics to read, dispatch or agent_tools to act, copy_as_test to turn a session into a test. check, graph and explain (when present) are sygnal-check on the sources.',
        })
      }
      case 'ping':
        return result(id, {})
      case 'tools/list': {
        const c = await getCheck()
        return result(id, { tools: [...PAGE_TOOLS, TABS_TOOL, ...(c ? c.tools : [])] })
      }
      case 'tools/call': {
        const name = params.name
        const args = isObj(params.arguments) ? params.arguments : {}
        if (name === 'tabs' || PAGE_TOOLS.some(t => t.name === name)) {
          try {
            return result(id, await callTool(name, args))
          } catch (err: any) {
            return result(id, { content: [{ type: 'text', text: err instanceof ToolError ? err.message : `${name} failed: ${err?.message || err}` }], isError: true })
          }
        }
        const c = await getCheck()
        if (c && c.tools.some((t: any) => t.name === name)) return { ...c.server.handle({ ...msg, params: { ...params, arguments: args } }), id }
        return error(id, -32602, `Unknown tool: ${name}`)
      }
      default:
        return error(id, -32601, `Method not found: ${method}`)
    }
  }

  /** One message (or a batch); never throws */
  async function handle(msg: any): Promise<any> {
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map(handle))).filter(Boolean)
      return out.length ? out : null
    }
    try {
      return await handleMessage(msg)
    } catch (err: any) {
      return error(isObj(msg) && 'id' in msg ? msg.id ?? null : null, -32603, `Internal error: ${err?.message || err}`)
    }
  }

  return { handle }
}

// ---------------------------------------------------------------- security

const LOOPBACK_IP = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/

/** The host part of a Host header value or URL host ('[::1]:5173' → '::1') */
function hostname(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined)
  const i = h.lastIndexOf(':')
  return i > 0 && h.indexOf(':') === i ? h.slice(0, i) : h
}

const isLocalName = (h: string) => h === 'localhost' || h.endsWith('.localhost') || LOOPBACK_IP.test(h)

/** Vite's allowedHosts entries: 'example.test', or '.example.test' for it and its subdomains */
function inAllowed(h: string, allowed: any): boolean {
  if (!Array.isArray(allowed)) return false
  return allowed.some((a: any) => {
    if (typeof a !== 'string' || !a) return false
    const e = a.toLowerCase()
    return e.startsWith('.') ? h === e.slice(1) || h.endsWith(e) : h === e
  })
}

/** Why the request is refused (403), or null */
export function refusal(req: any, allowedHosts?: any): string | null {
  const remote = String(req?.socket?.remoteAddress || '')
  if (!LOOPBACK_IP.test(remote)) return `the Sygnal MCP endpoint only answers requests from this machine (not ${remote || 'an unknown address'})`
  const host = req?.headers?.host
  if (typeof host !== 'string' || !host) return 'missing Host header'
  const h = hostname(host)
  if (!isLocalName(h) && !inAllowed(h, allowedHosts)) return `Host ${host} is not a local name (add it to server.allowedHosts to allow it)`
  const origin = req?.headers?.origin
  if (origin !== undefined && origin !== 'null') {
    let oh = ''
    try { oh = new URL(String(origin)).hostname.replace(/^\[|\]$/g, '').toLowerCase() } catch (_) {}
    if (!oh || (!isLocalName(oh) && !inAllowed(oh, allowedHosts))) return `Origin ${origin} is not allowed`
  } else if (origin === 'null') {
    return 'Origin null is not allowed'
  }
  return null
}

// ---------------------------------------------------------------- HTTP

function send(res: any, status: number, body?: any, headers: Record<string, string> = {}) {
  res.statusCode = status
  for (const k in headers) res.setHeader(k, headers[k])
  if (body === undefined) return res.end()
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: any[] = []
    req.on('data', (c: any) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy?.() } else chunks.push(c)
    })
    req.on('end', () => resolve((globalThis as any).Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** The connect middleware for MCP_PATH */
export function mcpMiddleware(server: { handle(msg: any): Promise<any> }, allowedHosts: () => any) {
  return async (req: any, res: any, next: any) => {
    const url = String(req.url || '').replace(/[?#].*$/, '')
    if (url !== MCP_PATH && url !== MCP_PATH + '/') return next()
    const why = refusal(req, allowedHosts())
    if (why) return send(res, 403, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `Forbidden: ${why}` } })
    if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed: this endpoint takes JSON-RPC over POST (no SSE stream)' } }, { Allow: 'POST' })
    const version = req.headers['mcp-protocol-version']
    if (version !== undefined && !SUPPORTED_VERSIONS.includes(String(version))) {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32000, message: `Unsupported MCP-Protocol-Version ${version}; supported: ${SUPPORTED_VERSIONS.join(', ')}` } })
    }
    let msg: any
    try {
      msg = JSON.parse(await readBody(req))
    } catch (err: any) {
      if (err?.message === 'too large') return send(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } })
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    }
    const out = await server.handle(msg)
    if (out === null || out === undefined) return send(res, 202)
    send(res, 200, out)
  }
}

// ---------------------------------------------------------------- the page bridge (Vite's HMR channel)

/** A PageBridge over the dev server's HMR channel (server.ws / environments.client.hot) */
export function hmrBridge(server: any): PageBridge {
  const ws = server?.ws || server?.environments?.client?.hot
  const tabs = new Map<any, TabInfo>()
  const pending = new Map<number, { tab: number; resolve: (v: any) => void; reject: (e: any) => void; timer: any; client: any }>()
  let nextTab = 1
  let nextReq = 1
  let clock = 0
  const fail = (client: any) => {
    const t = tabs.get(client)
    tabs.delete(client)
    if (!t) return
    for (const [id, p] of pending) {
      if (p.client !== client) continue
      clearTimeout(p.timer)
      pending.delete(id)
      p.reject(new ToolError(`tab ${t.id} closed before it answered`))
    }
  }
  if (ws && typeof ws.on === 'function') {
    ws.on(MCP_HELLO, (data: any, client: any) => {
      if (!client) return
      let t = tabs.get(client)
      if (!t) {
        tabs.set(client, t = { id: nextTab++, url: '', title: '', active: 0 })
        // Vite's socket client carries its WebSocket: a closed tab leaves at once
        try { client.socket?.once?.('close', () => fail(client)) } catch (_) {}
      }
      t.url = String(data?.url || '')
      t.title = String(data?.title || '')
      t.active = ++clock
    })
    ws.on(MCP_RESPONSE, (data: any, client: any) => {
      const p = data && pending.get(data.id)
      if (!p || p.client !== client) return
      if (data.waiting) {
        clearTimeout(p.timer)
        p.timer = setTimeout(() => expire(data.id), 5 * 60_000)
        return
      }
      clearTimeout(p.timer)
      pending.delete(data.id)
      if (data.ok) p.resolve(data.result)
      else p.reject(new ToolError(String(data.error || 'the page reported an error')))
    })
  }
  /** tabs whose socket is still open (when the channel tells) */
  const live = () => {
    let open: any
    try { open = ws?.clients } catch (_) {}
    for (const c of [...tabs.keys()]) {
      const closed = c.socket && typeof c.socket.readyState === 'number' && c.socket.readyState > 1
      if (closed || (open instanceof Set && c.socket && !open.has(c))) fail(c)
    }
    return tabs
  }
  function expire(id: number) {
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    p.reject(new ToolError(`tab ${p.tab} did not answer in time (is the page frozen, or a dialog open?)`))
  }
  return {
    tabs: () => [...live().values()].map(t => ({ ...t })),
    request(tabId, tool, args, ms) {
      const client = [...live().entries()].find(([, t]) => t.id === tabId)?.[0]
      if (!client) return Promise.reject(new ToolError(`no tab ${tabId}`))
      const id = nextReq++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => expire(id), ms)
        pending.set(id, { tab: tabId, resolve, reject, timer, client })
        try {
          client.send({ type: 'custom', event: MCP_REQUEST, data: { id, tool, args } })
        } catch (err: any) {
          clearTimeout(timer)
          pending.delete(id)
          fail(client)
          reject(new ToolError(`tab ${tabId} is gone: ${err?.message || err}`))
        }
      })
    },
  }
}

/** Wire the endpoint into a Vite dev server */
export function attachMcp(server: any, root: string, options: McpPluginOptions, version: string | undefined) {
  const bridge = hmrBridge(server)
  const mcp = createDevMcpServer({
    ...options,
    bridge,
    version,
    check: loadCheckServer(root),
    url: () => server?.resolvedUrls?.local?.[0],
  })
  server.middlewares.use(mcpMiddleware(mcp, () => server?.config?.server?.allowedHosts))
  return mcp
}

/** 'virtual:sygnal/mcp': connects the page (dev only) */
export function mcpClientModule(options: McpPluginOptions): string {
  const confirm = options.confirm === undefined ? 'page' : options.confirm
  return `import { agentTools } from 'sygnal';
import { installMcpBridge } from 'sygnal/devtools';
if (import.meta.hot) installMcpBridge(import.meta.hot, { agentTools, confirm: ${JSON.stringify(confirm)} });
`
}
