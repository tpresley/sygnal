// PLAN-6 E-1, end to end: a Vite dev server (examples/kanban's Vite) with sygnal({ mcp: true })
// on test/fixtures/mcp-app (two run() apps, G-638), the page open in headless Chromium, Firefox
// and WebKit (browser-tests' cached Playwright builds, never downloaded; an engine whose build is
// not in the cache is skipped, MCP_E2E_BROWSERS=chromium,firefox picks engines), and an MCP
// client speaking JSON-RPC over HTTP to /__sygnal/mcp (plus, G-655, the official SDK client in
// the 2026-07-28 and the initialize era). Also: a production build of the fixture
// has none of it.
// Needs `npm run build`, `npm install --prefix examples/kanban` and `npm ci --prefix browser-tests`.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import sygnal from '../dist/vite/plugin.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = path.join(REPO, 'test', 'fixtures', 'mcp-app')
const KANBAN = path.join(REPO, 'examples', 'kanban')
const kanbanVite = () => import(pathToFileURL(createRequire(path.join(KANBAN, 'package.json')).resolve('vite')).href)
const playwright = () => import(pathToFileURL(createRequire(path.join(REPO, 'browser-tests', 'package.json')).resolve('playwright')).href)

/** the fixture resolves 'sygnal' (and 'sygnal-check', for the proxied tools) through links to this repo */
function linkFixture() {
  const nm = path.join(FIXTURE, 'node_modules')
  fs.mkdirSync(nm, { recursive: true })
  for (const [name, target] of [['sygnal', REPO], ['sygnal-check', path.join(REPO, 'sygnal-check')]]) {
    const link = path.join(nm, name)
    try { if (fs.realpathSync(link) === fs.realpathSync(target)) continue; fs.rmSync(link, { recursive: true, force: true }) } catch (_) {}
    fs.symlinkSync(target, link, 'dir')
  }
}

let server, base
let rpcId = 1
const ENGINES = (process.env.MCP_E2E_BROWSERS || 'chromium,firefox,webkit').split(',').map((e) => e.trim()).filter(Boolean)
const pw = await playwright()
/** the engines whose Playwright build is in the cache (never downloaded) */
const engines = ENGINES.filter((e) => { try { return fs.existsSync(pw[e].executablePath()) } catch (_) { return false } })

async function rpc(method, params, headers = {}) {
  const r = await fetch(base + '/__sygnal/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, ...(params ? { params } : {}) }),
  })
  return { status: r.status, body: r.status === 202 ? null : await r.json() }
}
async function tool(name, args = {}) {
  const { body } = await rpc('tools/call', { name, arguments: args })
  if (body.error) throw new Error(body.error.message)
  if (body.result.isError) throw new Error(body.result.content[0].text)
  return body.result.structuredContent
}

beforeAll(async () => {
  linkFixture()
  const vite = await kanbanVite()
  // A plain dev server, not Vitest: the plugin reads process.env.VITEST in config()
  const saved = process.env.VITEST
  delete process.env.VITEST
  try {
    server = await vite.createServer({
      root: FIXTURE, configFile: false, logLevel: 'silent', clearScreen: false,
      plugins: [sygnal({ check: false, mcp: { confirm: 'page' } })],
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
  } finally {
    if (saved !== undefined) process.env.VITEST = saved
  }
  await server.listen()
  base = `http://localhost:${server.httpServer.address().port}`
}, 60000)

afterAll(async () => {
  await server?.close()
  // the links point back at the repo: don't leave a loop for tools that walk the tree
  fs.rmSync(path.join(FIXTURE, 'node_modules'), { recursive: true, force: true })
})

describe('sygnal({ mcp: true }) on a dev server', () => {
  it('initialize and tools/list over HTTP', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(init.status).toBe(200)
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-11-25', serverInfo: { name: 'sygnal-dev' } })
    const note = await fetch(base + '/__sygnal/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    expect(note.status).toBe(202)
    const names = (await rpc('tools/list')).body.result.tools.map((t) => t.name)
    expect(names).toEqual(['get_state', 'dispatch', 'component_tree', 'recent_actions', 'get_diagnostics', 'copy_as_test', 'agent_tools', 'apps', 'tabs', 'check', 'graph', 'explain'])
  })

  it('refuses a foreign Origin and a rebound Host (403)', async () => {
    expect((await rpc('ping', undefined, { origin: 'https://evil.example' })).status).toBe(403)
    const status = await new Promise((resolve, reject) => {
      const q = http.request(base + '/__sygnal/mcp', { method: 'POST', headers: { host: 'rebind.example', 'content-type': 'application/json' } }, (r) => { r.resume(); resolve(r.statusCode) })
      q.on('error', reject)
      q.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }))
    })
    expect(status).toBe(403)
  })
})

it('has at least Chromium cached', () => expect(engines).toContain('chromium'))

describe.each(engines)('the open page in %s', (engine) => {
  let browser, page
  beforeAll(async () => {
    browser = await pw[engine].launch({ headless: true })
    page = await browser.newPage()
    page.on('dialog', (d) => d.accept()) // the consequential tool's confirm: the person says yes
    await page.goto(base + '/')
    await page.waitForSelector('.count')
    await page.waitForSelector('.badge')
  }, 60000)
  afterAll(async () => {
    await browser?.close()
    // the next engine starts with no tab of this one
    await vi.waitFor(async () => expect((await tool('tabs')).tabs.length).toBe(0), { timeout: 15000, interval: 100 })
  }, 30000)

  it('get_state and dispatch reach the live page', async () => {
    // the page may still be reconnecting after Vite's first dependency optimization
    await vi.waitFor(async () => expect((await tool('tabs')).tabs.length).toBeGreaterThan(0), { timeout: 15000, interval: 100 })
    const s = await vi.waitFor(() => tool('get_state'), { timeout: 15000, interval: 100 })
    expect(s).toMatchObject({ component: 'App', state: { count: 0 }, tab: { url: base + '/', title: 'MCP fixture' } })
    const d = await tool('dispatch', { action: 'INC' })
    expect(d).toMatchObject({ ok: true, changed: true, state: { count: 1 } })
    expect(await page.textContent('.count')).toBe('1')
    const log = await tool('recent_actions', { cause: 'agent' })
    expect(log.actions.map((a) => a.type)).toEqual(['INC'])
  })

  it('agent_tools lists and calls the page\'s own tools; a consequential one asks in the page', async () => {
    const { tools } = await tool('agent_tools')
    expect(tools.map((t) => t.name)).toEqual(['todos_read', 'todos_add', 'todos_clear'])
    expect(await tool('agent_tools', { call: 'todos_add', input: { value: 'buy milk' } })).toMatchObject({ ok: true })
    expect((await tool('get_state', { path: 'todos.1.text' })).state).toBe('buy milk')
    expect(await page.textContent('ul')).toContain('buy milk')
    expect(await tool('agent_tools', { call: 'todos_clear' })).toMatchObject({ ok: true })
    expect((await tool('get_state', { path: 'todos' })).state).toEqual([])
  })

  it('get_diagnostics, component_tree, copy_as_test, and sygnal-check\'s explain', async () => {
    const diags = await tool('get_diagnostics')
    expect(diags.diagnostics.length).toBeGreaterThan(0)
    for (const d of diags.diagnostics) expect(d.docsUrl).toMatch(/^https:\/\/sygnal\.js\.org\/reference\/errors#syg\d{3}$/)
    const tree = await tool('component_tree')
    expect(tree.components.map((c) => c.name)).toContain('App')
    const test = await tool('copy_as_test', { componentImport: './App.jsx' })
    expect(test.code).toContain("import App from './App.jsx'")
    const e = await tool('explain', { code: 'SYG102' })
    expect(e).toMatchObject({ code: 'SYG102', docsUrl: expect.stringContaining('syg102') })
  })

  it('a second tab: the most recent one answers, and the result says which; `tab` picks', async () => {
    const second = await browser.newPage()
    try {
      await second.goto(base + '/?second')
      await second.waitForSelector('.count')
      await vi.waitFor(async () => expect((await tool('tabs')).tabs.length).toBe(2), { timeout: 10000, interval: 100 })
      const s = await tool('get_state')
      expect(s.tab.url).toBe(base + '/?second')
      expect(s.state.count).toBe(0)
      expect(s.tabNote).toMatch(/2 tabs are open/)
      const first = (await tool('tabs')).tabs.find((t) => t.url === base + '/')
      expect((await tool('get_state', { tab: first.id })).state.count).toBe(1)
    } finally {
      await second.close()
    }
    await vi.waitFor(async () => expect((await tool('tabs')).tabs.length).toBe(1), { timeout: 10000, interval: 100 })
  })

  it('G-638: both run() apps are served; tabs lists them; `app` picks one', async () => {
    const { tabs } = await tool('tabs')
    expect(tabs[0].apps).toEqual([{ index: 0, component: 'App' }, { index: 1, component: 'Badge' }])
    expect((await tool('apps')).apps.map((a) => a.component)).toEqual(['App', 'Badge'])
    expect(await tool('get_state', { app: 'Badge' })).toMatchObject({ component: 'Badge', state: { label: 'new' } })
    expect(await tool('dispatch', { app: 1, action: 'SET', data: 'hot' })).toMatchObject({ ok: true, state: { label: 'hot' } })
    expect(await page.textContent('.badge')).toBe('hot')
    // the default is still the first app
    expect((await tool('get_state')).component).toBe('App')
  })

  // G-655: the official SDK's client (@modelcontextprotocol/client, exact devDependency) pinned to
  // the stateless 2026-07-28 revision (no fallback), and in its default 2025 initialize mode
  it.each([
    ['2026-07-28 only', { mode: { pin: '2026-07-28' } }, 'modern', 'cold'],
    ['legacy initialize', undefined, 'legacy', 'warm'],
  ])('G-655: the SDK client, %s, reads and changes the live page', async (_, versionNegotiation, era, label) => {
    const client = new Client({ name: 'g655-e2e', version: '1.0.0' }, versionNegotiation ? { versionNegotiation } : {})
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/__sygnal/mcp')))
    try {
      expect(client.getProtocolEra()).toBe(era)
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['get_state', 'dispatch', 'tabs', 'explain']))
      const r = await client.callTool({ name: 'dispatch', arguments: { app: 'Badge', action: 'SET', data: label } })
      expect(r.isError).toBe(false)
      expect(r.structuredContent).toMatchObject({ ok: true, state: { label }, tab: { url: base + '/' } })
      expect(await page.textContent('.badge')).toBe(label)
      expect((await client.callTool({ name: 'explain', arguments: { code: 'SYG102' } })).isError).toBeFalsy()
    } finally {
      await client.close()
    }
  })
})

describe('a production build', () => {
  it('contains no MCP code (no endpoint client, no page bridge)', async () => {
    linkFixture()
    const vite = await kanbanVite()
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-mcp-build-'))
    try {
      await vite.build({ root: FIXTURE, configFile: false, logLevel: 'silent', plugins: [sygnal({ check: false, mcp: true })], build: { outDir, emptyOutDir: true } })
      const assets = path.join(outDir, 'assets')
      const code = fs.readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n')
      expect(code).toContain('water plants')
      for (const m of ['sygnal:mcp', 'installMcpBridge', '__SYGNAL_DEVTOOLS_PAGE__']) expect(code).not.toContain(m)
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  }, 60000)
})
