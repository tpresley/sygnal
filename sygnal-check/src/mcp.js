/**
 * `sygnal-check mcp`: a minimal Model Context Protocol server on stdio
 * (newline-delimited JSON-RPC 2.0), hand-rolled to keep sygnal-check
 * dependency-free. It implements initialize, ping, tools/list and tools/call;
 * other requests get "method not found", notifications are ignored.
 *
 * Tools (paths are resolved against the server's working directory, default
 * ['src']):
 *   check({ paths?, strict? })  → { diagnostics: Diagnostic[], summary }
 *   graph({ paths?, strict? })  → InspectGraph (schema/inspect.schema.json)
 *   explain({ code })           → Explanation (title, severity, explanation, fix, docsUrl)
 * Each result is returned as structuredContent and as JSON text content.
 *
 *   createMcpServer({ cwd }) → { handle(message) → response | null }  (never throws:
 *     non-object params are treated as {}, failures become -32603 errors)
 *   runMcpServer({ stdin, stdout, cwd })   (what the CLI runs)
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { expandInputs } from './files.js'
import { checkFiles } from './index.js'
import { graphFiles } from './graph.js'
import { getExplanation, suggestCodes } from './explain.js'

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'))

const pathsSchema = {
  type: 'array',
  items: { type: 'string' },
  description: "Files, directories or globs, relative to the server's working directory (default: [\"src\"])",
}
const strictSchema = { type: 'boolean', description: 'Also run the strict-mode canonical-form rules (SYG501-507)' }

export const TOOLS = [
  {
    name: 'check',
    title: 'Check a Sygnal app',
    description: 'Statically check Sygnal components for wiring bugs that fail silently at runtime (intent selectors missing from the view or hidden inside a child component, intent/model mismatches, EVENTS without a counterpart, Collection from fields, controlled inputs). Returns diagnostics with code, severity, file:line:column, message, fix and docsUrl. Call explain with a code for details.',
    inputSchema: { type: 'object', properties: { paths: pathsSchema, strict: strictSchema }, additionalProperties: false },
  },
  {
    name: 'graph',
    title: 'Sygnal app graph',
    description: "The app's structure as one JSON graph (the same shape as the runtime inspect()): components with their actions (and what triggers them), state keys, context provided/read, EVENTS emitted/selected, child components (tag/Collection/Switchable/slot), intent DOM selectors (matched in the view, or hidden inside a child), and the diagnostics attached to each component.",
    inputSchema: { type: 'object', properties: { paths: pathsSchema, strict: strictSchema }, additionalProperties: false },
  },
  {
    name: 'explain',
    title: 'Explain a Sygnal diagnostic code',
    description: 'Explain a Sygnal diagnostic code (e.g. SYG104): title, severity, what triggers it and what goes wrong, how to fix it, and the docs URL.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: "Diagnostic code, e.g. 'SYG104' (also 'syg104' or '104')" } },
      required: ['code'],
      additionalProperties: false,
    },
  },
]

class ToolError extends Error {}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

function filesFor(cwd, paths) {
  if (paths !== undefined && (!Array.isArray(paths) || paths.some(p => typeof p !== 'string'))) {
    throw new ToolError('paths must be an array of strings')
  }
  const list = paths && paths.length ? paths : ['src']
  const { files, missing } = expandInputs(list, { cwd })
  if (missing.length) throw new ToolError(`no such file or directory: ${missing.join(', ')}`)
  if (!files.length) throw new ToolError(`no source files found in ${list.join(', ')}`)
  return files
}

function summarize(diags) {
  const count = (s) => diags.filter(d => d.severity === s).length
  return { error: count('error'), warn: count('warn'), info: count('info') }
}

function callTool(name, args, cwd) {
  args = isObj(args) ? args : {}
  if (name === 'check') {
    const diagnostics = checkFiles(filesFor(cwd, args.paths), { cwd, strict: !!args.strict })
    return { diagnostics, summary: summarize(diagnostics) }
  }
  if (name === 'graph') {
    return graphFiles(filesFor(cwd, args.paths), { cwd, strict: !!args.strict })
  }
  if (name === 'explain') {
    const e = typeof args.code === 'string' ? getExplanation(args.code) : undefined
    if (!e) {
      const near = suggestCodes(args.code)
      throw new ToolError(`unknown diagnostic code '${args.code}'` + (near.length ? `; known codes in that range: ${near.join(', ')}` : ''))
    }
    return e
  }
  return undefined
}

export function createMcpServer({ cwd = process.cwd() } = {}) {
  const result = (id, value) => ({ jsonrpc: '2.0', id, result: value })
  const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      // a response from the client, or garbage
      return msg && typeof msg === 'object' && 'id' in msg && !('result' in msg || 'error' in msg)
        ? error(msg.id ?? null, -32600, 'Invalid Request')
        : null
    }
    const isRequest = 'id' in msg && msg.id !== null
    if (!isRequest) return null // notifications (notifications/initialized, cancelled, ...)
    const { id, method } = msg
    const params = isObj(msg.params) ? msg.params : {}
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion
        return result(id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'sygnal-check', version: pkg.version },
          instructions: 'Static checker for Sygnal apps. Use graph to see the app structure, check for wiring diagnostics, explain for any SYG code.',
        })
      }
      case 'ping':
        return result(id, {})
      case 'tools/list':
        return result(id, { tools: TOOLS })
      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === params.name)
        if (!tool) return error(id, -32602, `Unknown tool: ${params.name}`)
        try {
          const value = callTool(tool.name, params.arguments, cwd)
          return result(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false })
        } catch (err) {
          const text = err instanceof ToolError ? err.message : `sygnal-check ${tool.name} failed: ${err?.message || err}`
          return result(id, { content: [{ type: 'text', text }], isError: true })
        }
      }
      default:
        return error(id, -32601, `Method not found: ${method}`)
    }
  }

  /** Handle one message; never throws (an unexpected failure is a -32603 error). */
  function handle(msg) {
    try {
      return handleMessage(msg)
    } catch (err) {
      let id = null
      try { id = isObj(msg) && 'id' in msg ? msg.id ?? null : null } catch { /* keep null */ }
      return error(id, -32603, `Internal error: ${err?.message || err}`)
    }
  }

  return { handle }
}

/** Serve MCP over stdio until stdin closes. Resolves when done. */
export function runMcpServer({ stdin = process.stdin, stdout = process.stdout, cwd = process.cwd() } = {}) {
  const server = createMcpServer({ cwd })
  const send = (msg) => { if (msg) stdout.write(JSON.stringify(msg) + '\n') }
  const rl = readline.createInterface({ input: stdin, crlfDelay: Infinity })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      return
    }
    if (Array.isArray(msg)) {
      // JSON-RPC batch (older protocol revisions)
      const out = msg.map(m => server.handle(m)).filter(Boolean)
      if (out.length) send(out)
      return
    }
    send(server.handle(msg))
  })
  return new Promise(resolve => rl.on('close', resolve))
}
