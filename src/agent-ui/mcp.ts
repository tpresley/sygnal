/**
 * sygnal/agent-ui: a minimal Model Context Protocol server (tools only), as sygnal-check's
 * (sygnal-check/src/mcp.js) and sygnal/vite's dev endpoint (src/vite/mcp.ts): hand-rolled, no
 * dependency, both protocol eras answered per request.
 *
 * - legacy, the `initialize` revisions (2024-11-05 … 2025-11-25): initialize, ping, tools/list,
 *   tools/call; JSON-RPC batches answered. tools.listChanged is true: the tool set can change
 *   when extra tools (sygnal/ai agentTools) do, and notifications/tools/list_changed is sent.
 * - modern, the stateless 2026-07-28 revision (`_meta['io.modelcontextprotocol/protocolVersion']`
 *   with client capabilities): server/discover, tools/list, tools/call; results carry
 *   `resultType: 'complete'` and the server info in `_meta`.
 * Transport: newline-delimited JSON over any stream pair with `on('data')` and `write()` (Node's
 * stdin / stdout); messages are handled one at a time, in order.
 */
export const MODERN_VERSIONS = ['2026-07-28']
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const SUPPORTED = [...MODERN_VERSIONS, ...LEGACY_VERSIONS]
const META = 'io.modelcontextprotocol/'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, any>
  annotations?: Record<string, any>
}
export interface McpToolResult {
  /** the text the model reads */
  text: string
  /** structured content (an object) */
  value?: Record<string, any>
  isError?: boolean
}
export interface McpServerSpec {
  name: string
  version: string
  instructions?: string
  tools(): McpTool[]
  call(name: string, args: Record<string, any>): Promise<McpToolResult>
}

const isObj = (v: any): v is Record<string, any> => !!v && typeof v == 'object' && !Array.isArray(v)

export function createMcpHandler(spec: McpServerSpec) {
  const serverInfo = {name: spec.name, version: spec.version}
  const result = (id: any, value: any) => ({jsonrpc: '2.0', id, result: value})
  const error = (id: any, code: number, message: string, data?: any) => ({jsonrpc: '2.0', id, error: {code, message, ...(data !== undefined ? {data} : {})}})

  async function route(id: any, method: string, params: Record<string, any>, modern: boolean): Promise<any> {
    if (modern && (method == 'initialize' || method == 'ping')) return error(id, -32601, `Method not found: ${method} is not in 2026-07-28`)
    switch (method) {
      case 'initialize':
        return result(id, {
          protocolVersion: LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : LEGACY_VERSIONS[0],
          capabilities: {tools: {listChanged: true}},
          serverInfo,
          ...(spec.instructions ? {instructions: spec.instructions} : {}),
        })
      case 'server/discover':
        if (!modern) return error(id, -32602, 'Invalid params: server/discover is a 2026-07-28 request')
        return result(id, {supportedVersions: SUPPORTED, capabilities: {tools: {}}, ...(spec.instructions ? {instructions: spec.instructions} : {})})
      case 'ping':
        return result(id, {})
      case 'tools/list':
        return result(id, {tools: spec.tools()})
      case 'tools/call': {
        const name = params.name
        if (!spec.tools().some(t => t.name == name)) return error(id, -32602, `Unknown tool: ${name}`)
        try {
          const r = await spec.call(name, isObj(params.arguments) ? params.arguments : {})
          return result(id, {content: [{type: 'text', text: r.text}], ...(r.value ? {structuredContent: r.value} : {}), isError: !!r.isError})
        } catch (e: any) {
          return result(id, {content: [{type: 'text', text: `${name} failed: ${e?.message || e}`}], isError: true})
        }
      }
      default:
        return error(id, -32601, `Method not found: ${method}`)
    }
  }

  /** one message → its response (null for a notification); never throws */
  async function handle(msg: any, inBatch = false): Promise<any> {
    try {
      if (!isObj(msg) || msg.jsonrpc !== '2.0' || typeof msg.method != 'string') {
        return isObj(msg) && 'id' in msg && !('result' in msg || 'error' in msg) ? error(msg.id ?? null, -32600, 'Invalid Request') : null
      }
      if (!('id' in msg) || msg.id === null) return null
      const {id, method} = msg
      const params = isObj(msg.params) ? msg.params : {}
      const meta = isObj(params._meta) ? params._meta : {}
      let modern = false
      if (META + 'protocolVersion' in meta) {
        const v = meta[META + 'protocolVersion']
        if (!SUPPORTED.includes(v)) return error(id, -32022, 'Unsupported protocol version', {supported: SUPPORTED, requested: v})
        if (MODERN_VERSIONS.includes(v)) {
          if (!isObj(meta[META + 'clientCapabilities'])) return error(id, -32602, `Invalid params: _meta["${META}clientCapabilities"] is required`)
          if (inBatch) return error(id, -32600, 'Invalid Request: 2026-07-28 messages are sent one per line, not in a batch')
          modern = true
        }
      }
      const out = await route(id, method, params, modern)
      if (modern && isObj(out.result)) out.result = {resultType: 'complete', ...out.result, _meta: {...(out.result._meta || {}), [META + 'serverInfo']: serverInfo}}
      return out
    } catch (e: any) {
      return error(isObj(msg) ? msg.id ?? null : null, -32603, `Internal error: ${e?.message || e}`)
    }
  }
  return {handle}
}

export interface McpStdio {
  /** notifications/tools/list_changed to the client */
  listChanged(): void
  /** stop reading */
  stop(): void
  /** resolves when the input ends */
  done: Promise<void>
}

/** serve over a newline-delimited JSON stream pair (default: process.stdin / process.stdout) */
export function serveMcpStream(spec: McpServerSpec, input?: any, output?: any): McpStdio {
  const proc: any = (globalThis as any).process
  input ||= proc?.stdin
  output ||= proc?.stdout
  const {handle} = createMcpHandler(spec)
  const send = (m: any) => { if (m && !(Array.isArray(m) && !m.length)) output.write(JSON.stringify(m) + '\n') }
  let buf = '', queue = Promise.resolve(), end!: () => void
  const done = new Promise<void>(r => end = r)
  const line = (l: string) => {
    if (!l.trim()) return
    queue = queue.then(async () => {
      let msg: any
      try { msg = JSON.parse(l) } catch { return send({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}}) }
      if (Array.isArray(msg)) send((await Promise.all(msg.map(m => handle(m, true)))).filter(Boolean))
      else send(await handle(msg))
    })
  }
  const onData = (chunk: any) => {
    buf += String(chunk)
    let i
    while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1) }
  }
  const onEnd = () => { if (buf) line(buf); buf = ''; queue.then(end) }
  input.setEncoding?.('utf8')
  input.on('data', onData)
  input.on('end', onEnd)
  input.resume?.()
  return {
    listChanged: () => send({jsonrpc: '2.0', method: 'notifications/tools/list_changed'}),
    stop: () => { input.off?.('data', onData); input.off?.('end', onEnd); end() },
    done,
  }
}
