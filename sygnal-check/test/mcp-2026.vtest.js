// G-656: sygnal-check's stdio MCP server speaks the stateless 2026-07-28 revision beside the
// initialize revisions. The official SDK client (@modelcontextprotocol/client, exact
// devDependency) over stdio in three modes (pinned to 2026-07-28, default initialize, auto),
// then the error cases as raw lines and through createMcpServer().handle.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { getExplanation } from '../src/index.js'
import { createMcpServer, SUPPORTED_VERSIONS } from '../src/mcp.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const bin = path.join(pkgRoot, 'bin/sygnal-check.js')
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
const META = 'io.modelcontextprotocol/'
const modernMeta = (extra = {}) => ({
  [META + 'protocolVersion']: '2026-07-28',
  [META + 'clientCapabilities']: {},
  [META + 'clientInfo']: { name: 'vitest', version: '0' },
  ...extra,
})

// The server behind a stdin tee: every line the client writes lands in `log` (the SDK's auto
// mode probes on a sibling process spawned with the same parameters; it logs there too)
let tmp
let log
let teeScript
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-mcp2026-'))
  log = path.join(tmp, 'in.log')
  teeScript = path.join(tmp, 'tee-server.mjs')
  fs.writeFileSync(teeScript, `import fs from 'node:fs'
import { PassThrough } from 'node:stream'
import { runMcpServer } from ${JSON.stringify(pathToFileURL(path.join(pkgRoot, 'src/mcp.js')).href)}
const input = new PassThrough()
process.stdin.on('data', (d) => { fs.appendFileSync(process.env.TEE_LOG, d); input.write(d) })
process.stdin.on('end', () => input.end())
await runMcpServer({ stdin: input, stdout: process.stdout, cwd: process.cwd() })
`)
})
afterAll(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

const sent = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []

describe('G-656: the SDK client over stdio', () => {
  it.each([
    ['pinned to 2026-07-28', { mode: { pin: '2026-07-28' } }, 'modern', '2026-07-28'],
    ['default (initialize)', undefined, 'legacy', '2025-11-25'],
    ['auto', { mode: 'auto' }, 'modern', '2026-07-28'],
  ])('%s: lists and calls check, graph and explain', async (_, versionNegotiation, era, version) => {
    fs.rmSync(log, { force: true })
    const client = new Client({ name: 'g656', version: '1.0.0' }, versionNegotiation ? { versionNegotiation } : {})
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [teeScript], cwd: pkgRoot, env: { ...process.env, TEE_LOG: log }, stderr: 'pipe' }))
    try {
      expect(client.getProtocolEra()).toBe(era)
      expect(client.getNegotiatedProtocolVersion()).toBe(version)
      expect(client.getServerVersion()).toMatchObject({ name: 'sygnal-check', version: pkg.version })
      expect(client.getInstructions()).toContain('explain')
      if (era === 'modern') expect(client.getDiscoverResult()).toMatchObject({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: {} } })

      const { tools } = await client.listTools()
      expect(tools.map(t => t.name)).toEqual(['check', 'graph', 'explain'])

      const check = await client.callTool({ name: 'check', arguments: { paths: ['test/fixtures/bad/selector-typo.jsx'] } })
      expect(check.isError).toBe(false)
      expect(check.structuredContent.diagnostics.map(d => d.code)).toEqual(['SYG110', 'SYG110', 'SYG110'])
      const graph = await client.callTool({ name: 'graph', arguments: { paths: ['test/fixtures/good/todo-app.jsx'] } })
      expect(graph.structuredContent.components.map(c => c.name)).toEqual(['TodoItem', 'Card', 'App'])
      const explain = await client.callTool({ name: 'explain', arguments: { code: 'SYG104' } })
      expect(explain.structuredContent).toEqual(getExplanation('SYG104'))
      const bad = await client.callTool({ name: 'explain', arguments: { code: 'SYG199' } })
      expect(bad.isError).toBe(true)
    } finally {
      await client.close()
    }

    // what went over the wire
    const methods = sent().filter(m => 'id' in m).map(m => m.method)
    if (era === 'legacy') {
      expect(methods[0]).toBe('initialize')
      expect(methods).not.toContain('server/discover')
    } else {
      expect(methods[0]).toBe('server/discover')
      expect(methods).not.toContain('initialize')
      for (const m of sent().filter(m => 'id' in m)) expect(m.params._meta[META + 'protocolVersion']).toBe('2026-07-28')
    }
    expect(methods.filter(m => m === 'tools/call')).toHaveLength(4)
  }, 30000)
})

/** A raw line client over the server's stdio */
function startServer() {
  const child = spawn(process.execPath, [bin, 'mcp'], { cwd: pkgRoot, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  const lines = []
  let buf = ''
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      lines.push(msg)
      const key = Array.isArray(msg) ? 'batch' : msg.id
      if (pending.has(key)) { pending.get(key)(msg); pending.delete(key) }
    }
  })
  let nextId = 1
  const send = (message, key) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${JSON.stringify(message)}`)), 10000)
    pending.set(key, (m) => { clearTimeout(timer); resolve(m) })
    child.stdin.write(JSON.stringify(message) + '\n')
  })
  const request = (method, params) => { const id = nextId++; return send({ jsonrpc: '2.0', id, method, params }, id) }
  const batch = (messages) => send(messages, 'batch')
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  const close = () => new Promise(resolve => { child.on('close', resolve); child.stdin.end() })
  return { request, batch, notify, close, lines }
}

describe('G-656: 2026-07-28 on the wire (stdio)', () => {
  let s
  beforeAll(() => { s = startServer() })
  afterAll(async () => { if (s) await s.close() })

  it('server/discover, tools/list and tools/call without initialize', async () => {
    const discover = await s.request('server/discover', { _meta: modernMeta() })
    expect(discover.result).toEqual({
      resultType: 'complete',
      supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'],
      capabilities: { tools: {} },
      instructions: expect.any(String),
      ttlMs: 3_600_000,
      cacheScope: 'private',
      _meta: { [META + 'serverInfo']: { name: 'sygnal-check', version: pkg.version } },
    })
    const list = await s.request('tools/list', { _meta: modernMeta() })
    expect(list.result).toMatchObject({ resultType: 'complete', ttlMs: 3_600_000, cacheScope: 'private', _meta: { [META + 'serverInfo']: { name: 'sygnal-check' } } })
    expect(list.result.tools.map(t => t.name)).toEqual(['check', 'graph', 'explain'])
    const call = await s.request('tools/call', { name: 'explain', arguments: { code: '104' }, _meta: modernMeta() })
    expect(call.result).toMatchObject({ resultType: 'complete', isError: false, structuredContent: getExplanation('SYG104') })
    expect(call.result).not.toHaveProperty('ttlMs')
    // a tool error is still a complete result
    const missing = await s.request('tools/call', { name: 'check', arguments: { paths: ['nope/'] }, _meta: modernMeta() })
    expect(missing.result).toMatchObject({ resultType: 'complete', isError: true })
    // cancellation of an answered request is ignored
    s.notify('notifications/cancelled', { requestId: 3, _meta: modernMeta() })
  })

  it('error cases', async () => {
    // an unknown version: -32022 with the supported list (the client retries with one of them)
    const unsupported = await s.request('tools/list', { _meta: modernMeta({ [META + 'protocolVersion']: '2099-01-01' }) })
    expect(unsupported.error).toEqual({ code: -32022, message: 'Unsupported protocol version', data: { supported: SUPPORTED_VERSIONS, requested: '2099-01-01' } })
    const notString = await s.request('server/discover', { _meta: modernMeta({ [META + 'protocolVersion']: 20260728 }) })
    expect(notString.error.code).toBe(-32022)
    // a required _meta field missing: -32602
    const noCaps = await s.request('tools/list', { _meta: { [META + 'protocolVersion']: '2026-07-28' } })
    expect(noCaps.error.code).toBe(-32602)
    expect(noCaps.error.message).toContain('clientCapabilities')
    // server/discover without _meta (it exists only in 2026-07-28)
    const bareDiscover = await s.request('server/discover', {})
    expect(bareDiscover.error.code).toBe(-32602)
    expect(bareDiscover.error.message).toContain('protocolVersion')
    // 2026-07-28 removed initialize and ping
    for (const method of ['initialize', 'ping']) {
      const r = await s.request(method, { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '0' }, _meta: modernMeta() })
      expect(r.error.code).toBe(-32601)
      expect(r.error.message).toContain('2025-11-25')
    }
    // unknown method / tool, in the modern era
    expect((await s.request('resources/list', { _meta: modernMeta() })).error.code).toBe(-32601)
    expect((await s.request('tools/call', { name: 'nope', _meta: modernMeta() })).error).toEqual({ code: -32602, message: 'Unknown tool: nope' })
    // batches stay an initialize-era feature
    const out = await s.batch([
      { jsonrpc: '2.0', id: 'a', method: 'tools/list', params: { _meta: modernMeta() } },
      { jsonrpc: '2.0', id: 'b', method: 'ping' },
    ])
    expect(out[0]).toMatchObject({ id: 'a', error: { code: -32600 } })
    expect(out[1]).toEqual({ jsonrpc: '2.0', id: 'b', result: {} })
  })

  it('serves the initialize era on the same process', async () => {
    const init = await s.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '0' } })
    expect(init.result).toMatchObject({ protocolVersion: '2025-11-25', serverInfo: { name: 'sygnal-check' } })
    expect(init.result).not.toHaveProperty('resultType')
    const list = await s.request('tools/list', {})
    expect(list.result).toEqual({ tools: expect.any(Array) })
    // a legacy version in _meta is the legacy era
    const legacyMeta = await s.request('tools/list', { _meta: { [META + 'protocolVersion']: '2025-06-18' } })
    expect(legacyMeta.result).toEqual({ tools: expect.any(Array) })
  })
})

describe('createMcpServer().handle (2026-07-28)', () => {
  const { handle } = createMcpServer({ cwd: pkgRoot })
  it('a modern request with non-object _meta fields', () => {
    expect(handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: modernMeta({ [META + 'clientCapabilities']: 'all' }) } }).error.code).toBe(-32602)
    // _meta that isn't an object: no version, so the initialize era
    expect(handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: 'x' } }).result.tools).toHaveLength(3)
    // notifications are never answered, whatever their _meta
    expect(handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { _meta: modernMeta({ [META + 'protocolVersion']: 'bad' }) } })).toBe(null)
  })
  it('keeps a result _meta the handler set and adds serverInfo', () => {
    const r = handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'explain', arguments: { code: 'SYG104' }, _meta: modernMeta() } })
    expect(r.result._meta).toEqual({ [META + 'serverInfo']: { name: 'sygnal-check', version: pkg.version } })
    expect(r.id).toBe(3)
  })
})
