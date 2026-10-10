// PLAN-6 E-1: sygnal/vite's dev MCP endpoint, without a browser: the JSON-RPC server with a fake
// page bridge, the HTTP middleware's host / origin checks, the HMR page bridge with a fake
// channel, and the plugin's dev-only wiring. The page side (src/extra/devMcp.ts) is in
// p6-3e-mcp-page.test.js; the real thing (Vite + Chromium) in vite-plugin-mcp.test.js.
import { describe, it, expect, vi, afterEach } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDevMcpServer, mcpMiddleware, refusal, hmrBridge, mcpClientModule, PAGE_TOOLS, SUPPORTED_VERSIONS, LEGACY_VERSIONS, MCP_PATH,
} from '../src/vite/mcp.ts'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import sygnal from '../src/vite/plugin.ts'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fakeBridge(tabs = [], answer = async (tab, tool, args) => ({ tool, args, from: tab })) {
  const calls = []
  return {
    calls,
    tabs: () => tabs.map((t) => ({ ...t })),
    request: (tab, tool, args, ms) => { calls.push({ tab, tool, args, ms }); return answer(tab, tool, args) },
  }
}
const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
const call = (name, args) => rpc('tools/call', { name, arguments: args })

describe('the JSON-RPC server', () => {
  it('initialize negotiates the protocol version and names the server', async () => {
    const s = createDevMcpServer({ bridge: fakeBridge(), version: '6.1.0' })
    const r = await s.handle(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }))
    expect(r.result.protocolVersion).toBe('2025-06-18')
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } })
    expect(r.result.serverInfo).toMatchObject({ name: 'sygnal-dev', version: '6.1.0' })
    const newer = await s.handle(rpc('initialize', { protocolVersion: '2099-01-01' }))
    expect(newer.result.protocolVersion).toBe(LEGACY_VERSIONS[0])
    // G-655: initialize is the legacy era's: a 2026-07-28 client asking there gets 2025-11-25
    expect((await s.handle(rpc('initialize', { protocolVersion: '2026-07-28' }))).result.protocolVersion).toBe('2025-11-25')
    expect(SUPPORTED_VERSIONS).toEqual(['2026-07-28', ...LEGACY_VERSIONS])
  })

  it('lists the page tools and tabs, plus sygnal-check\'s tools when it is there', async () => {
    const plain = createDevMcpServer({ bridge: fakeBridge() })
    const names = (await plain.handle(rpc('tools/list'))).result.tools.map((t) => t.name)
    expect(names).toEqual(['get_state', 'dispatch', 'component_tree', 'recent_actions', 'get_diagnostics', 'copy_as_test', 'agent_tools', 'apps', 'tabs'])
    for (const t of PAGE_TOOLS) expect(t.inputSchema.properties.tab).toBeDefined()
    // G-638: `app` on the state / dispatch / tree / copy / agent tools
    for (const n of ['get_state', 'dispatch', 'component_tree', 'copy_as_test', 'agent_tools']) {
      expect(PAGE_TOOLS.find((t) => t.name === n).inputSchema.properties.app.type).toEqual(['string', 'integer'])
    }
    const check = { tools: [{ name: 'explain', inputSchema: { type: 'object' } }], server: { handle: (m) => ({ jsonrpc: '2.0', id: m.id, result: { content: [], echoed: m.params } }) } }
    const withCheck = createDevMcpServer({ bridge: fakeBridge(), check: Promise.resolve(check) })
    expect((await withCheck.handle(rpc('tools/list'))).result.tools.map((t) => t.name)).toContain('explain')
    const r = await withCheck.handle(call('explain', { code: 'SYG103' }))
    expect(r.id).toBe(1)
    expect(r.result.echoed).toEqual({ name: 'explain', arguments: { code: 'SYG103' } })
  })

  it('ping, unknown methods and tools, notifications, garbage and batches', async () => {
    const s = createDevMcpServer({ bridge: fakeBridge() })
    expect((await s.handle(rpc('ping'))).result).toEqual({})
    expect((await s.handle(rpc('resources/list'))).error.code).toBe(-32601)
    expect((await s.handle(call('nope', {}))).error.code).toBe(-32602)
    expect(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect((await s.handle({ id: 3 })).error.code).toBe(-32600)
    expect(await s.handle({ jsonrpc: '2.0', id: 4, result: {} })).toBeNull() // a response from the client
    const batch = await s.handle([rpc('ping', null, 1), { jsonrpc: '2.0', method: 'notifications/x' }, rpc('ping', null, 2)])
    expect(batch.map((m) => m.id)).toEqual([1, 2])
  })

  it('no page: a tool error that says to open the app', async () => {
    const s = createDevMcpServer({ bridge: fakeBridge([]), url: () => 'http://localhost:5173/' })
    const r = (await s.handle(call('get_state', {}))).result
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/no page is connected: open the app \(http:\/\/localhost:5173\/\)/)
  })

  it('routes to the most recent tab and says so; `tab` picks one; the result names the tab', async () => {
    const bridge = fakeBridge([{ id: 1, url: 'http://localhost:5173/a', title: 'A', active: 5 }, { id: 2, url: 'http://localhost:5173/b', title: 'B', active: 9 }])
    const s = createDevMcpServer({ bridge, timeout: 1234 })
    const r = (await s.handle(call('get_state', { component: 'App', path: 'x' }))).result
    expect(r.isError).toBe(false)
    expect(bridge.calls[0]).toEqual({ tab: 2, tool: 'get_state', args: { component: 'App', path: 'x' }, ms: 1234 })
    expect(r.structuredContent.tab).toEqual({ id: 2, url: 'http://localhost:5173/b', title: 'B' })
    expect(r.structuredContent.tabNote).toMatch(/2 tabs are open; used tab 2/)
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent)
    const picked = (await s.handle(call('dispatch', { tab: 1, action: 'INC' }))).result
    expect(bridge.calls[1]).toMatchObject({ tab: 1, tool: 'dispatch', args: { action: 'INC' } })
    expect(picked.structuredContent.tabNote).toBeUndefined()
    const missing = (await s.handle(call('dispatch', { tab: 7, action: 'INC' }))).result
    expect(missing).toMatchObject({ isError: true })
    expect(missing.content[0].text).toMatch(/no tab 7; open tabs: 1 http:\/\/localhost:5173\/a, 2/)
    const tabs = (await s.handle(call('tabs', {}))).result.structuredContent
    expect(tabs).toEqual({ tabs: [{ id: 1, url: 'http://localhost:5173/a', title: 'A' }, { id: 2, url: 'http://localhost:5173/b', title: 'B' }] })
  })

  it('a page error is a tool error (isError), not a protocol error', async () => {
    const bridge = fakeBridge([{ id: 1, url: 'u', title: '', active: 1 }], async () => { throw new Error('App has no action NOPE') })
    const r = (await createDevMcpServer({ bridge }).handle(call('dispatch', { action: 'NOPE' }))).result
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/NOPE/)
  })
})

describe('host and origin checks (DNS rebinding, other machines)', () => {
  const req = (host, origin, remote = '127.0.0.1') => ({ socket: { remoteAddress: remote }, headers: { host, ...(origin !== undefined ? { origin } : {}) } })
  it('allows local names, loopback addresses and server.allowedHosts', () => {
    for (const h of ['localhost:5173', '127.0.0.1:5173', '[::1]:5173', 'app.localhost:5173', 'localhost']) expect(refusal(req(h))).toBeNull()
    expect(refusal(req('localhost:5173', 'http://localhost:5173'))).toBeNull()
    expect(refusal(req('localhost:5173', 'http://127.0.0.1:3000'), [])).toBeNull()
    expect(refusal(req('dev.example.test:5173'), ['.example.test'])).toBeNull()
    expect(refusal(req('localhost:5173', undefined, '::ffff:127.0.0.1'))).toBeNull()
  })
  it('refuses other hosts, other origins, null origins and remote addresses', () => {
    expect(refusal(req('evil.example:5173'))).toMatch(/not a local name/)
    expect(refusal(req('localhost:5173', 'https://evil.example'))).toMatch(/Origin https:\/\/evil.example/)
    expect(refusal(req('localhost:5173', 'null'))).toMatch(/null/)
    expect(refusal(req('localhost:5173', undefined, '192.168.1.20'))).toMatch(/only answers requests from this machine/)
    expect(refusal(req('192.168.1.5:5173'))).toMatch(/not a local name/)
    expect(refusal({ socket: { remoteAddress: '127.0.0.1' }, headers: {} })).toMatch(/Host/)
  })
})

describe('the HTTP endpoint (streamable HTTP, JSON responses)', () => {
  let server
  afterEach(() => new Promise((r) => (server ? server.close(r) : r())))
  async function start() {
    const mcp = createDevMcpServer({ bridge: fakeBridge() })
    const mw = mcpMiddleware(mcp, () => undefined)
    server = http.createServer((q, s) => mw(q, s, () => { s.statusCode = 404; s.end('next') }))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${server.address().port}`
  }
  const post = (base, body, headers = {}) => fetch(base + MCP_PATH, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: typeof body == 'string' ? body : JSON.stringify(body) })

  it('POST answers JSON; notifications get 202; GET 405; other paths pass through', async () => {
    const base = await start()
    const r = await post(base, rpc('initialize', { protocolVersion: '2025-11-25' }))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/application\/json/)
    expect((await r.json()).result.protocolVersion).toBe('2025-11-25')
    expect((await post(base, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    const get = await fetch(base + MCP_PATH)
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    expect((await fetch(base + '/other')).status).toBe(404)
    expect((await post(base, '{nope')).status).toBe(400)
    expect((await post(base, rpc('ping'), { 'mcp-protocol-version': '1999-01-01' })).status).toBe(400)
    expect((await post(base, rpc('ping'), { 'mcp-protocol-version': '2025-06-18' })).status).toBe(200)
    expect((await post(base, rpc('ping'))).status).toBe(200) // no header: 2025-03-26
  })

  it('403 for a foreign Origin (a web page) or Host (DNS rebinding)', async () => {
    const base = await start()
    const o = await post(base, rpc('ping'), { origin: 'https://evil.example' })
    expect(o.status).toBe(403)
    expect((await o.json()).error.message).toMatch(/Forbidden/)
    // fetch() can't override Host: use http.request
    const status = await new Promise((resolve, reject) => {
      const q = http.request(base + MCP_PATH, { method: 'POST', headers: { host: 'rebound.example:80', 'content-type': 'application/json' } }, (s) => { s.resume(); resolve(s.statusCode) })
      q.on('error', reject)
      q.end(JSON.stringify(rpc('ping')))
    })
    expect(status).toBe(403)
  })
})

// G-655: the stateless 2026-07-28 revision beside the initialize era (a dual-era server).
// Spec: modelcontextprotocol.io/specification/2026-07-28/basic/versioning, .../basic/index (_meta,
// error codes), .../basic/transports/streamable-http (headers, server validation, 404),
// .../server/discover, .../server/utilities/caching. The real clients are the official SDK's
// (@modelcontextprotocol/client 2.3.1, exact devDependency).
describe('G-655: protocol revision 2026-07-28 (stateless)', () => {
  let server
  afterEach(() => new Promise((r) => (server ? server.close(r) : r())))
  const TAB = { id: 1, url: 'http://localhost:5173/', title: 'App', active: 1 }
  async function start() {
    const check = { tools: [{ name: 'explain', inputSchema: { type: 'object' } }], server: { handle: (m) => ({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ok' }], echoed: m.params } }) } }
    const mcp = createDevMcpServer({ bridge: fakeBridge([TAB], async (tab, tool, args) => ({ state: { count: 3 }, tool, args })), version: '6.1.0', check: Promise.resolve(check) })
    const mw = mcpMiddleware(mcp, () => undefined)
    server = http.createServer((q, s) => mw(q, s, () => { s.statusCode = 404; s.end('next') }))
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${server.address().port}`
  }
  const V = '2026-07-28'
  const meta = (extra = {}) => ({ 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 't', version: '1' }, ...extra })
  const post = (base, body, headers = {}) => fetch(base + MCP_PATH, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
  const modernPost = (base, method, params = {}, headers = {}) => post(base, rpc(method, { ...params, _meta: meta() }, 7), { 'mcp-protocol-version': V, 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}), ...headers })

  it('server/discover, tools/list and tools/call without initialize; results are complete and name the server', async () => {
    const base = await start()
    const d = await modernPost(base, 'server/discover')
    expect(d.status).toBe(200)
    const disc = (await d.json()).result
    expect(disc).toMatchObject({ resultType: 'complete', supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: {} }, ttlMs: 0, cacheScope: 'private' })
    expect(disc._meta['io.modelcontextprotocol/serverInfo']).toMatchObject({ name: 'sygnal-dev', version: '6.1.0' })
    expect(disc.instructions).toMatch(/component_tree/)
    const list = (await (await modernPost(base, 'tools/list')).json()).result
    expect(list).toMatchObject({ resultType: 'complete', ttlMs: 0, cacheScope: 'private' })
    expect(list.tools.map((t) => t.name)).toEqual(['get_state', 'dispatch', 'component_tree', 'recent_actions', 'get_diagnostics', 'copy_as_test', 'agent_tools', 'apps', 'tabs', 'explain'])
    const r = await (await modernPost(base, 'tools/call', { name: 'get_state', arguments: { component: 'App' } })).json()
    expect(r.id).toBe(7)
    expect(r.result).toMatchObject({ resultType: 'complete', isError: false, structuredContent: { state: { count: 3 }, args: { component: 'App' }, tab: { id: 1 } } })
    expect(r.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('sygnal-dev')
    // sygnal-check's tools (initialize era) get the call without the modern _meta; the result is still marked
    const e = (await (await modernPost(base, 'tools/call', { name: 'explain', arguments: { code: 'SYG103' } })).json()).result
    expect(e.echoed).toEqual({ name: 'explain', arguments: { code: 'SYG103' } })
    expect(e.resultType).toBe('complete')
    // the legacy era is unchanged on the same endpoint: no resultType, no cache fields
    const legacy = (await (await post(base, rpc('tools/list'), { 'mcp-protocol-version': '2025-11-25' })).json()).result
    expect(legacy.resultType).toBeUndefined()
    expect(legacy.ttlMs).toBeUndefined()
    expect((await post(base, rpc('server/discover'), { 'mcp-protocol-version': '2025-11-25' })).status).toBe(200) // a legacy -32601 stays 200
  })

  it('an unsupported version is 400 with -32022 and the supported list (header or _meta)', async () => {
    const base = await start()
    const h = await post(base, rpc('tools/list', { _meta: meta({ 'io.modelcontextprotocol/protocolVersion': '2099-01-01' }) }), { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' })
    expect(h.status).toBe(400)
    expect(await h.json()).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: SUPPORTED_VERSIONS, requested: '2099-01-01' } } })
    const m = await post(base, rpc('tools/list', { _meta: meta({ 'io.modelcontextprotocol/protocolVersion': '1900-01-01' }) }))
    expect(m.status).toBe(400)
    expect((await m.json()).error.data.requested).toBe('1900-01-01')
  })

  it('envelope checks: missing _meta fields are -32602, header mismatches -32020 (400)', async () => {
    const base = await start()
    const noCaps = await post(base, rpc('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': V } }), { 'mcp-protocol-version': V, 'mcp-method': 'tools/list' })
    expect(noCaps.status).toBe(400)
    expect((await noCaps.json()).error).toMatchObject({ code: -32602, message: expect.stringMatching(/clientCapabilities/) })
    const noMeta = await post(base, rpc('tools/list'), { 'mcp-protocol-version': V, 'mcp-method': 'tools/list' })
    expect(noMeta.status).toBe(400)
    expect((await noMeta.json()).error.code).toBe(-32602)
    const mismatch = async (headers, params = {}, method = 'tools/list') => {
      const r = await post(base, rpc(method, { ...params, _meta: meta() }), headers)
      expect(r.status).toBe(400)
      return (await r.json()).error
    }
    expect(await mismatch({ 'mcp-method': 'tools/list' })).toMatchObject({ code: -32020, message: expect.stringMatching(/MCP-Protocol-Version header is required/) })
    expect((await mismatch({ 'mcp-protocol-version': '2025-11-25', 'mcp-method': 'tools/list' })).code).toBe(-32020)
    expect(await mismatch({ 'mcp-protocol-version': V })).toMatchObject({ code: -32020, message: expect.stringMatching(/Mcp-Method/) })
    expect((await mismatch({ 'mcp-protocol-version': V, 'mcp-method': 'tools/call' })).code).toBe(-32020)
    const call = { name: 'get_state', arguments: {} }
    expect(await mismatch({ 'mcp-protocol-version': V, 'mcp-method': 'tools/call' }, call, 'tools/call')).toMatchObject({ code: -32020, message: expect.stringMatching(/Mcp-Name header is required/) })
    expect((await mismatch({ 'mcp-protocol-version': V, 'mcp-method': 'tools/call', 'mcp-name': 'dispatch' }, call, 'tools/call')).code).toBe(-32020)
    // the spec's Base64 sentinel for a name that isn't header-safe
    const b64 = await post(base, rpc('tools/call', { ...call, _meta: meta() }), { 'mcp-protocol-version': V, 'mcp-method': 'tools/call', 'mcp-name': `=?base64?${Buffer.from('get_state').toString('base64')}?=` })
    expect(b64.status).toBe(200)
  })

  it('initialize, ping and unknown methods are 404 with -32601; one message per POST; GET 405; security unchanged', async () => {
    const base = await start()
    for (const m of ['initialize', 'ping', 'resources/list']) {
      const r = await modernPost(base, m)
      expect(r.status).toBe(404)
      expect((await r.json()).error.code).toBe(-32601)
    }
    const batch = await post(base, [rpc('tools/list', { _meta: meta() })], { 'mcp-protocol-version': V, 'mcp-method': 'tools/list' })
    expect(batch.status).toBe(400)
    expect((await batch.json()).error.code).toBe(-32600)
    expect((await post(base, { jsonrpc: '2.0', method: 'notifications/x', params: { _meta: meta() } }, { 'mcp-protocol-version': V })).status).toBe(202)
    expect((await fetch(base + MCP_PATH, { headers: { 'mcp-protocol-version': V } })).status).toBe(405)
    expect((await fetch(base + MCP_PATH, { method: 'DELETE', headers: { 'mcp-protocol-version': V } })).status).toBe(405)
    const o = await modernPost(base, 'tools/list', {}, { origin: 'https://evil.example' })
    expect(o.status).toBe(403)
    const status = await new Promise((resolve, reject) => {
      const q = http.request(base + MCP_PATH, { method: 'POST', headers: { host: 'rebound.example', 'content-type': 'application/json', 'mcp-protocol-version': V, 'mcp-method': 'tools/list' } }, (s) => { s.resume(); resolve(s.statusCode) })
      q.on('error', reject)
      q.end(JSON.stringify(rpc('tools/list', { _meta: meta() })))
    })
    expect(status).toBe(403)
  })

  // The official TypeScript SDK's client, three ways: pinned to 2026-07-28 (a modern-only client:
  // no fallback), its default (the 2025 initialize sequence), and 'auto' (dual-era: probes with
  // server/discover and stays modern)
  it.each([
    ['2026-07-28 only', { mode: { pin: '2026-07-28' } }, 'modern', '2026-07-28'],
    ['legacy (default)', undefined, 'legacy', '2025-11-25'],
    ['dual-era (auto)', { mode: 'auto' }, 'modern', '2026-07-28'],
  ])('the SDK client, %s, connects and calls tools', async (_, versionNegotiation, era, version) => {
    const base = await start()
    const client = new Client({ name: 'g655-test', version: '1.0.0' }, versionNegotiation ? { versionNegotiation } : {})
    await client.connect(new StreamableHTTPClientTransport(new URL(base + MCP_PATH)))
    try {
      expect(client.getProtocolEra()).toBe(era)
      expect(client.getNegotiatedProtocolVersion()).toBe(version)
      expect(client.getServerVersion()).toMatchObject({ name: 'sygnal-dev', version: '6.1.0' })
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toContain('get_state')
      const r = await client.callTool({ name: 'get_state', arguments: { component: 'App' } })
      expect(r.isError).toBe(false)
      expect(r.structuredContent).toMatchObject({ state: { count: 3 }, tab: { id: 1 } })
      expect((await client.callTool({ name: 'explain', arguments: { code: 'SYG103' } })).content[0].text).toBe('ok')
    } finally {
      await client.close()
    }
  })
})

describe('the HMR page bridge', () => {
  function fakeChannel() {
    const handlers = {}
    return {
      handlers,
      on: (e, f) => { (handlers[e] ||= []).push(f) },
      emit: (e, data, client) => (handlers[e] || []).forEach((f) => f(data, client)),
    }
  }
  const client = () => ({ sent: [], send(p) { this.sent.push(p) } })

  it('tabs say hello; requests go to the tab and resolve with its answer', async () => {
    const ws = fakeChannel()
    const b = hmrBridge({ ws })
    const a = client(), c = client()
    ws.emit('sygnal:mcp:hello', { url: 'http://localhost/a', title: 'A' }, a)
    ws.emit('sygnal:mcp:hello', { url: 'http://localhost/c', title: 'C' }, c)
    expect(b.tabs().map((t) => [t.id, t.url])).toEqual([[1, 'http://localhost/a'], [2, 'http://localhost/c']])
    ws.emit('sygnal:mcp:hello', { url: 'http://localhost/a', title: 'A' }, a) // focus: more recent
    expect(Math.max(...b.tabs().map((t) => t.active))).toBe(b.tabs()[0].active)
    const p = b.request(1, 'get_state', { component: 'App' }, 1000)
    expect(a.sent[0]).toEqual({ type: 'custom', event: 'sygnal:mcp:request', data: { id: 1, tool: 'get_state', args: { component: 'App' } } })
    ws.emit('sygnal:mcp:response', { id: 1, ok: true, result: { state: 1 } }, c) // another tab can't answer it
    ws.emit('sygnal:mcp:response', { id: 1, ok: true, result: { state: 2 } }, a)
    await expect(p).resolves.toEqual({ state: 2 })
    const q = b.request(2, 'dispatch', {}, 1000)
    ws.emit('sygnal:mcp:response', { id: 2, ok: false, error: 'App has no action X' }, c)
    await expect(q).rejects.toThrow('App has no action X')
  })

  it('G-638: a hello carries the apps; an apps update is not a focus', () => {
    const ws = fakeChannel()
    const b = hmrBridge({ ws })
    const a = client(), c = client()
    ws.emit('sygnal:mcp:hello', { url: 'http://localhost/a', title: 'A', apps: [{ index: 0, component: 'App' }] }, a)
    ws.emit('sygnal:mcp:hello', { url: 'http://localhost/c', title: 'C' }, c)
    const activeC = b.tabs()[1].active
    ws.emit('sygnal:mcp:hello', { url: 'http://localhost/a', title: 'A', update: true, apps: [{ index: 0, component: 'App' }, { index: 1, component: 'Widget' }] }, a)
    expect(b.tabs()[0].apps).toEqual([{ index: 0, component: 'App' }, { index: 1, component: 'Widget' }])
    expect(b.tabs()[1].active).toBe(activeC)
    expect(b.tabs()[0].active).toBeLessThan(activeC)
  })

  it('times out; a confirm notice extends the wait; a closed socket fails its requests', async () => {
    vi.useFakeTimers()
    try {
      const ws = fakeChannel()
      const b = hmrBridge({ ws })
      const listeners = {}
      const a = { ...client(), socket: { readyState: 1, once: (e, f) => { listeners[e] = f } } }
      a.send = function (p) { (this.sent ||= []).push(p) }
      ws.emit('sygnal:mcp:hello', { url: 'u' }, a)
      const slow = b.request(1, 'get_state', {}, 500)
      const slowDone = expect(slow).rejects.toThrow(/did not answer in time/)
      await vi.advanceTimersByTimeAsync(600)
      await slowDone
      const confirming = b.request(1, 'agent_tools', { call: 'x' }, 500)
      ws.emit('sygnal:mcp:response', { id: 2, waiting: true }, a)
      await vi.advanceTimersByTimeAsync(60_000)
      ws.emit('sygnal:mcp:response', { id: 2, ok: true, result: { ok: true } }, a)
      await expect(confirming).resolves.toEqual({ ok: true })
      const orphan = b.request(1, 'get_state', {}, 500)
      listeners.close()
      await expect(orphan).rejects.toThrow(/tab 1 closed/)
      expect(b.tabs()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the plugin: dev only', () => {
  const ENTRY = `import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n`
  function configured(options, command = 'serve') {
    const saved = process.env.VITEST
    delete process.env.VITEST
    try {
      const p = sygnal(options)
      p.config({ root: REPO }, { command })
      p.configResolved?.({ root: REPO })
      return p
    } finally {
      if (saved !== undefined) process.env.VITEST = saved
    }
  }
  const transform = (p, code, id) => p.transform.call({ meta: {} }, code, id)

  it('mcp: true imports virtual:sygnal/mcp in dev entries, which connects the page', async () => {
    const p = configured({ check: false, mcp: true })
    const out = transform(p, ENTRY, '/app/src/main.js').code
    expect(out).toContain("import 'sygnal/devtools';import 'virtual:sygnal/mcp';")
    const id = await p.resolveId.handler.call({}, 'virtual:sygnal/mcp', '/app/src/main.js', {})
    expect(id).toBe('\0virtual:sygnal/mcp')
    expect(p.load(id)).toBe(mcpClientModule({}))
    expect(p.load(id)).toContain("installMcpBridge(import.meta.hot, { agentTools, confirm: \"page\" })")
    // devtools: false still gets the bridge the endpoint needs
    expect(transform(configured({ check: false, mcp: { confirm: false }, devtools: false }), ENTRY, '/app/src/main.js').code)
      .toContain("import 'sygnal/devtools';import 'virtual:sygnal/mcp';")
  })

  it('without mcp, or in a build, nothing: no import, no virtual module, no middleware', async () => {
    const off = configured({ check: false })
    expect(transform(off, ENTRY, '/app/src/main.js').code).not.toContain('sygnal/mcp')
    expect(await off.resolveId.handler.call({}, 'virtual:sygnal/mcp', '/app/src/main.js', {})).toBeNull()
    const build = configured({ check: false, mcp: true }, 'build')
    expect(transform(build, ENTRY, '/app/src/main.js')).toBeNull()
    expect(await build.resolveId.handler.call({}, 'virtual:sygnal/mcp', '/app/src/main.js', {})).toBeNull()
    const used = []
    off.configureServer({ middlewares: { use: (f) => used.push(f) } })
    expect(used).toEqual([])
    const on = configured({ check: false, mcp: true })
    on.configureServer({ middlewares: { use: (f) => used.push(f) }, ws: { on() {} }, config: { server: {} } })
    expect(used).toHaveLength(1)
  })
})
