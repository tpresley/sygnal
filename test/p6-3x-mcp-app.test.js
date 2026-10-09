// @vitest-environment jsdom
// PLAN-6 3-X (X-1): makeMcpAppDriver (src/extra/ai/mcpApp.ts) against the real host side of the
// MCP Apps SDK (@modelcontextprotocol/ext-apps/app-bridge, a devDependency only, D209), wired
// through a postMessage pair: the driver's `host` posts into the bridge's transport, the bridge's
// transport dispatches 'message' events with `source: host` on the driver's `window`. Messages are
// structured-cloned and delivered a microtask later, as postMessage does. No network.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { makeMcpAppDriver, jsonSchema, agentTools } from '../src/index.js'
import * as ai from '../src/ai.ts'

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms))
let app, bridge
afterEach(async () => {
  try { app?.dispose() } catch (_) {}
  try { await bridge?.close() } catch (_) {}
  app = bridge = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

/** a postMessage pair: { host, win } for the driver, a Transport for the AppBridge; `wire` logs both ways */
function pair() {
  const listeners = new Set(), wire = []
  const win = {
    addEventListener: (t, f) => t == 'message' && listeners.add(f),
    removeEventListener: (t, f) => listeners.delete(f),
  }
  const transport = {
    async start() {},
    async close() { this.onclose?.() },
    async send(m) {
      const data = structuredClone(m)
      wire.push(['host→view', data])
      queueMicrotask(() => listeners.forEach((f) => f({ data, source: host })))
    },
  }
  const host = {
    postMessage(m, origin) {
      expect(origin).toBe('*')
      const data = structuredClone(m)
      wire.push(['view→host', data])
      queueMicrotask(() => transport.onmessage?.(data))
    },
  }
  return { host, win, transport, wire, listeners }
}

async function connect(opts = {}, hostContext = { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] }) {
  const p = pair()
  bridge = new AppBridge(null, { name: 'test-host', version: '1.0.0' }, { openLinks: {}, serverTools: {}, updateModelContext: { structuredContent: {} }, message: { text: {} } }, { hostContext })
  const initialized = new Promise((r) => { bridge.oninitialized = r })
  await bridge.connect(p.transport)
  return { ...p, initialized, opts: { host: p.host, window: p.win, autoResize: false, ...opts } }
}

const mount = (C, drivers) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(C, drivers, { diagnostics: 'off' })
  return sleep()
}

describe('makeMcpAppDriver (X-1)', () => {
  it('is exported from sygnal/ai', () => {
    expect(ai.makeMcpAppDriver).toBe(makeMcpAppDriver)
  })

  it('does the ui/initialize handshake with the SDK host and reports appInfo and capabilities', async () => {
    const c = await connect()
    const driver = makeMcpAppDriver({ ...c.opts, appInfo: { name: 'weather', version: '1.2.3' }, availableDisplayModes: ['inline', 'fullscreen'] })
    const { default: xs } = await import('xstream')
    const src = driver(xs.never())
    await c.initialized
    expect(bridge.getAppVersion()).toEqual({ name: 'weather', version: '1.2.3' })
    expect(bridge.getAppCapabilities()).toEqual({ availableDisplayModes: ['inline', 'fullscreen'] })
    const init = c.wire.find(([d, m]) => d == 'view→host' && m.method == 'ui/initialize')[1]
    expect(init.params.protocolVersion).toBe('2026-01-26')
    expect(c.wire.map(([d, m]) => [d, m.method ?? 'result'])).toEqual([
      ['view→host', 'ui/initialize'], ['host→view', 'result'], ['view→host', 'ui/notifications/initialized'],
    ])
    src.dispose()
    expect(c.listeners.size).toBe(0)
  })

  it('sources: tool-input, tool-input-partial, tool-result, tool-cancelled, host-context-changed (merged, replayed)', async () => {
    const c = await connect()
    const seen = []
    function View({ state }) { return h('div', {}, String(state.n)) }
    View.initialState = { n: 0 }
    View.intent = ({ MCP }) => ({
      INPUT: MCP.select('tool-input'),
      PARTIAL: MCP.select('tool-input-partial'),
      RESULT: MCP.select('tool-result'),
      CANCEL: MCP.select('tool-cancelled'),
      CTX: MCP.select('host-context-changed'),
    })
    View.model = Object.fromEntries(['INPUT', 'PARTIAL', 'RESULT', 'CANCEL', 'CTX'].map((k) => [k, (s, d) => { seen.push([k, d]); return { n: s.n + 1 } }]))
    await mount(View, { MCP: makeMcpAppDriver(c.opts) })
    await c.initialized
    await bridge.sendToolInputPartial({ arguments: { city: 'Par' } })
    await bridge.sendToolInput({ arguments: { city: 'Paris' } })
    await bridge.sendToolResult({ content: [{ type: 'text', text: 'ok' }], structuredContent: { days: [1, 2] } })
    await bridge.sendToolCancelled({ reason: 'user' })
    bridge.setHostContext({ theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] })
    await sleep()
    expect(seen).toEqual([
      ['CTX', { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] }],
      ['PARTIAL', { city: 'Par' }],
      ['INPUT', { city: 'Paris' }],
      ['RESULT', { content: [{ type: 'text', text: 'ok' }], structuredContent: { days: [1, 2] } }],
      ['CANCEL', { reason: 'user' }],
      ['CTX', { theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] }],
    ])
    // a stream that starts later gets the latest tool-input, tool-result and host context
    const late = []
    app.sources.MCP.select('tool-input').addListener({ next: (v) => late.push(v) })
    app.sources.MCP.select('host-context-changed').addListener({ next: (v) => late.push(v.theme) })
    app.sources.MCP.select('tool-cancelled').addListener({ next: (v) => late.push(v) })
    expect(late).toEqual([{ city: 'Paris' }, 'dark'])
  })

  it('callTool: tools/call through the host, ok / error reply actions to the sender', async () => {
    const c = await connect()
    bridge.oncalltool = async ({ name, arguments: args }) => {
      if (name == 'get_forecast') return { content: [{ type: 'text', text: 'sunny' }], structuredContent: { city: args.city, days: [{ date: 'Mon', high: 20 }] } }
      if (name == 'flaky') return { content: [{ type: 'text', text: 'upstream down' }], isError: true }
      throw new Error('no such tool')
    }
    const got = []
    function View({ state }) { return h('div', {}, [h('button', { className: 'go' }, 'go'), h('button', { className: 'flaky' }, 'f'), h('button', { className: 'bad' }, 'b'), String(state.days.length)]) }
    View.initialState = { city: 'Oslo', days: [] }
    View.intent = ({ DOM }) => ({ GO: DOM.click('.go'), FLAKY: DOM.click('.flaky'), BAD: DOM.click('.bad') })
    View.model = {
      GO: { MCP: (s) => ({ callTool: 'get_forecast', args: { city: s.city }, ok: 'RESULT', error: 'FAILED' }) },
      FLAKY: { MCP: () => ({ callTool: 'flaky', ok: 'RESULT', error: 'FAILED' }) },
      BAD: { MCP: () => ({ callTool: 'nope', error: 'FAILED' }) },
      RESULT: (s, r) => { got.push(['ok', r.structuredContent]); return { ...s, days: r.structuredContent.days } },
      FAILED: (s, e) => { got.push(['error', e.error, e.result?.isError ?? e.code, e.request.callTool]); return s },
    }
    await mount(View, { MCP: makeMcpAppDriver(c.opts) })
    // sent before the handshake completes: queued
    document.querySelector('.go').click()
    await c.initialized
    await sleep()
    document.querySelector('.flaky').click()
    await sleep()
    document.querySelector('.bad').click()
    await sleep()
    expect(got[0]).toEqual(['ok', { city: 'Oslo', days: [{ date: 'Mon', high: 20 }] }])
    expect(got[1]).toEqual(['error', 'upstream down', true, 'flaky'])
    expect(got[2][0]).toBe('error')
    expect(got[2][1]).toMatch(/no such tool/)
    expect(typeof got[2][2]).toBe('number')
    expect(document.querySelector('#root').textContent).toContain('1')
    const order = c.wire.filter(([d]) => d == 'view→host').map(([, m]) => m.method)
    expect(order.slice(0, 3)).toEqual(['ui/initialize', 'ui/notifications/initialized', 'tools/call'])
  })

  it('updateModelContext, message, openLink, displayMode reach the host in the spec shapes', async () => {
    const c = await connect()
    const host = []
    bridge.onupdatemodelcontext = async (p) => { host.push(['ctx', p]); return {} }
    bridge.onmessage = async (p) => { host.push(['msg', p]); return {} }
    bridge.onopenlink = async (p) => { host.push(['link', p]); return {} }
    bridge.onrequestdisplaymode = async (p) => { host.push(['mode', p]); return { mode: 'fullscreen' } }
    const replies = []
    function View() { return h('div', {}, h('button', { className: 'x' }, 'x')) }
    View.initialState = {}
    View.intent = ({ DOM }) => ({ X: DOM.click('.x') })
    // one request per action, each sent from the previous one's ok reply
    View.model = {
      X: { MCP: () => ({ updateModelContext: { selectedDay: 'Mon' }, ok: 'NEXT1' }) },
      NEXT1: { MCP: () => ({ updateModelContext: 'The user picked Monday', ok: 'NEXT2' }) },
      NEXT2: { MCP: () => ({ updateModelContext: { content: 'note', structuredContent: { a: 1 } }, ok: 'NEXT3' }) },
      NEXT3: { MCP: () => ({ message: 'Show me Tuesday', ok: 'NEXT4' }) },
      NEXT4: { MCP: () => ({ openLink: 'https://example.com/forecast', ok: 'NEXT5' }) },
      NEXT5: { MCP: () => ({ displayMode: 'fullscreen', ok: 'MODE' }) },
      MODE: (s, r) => { replies.push(r); return s },
    }
    await mount(View, { MCP: makeMcpAppDriver(c.opts) })
    await c.initialized
    document.querySelector('.x').click()
    await sleep(10)
    expect(host).toEqual([
      ['ctx', { structuredContent: { selectedDay: 'Mon' } }],
      ['ctx', { content: [{ type: 'text', text: 'The user picked Monday' }] }],
      ['ctx', { content: [{ type: 'text', text: 'note' }], structuredContent: { a: 1 } }],
      ['msg', { role: 'user', content: [{ type: 'text', text: 'Show me Tuesday' }] }],
      ['link', { url: 'https://example.com/forecast' }],
      ['mode', { mode: 'fullscreen' }],
    ])
    expect(replies).toEqual([{ mode: 'fullscreen' }])
  })

  it('teardown: emitted, answered after the actions it caused (their requests are sent first)', async () => {
    const c = await connect()
    const host = []
    bridge.onupdatemodelcontext = async (p) => { host.push(p.structuredContent); return {} }
    function View() { return h('div', {}, 'x') }
    View.intent = ({ MCP }) => ({ BYE: MCP.select('teardown') })
    View.model = { BYE: { MCP: () => ({ updateModelContext: { saved: true } }) } }
    await mount(View, { MCP: makeMcpAppDriver(c.opts) })
    await c.initialized
    const r = await bridge.teardownResource({})
    expect(r).toEqual({})
    const sent = c.wire.filter(([d]) => d == 'view→host').map(([, m]) => m.method ?? 'result')
    expect(sent.slice(-2)).toEqual(['ui/update-model-context', 'result'])
  })

  it('answers ping, and -32601 for a method it does not serve', async () => {
    const c = await connect()
    const { default: xs } = await import('xstream')
    const src = makeMcpAppDriver(c.opts)(xs.never())
    await c.initialized
    c.listeners.forEach((f) => f({ data: { jsonrpc: '2.0', id: 900, method: 'ping' }, source: c.host }))
    c.listeners.forEach((f) => f({ data: { jsonrpc: '2.0', id: 901, method: 'tools/list' }, source: c.host }))
    // a message from another window is ignored
    c.listeners.forEach((f) => f({ data: { jsonrpc: '2.0', id: 902, method: 'ping' }, source: {} }))
    await sleep()
    const answers = c.wire.filter(([d, m]) => d == 'view→host' && m.id >= 900).map(([, m]) => m)
    expect(answers).toEqual([{ jsonrpc: '2.0', id: 900, result: {} }, { jsonrpc: '2.0', id: 901, error: { code: -32601, message: 'Method not found: tools/list' } }])
    src.dispose()
  })

  it('agent: the view\'s A-1 tools are its MCP tools (tools/list, tools/call, list_changed)', async () => {
    const c = await connect()
    function Counter({ state }) { return h('div', {}, String(state.count)) }
    Counter.initialState = { count: 0 }
    Counter.model = { ADD: (s, n) => ({ count: s.count + (n?.by ?? 1) }) }
    Counter.agent = { name: 'counter', read: (s) => ({ count: s.count }), actions: { ADD: { description: 'Add to the counter', input: jsonSchema({ type: 'object', properties: { by: { type: 'number' } }, required: ['by'] }) } } }
    await mount(Counter, { MCP: makeMcpAppDriver({ ...c.opts, tools: agentTools }) })
    await c.initialized
    expect(bridge.getAppCapabilities()).toEqual({ tools: { listChanged: true } })
    const { tools } = await bridge.listTools({})
    expect(tools.map((t) => t.name).sort()).toContain('counter_add')
    const r = await bridge.callTool({ name: 'counter_add', arguments: { by: 3 } })
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent.ok).toBe(true)
    expect(document.querySelector('#root').textContent).toBe('3')
    const bad = await bridge.callTool({ name: 'counter_add', arguments: { by: 'x' } })
    expect(bad.isError).toBe(true)
    await sleep()
    // the tools didn't change (only the read context did): no list_changed
    expect(c.wire.some(([, m]) => m.method == 'notifications/tools/list_changed')).toBe(false)
  })

  it('without a host: requests get their error action, nothing is posted', async () => {
    const errs = []
    function View() { return h('div', {}, h('button', { className: 'x' }, 'x')) }
    View.initialState = {}
    View.intent = ({ DOM }) => ({ X: DOM.click('.x') })
    View.model = { X: { MCP: () => ({ callTool: 'a', error: 'E' }) }, E: (s, e) => { errs.push(e.error); return s } }
    // jsdom's top window: window.parent === window
    await mount(View, { MCP: makeMcpAppDriver() })
    document.querySelector('.x').click()
    await sleep()
    expect(errs).toEqual(['not running in an MCP Apps host'])
  })

  it('autoResize: reports the document size after the handshake', async () => {
    const c = await connect()
    const sizes = []
    bridge.onsizechange = (p) => sizes.push(p)
    let cb
    globalThis.ResizeObserver = class { constructor(f) { cb = f } observe() {} disconnect() {} }
    try {
      const { default: xs } = await import('xstream')
      const src = makeMcpAppDriver({ ...c.opts, autoResize: true })(xs.never())
      await c.initialized
      await sleep(30)
      expect(sizes.length).toBe(1)
      expect(typeof sizes[0].width).toBe('number')
      cb()
      await sleep(30)
      expect(sizes.length).toBe(1) // unchanged size: not sent again
      src.dispose()
    } finally { delete globalThis.ResizeObserver }
  })
})
