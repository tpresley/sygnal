// sygnal-check mcp: spawn the stdio server and speak MCP (JSON-RPC 2.0, newline-delimited)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateSchema, getExplanation } from '../src/index.js'
import { createMcpServer } from '../src/mcp.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const schema = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'schema/inspect.schema.json'), 'utf8'))

/** A tiny MCP client over the child's stdio. */
function startServer() {
  const child = spawn(process.execPath, [path.join(pkgRoot, 'bin/sygnal-check.js'), 'mcp'], { cwd: pkgRoot, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  const lines = []
  let buf = ''
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      lines.push(msg)
      if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
  })
  let nextId = 1
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}; stderr: ${stderr}`)), 10000)
    pending.set(id, (m) => { clearTimeout(timer); resolve(m) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  const raw = (text) => child.stdin.write(text + '\n')
  const close = () => new Promise(resolve => { child.on('close', resolve); child.stdin.end() })
  return { request, notify, raw, close, lines, child }
}

describe('sygnal-check mcp (stdio)', () => {
  let s
  beforeAll(() => { s = startServer() })
  afterAll(async () => { if (s) await s.close() })

  it('initialize → tools/list → tools/call for check, graph and explain', async () => {
    const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } })
    expect(init.jsonrpc).toBe('2.0')
    expect(init.result.protocolVersion).toBe('2025-06-18')
    expect(init.result.capabilities.tools).toBeDefined()
    expect(init.result.serverInfo.name).toBe('sygnal-check')
    s.notify('notifications/initialized')

    expect((await s.request('ping')).result).toEqual({})

    const list = await s.request('tools/list', {})
    expect(list.result.tools.map(t => t.name)).toEqual(['check', 'graph', 'explain'])
    for (const t of list.result.tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(typeof t.description).toBe('string')
    }

    const check = await s.request('tools/call', { name: 'check', arguments: { paths: ['test/fixtures/bad/selector-typo.jsx'] } })
    expect(check.result.isError).toBe(false)
    const { diagnostics, summary } = check.result.structuredContent
    expect(diagnostics.map(d => d.code)).toEqual(['SYG110', 'SYG110', 'SYG110'])
    expect(diagnostics[0]).toMatchObject({ file: 'test/fixtures/bad/selector-typo.jsx', severity: 'warn', component: 'App' })
    expect(summary).toEqual({ error: 0, warn: 3, info: 0 })
    expect(JSON.parse(check.result.content[0].text)).toEqual(check.result.structuredContent)

    const graph = await s.request('tools/call', { name: 'graph', arguments: { paths: ['test/fixtures/good/todo-app.jsx'] } })
    expect(graph.result.isError).toBe(false)
    expect(validateSchema(schema, graph.result.structuredContent)).toEqual([])
    expect(graph.result.structuredContent.components.map(c => c.name)).toEqual(['TodoItem', 'Card', 'App'])
    expect(graph.result.content[0].type).toBe('text')

    const explain = await s.request('tools/call', { name: 'explain', arguments: { code: 'syg104' } })
    expect(explain.result.isError).toBe(false)
    expect(explain.result.structuredContent).toEqual(getExplanation('SYG104'))
  })

  it('strict, tool errors, unknown tools / methods and parse errors', async () => {
    const strict = await s.request('tools/call', { name: 'check', arguments: { paths: ['test/fixtures/strict/bad/model-forms.jsx'], strict: true } })
    expect(strict.result.structuredContent.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['SYG504', 'SYG505']))

    // D144: a11y stays warn under strict; a11y: 'error' opts in
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-mcp-a11y-'))
    try {
      const app = path.join(dir, 'App.jsx')
      fs.writeFileSync(app, 'export function App() {\n  return <img src="a.png" />\n}\nApp.initialState = {}\n')
      const sev = async (args) => (await s.request('tools/call', { name: 'check', arguments: { paths: [app], ...args } }))
        .result.structuredContent.diagnostics.filter(d => d.code === 'SYG703').map(d => d.severity)
      expect(await sev({ strict: true })).toEqual(['warn'])
      expect(await sev({ a11y: 'error' })).toEqual(['error'])
      const bad = await s.request('tools/call', { name: 'check', arguments: { paths: [app], a11y: 'loud' } })
      expect(bad.result.isError).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }

    const unknownCode = await s.request('tools/call', { name: 'explain', arguments: { code: 'SYG199' } })
    expect(unknownCode.result.isError).toBe(true)
    expect(unknownCode.result.content[0].text).toContain("unknown diagnostic code 'SYG199'")

    const missing = await s.request('tools/call', { name: 'check', arguments: { paths: ['nope/'] } })
    expect(missing.result.isError).toBe(true)
    expect(missing.result.content[0].text).toContain('no such file or directory')

    expect((await s.request('tools/call', { name: 'nope', arguments: {} })).error.code).toBe(-32602)
    expect((await s.request('resources/list', {})).error.code).toBe(-32601)

    const before = s.lines.length
    s.raw('{not json')
    await new Promise(r => setTimeout(r, 200))
    expect(s.lines.slice(before)).toEqual([{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }])
  })
})

describe('createMcpServer().handle', () => {
  const { handle } = createMcpServer({ cwd: pkgRoot })
  it('ignores notifications and negotiates the protocol version', () => {
    expect(handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(null)
    expect(handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }).result.protocolVersion).toBe('2025-11-25')
    expect(handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-11-05' } }).result.protocolVersion).toBe('2024-11-05')
  })
})

describe('createMcpServer().handle never throws (R2)', () => {
  const { handle } = createMcpServer({ cwd: pkgRoot })
  it('treats params: null / non-object params as {}', () => {
    for (const params of [null, 5, 'x', [1, 2], true]) {
      const init = handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params })
      expect(init.result.protocolVersion).toBe('2025-11-25')
      const call = handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params })
      expect(call.error).toEqual({ code: -32602, message: 'Unknown tool: undefined' })
      expect(handle({ jsonrpc: '2.0', id: 3, method: 'tools/list', params }).result.tools.length).toBe(3)
    }
  })
  it('turns a throwing handler into a -32603 Internal error', () => {
    const msg = { jsonrpc: '2.0', id: 7, method: 'initialize' }
    Object.defineProperty(msg, 'params', { enumerable: true, get() { throw new Error('boom') } })
    expect(handle(msg)).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'Internal error: boom' } })
  })
  it('a stdio server survives params: null', async () => {
    const s = startServer()
    try {
      s.raw(JSON.stringify({ jsonrpc: '2.0', id: 'raw', method: 'initialize', params: null }))
      const ping = await s.request('ping')
      expect(ping.result).toEqual({})
      expect(s.lines[0].result.protocolVersion).toBe('2025-11-25')
    } finally { await s.close() }
  })
})
