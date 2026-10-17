// @vitest-environment jsdom
// PLAN-10 P-1: the devtools panel's App graph view (devtools/panel.js AppGraphView), the frame files
// devtools/build.mjs writes from sygnal-check's graph page (devtools/graph-files.mjs), and the
// bridge's GET_GRAPH answer (src/extra/devtools.ts). The frame files: p10-devtools-graph-files.test.js
// (Node: Vite rewrites html.js's `new URL(…, import.meta.url)` under jsdom). The real-browser run (the
// built frame with a running app) is in browser-tests/graph-view-runtime.mjs.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SygnalDevTools } from '../src/extra/devtools.js'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'devtools')
const PAGE = '__SYGNAL_DEVTOOLS_PAGE__'

describe('P-1: the bridge answers GET_GRAPH', () => {
  it('posts inspect({ actions: 200 }) as GRAPH, or why not', () => {
    const dt = new SygnalDevTools()
    const posted = []
    dt._post = (type, payload) => posted.push({ type, payload })
    dt._handleExtensionMessage({ type: 'GET_GRAPH', payload: {} })
    expect(posted.pop()).toEqual({ type: 'GRAPH', payload: { graph: null, reason: 'no-diagnostics' } })
    const calls = []
    dt.inspect = (o) => { calls.push(o); return { version: 1, source: 'runtime', components: [], events: {}, diagnostics: [], fn: () => 1 } }
    dt._handleExtensionMessage({ type: 'GET_GRAPH', payload: { actions: 50 } })
    expect(calls).toEqual([{ actions: 50 }])
    expect(posted.pop()).toEqual({ type: 'GRAPH', payload: { graph: { version: 1, source: 'runtime', components: [], events: {}, diagnostics: [] } } })
    dt.inspect = () => { throw new Error('boom') }
    dt._handleExtensionMessage({ type: 'GET_GRAPH' })
    expect(posted.pop()).toEqual({ type: 'GRAPH', payload: { graph: null, reason: 'error', message: 'boom' } })
  })
})

describe('P-1: the panel\'s App graph view', () => {
  let panel, deliver
  const sent = []
  beforeAll(() => {
    const html = fs.readFileSync(path.join(DIR, 'panel.html'), 'utf8')
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'))
    globalThis.chrome = {
      runtime: {
        connect: () => ({
          postMessage: (m) => sent.push(m),
          onMessage: { addListener: (fn) => { deliver = (type, payload) => fn({ source: PAGE, type, payload }) } },
          onDisconnect: { addListener() {} },
        }),
      },
      devtools: { inspectedWindow: { tabId: 1 } },
    }
    ;(0, eval)(fs.readFileSync(path.join(DIR, 'panel.js'), 'utf8') + '\n;globalThis.__sygnalPanel = panel')
    panel = globalThis.__sygnalPanel
  })

  const graph = (n = 2) => ({ version: 1, source: 'runtime', events: {}, diagnostics: [], components: Array.from({ length: n }, (_, i) => ({ name: 'C', id: String(i) })) })
  const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

  it('opens in place of the component view, asks for the graph, and says why when there is none', async () => {
    const btn = document.getElementById('app-graph-btn')
    btn.click()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(document.getElementById('app-graph').hidden).toBe(false)
    expect(document.querySelector('.main').hidden).toBe(true)
    expect(document.getElementById('app-graph-frame').getAttribute('src')).toBe('graph.html')
    await tick(5)
    expect(sent.filter(m => m.type === 'GET_GRAPH')).toEqual([{ type: 'GET_GRAPH', payload: { actions: 200 } }])
    deliver('GRAPH', { graph: null, reason: 'no-diagnostics' })
    expect(document.getElementById('app-graph').classList.contains('notice')).toBe(true)
    expect(document.getElementById('app-graph-notice').textContent).toMatch(/needs sygnal\/diagnostics/)
  })

  it('shows the graph through the frame bridge, fetches state on demand, pushes changes and flashes actions', async () => {
    const api = { action: vi.fn(), state: vi.fn(), host: null }
    const bridge = { show: vi.fn(() => api) }
    const frame = document.getElementById('app-graph-frame')
    frame.contentWindow.sygnalGraphFrame = bridge
    const g = graph()
    deliver('GRAPH', { graph: g })
    expect(bridge.show).toHaveBeenCalledWith(g, { title: 'App graph', subtitle: 'live · runtime inspect()' })
    expect(document.getElementById('app-graph').classList.contains('notice')).toBe(false)

    // state on demand: GET_STATE, answered by COMPONENT_STATE
    sent.length = 0
    const p = api.host.getState('1')
    expect(sent).toEqual([{ type: 'GET_STATE', payload: { componentId: 1 } }])
    deliver('COMPONENT_STATE', { componentId: 1, state: { n: 3 } })
    await expect(p).resolves.toEqual({ n: 3 })
    // a later change is pushed to the page
    deliver('STATE_CHANGED', { componentId: 1, componentName: 'C', state: { n: 4 } })
    expect(api.state).toHaveBeenCalledWith('1', { n: 4 })

    // actions flash once each (a later update of the same action doesn't), then the graph refreshes
    sent.length = 0
    deliver('ACTIONS', { actions: [{ seq: 41, type: 'INC', instance: '1' }] })
    deliver('ACTIONS', { actions: [{ seq: 41, type: 'INC', instance: '1', sinks: ['STATE'] }, { seq: 42, type: 'DEC', instance: '0' }] })
    expect(api.action.mock.calls).toEqual([[{ instance: '1', type: 'INC' }], [{ instance: '0', type: 'DEC' }]])
    // created / disposed components refresh it too, debounced into one request
    deliver('COMPONENT_CREATED', { id: 9, name: 'D' })
    deliver('COMPONENT_DISPOSED', { componentId: 9 })
    await tick(200)
    expect(sent.filter(m => m.type === 'GET_GRAPH')).toHaveLength(1)
    // the next graph replaces the shown one through the same bridge
    deliver('GRAPH', { graph: graph(3) })
    expect(bridge.show).toHaveBeenCalledTimes(2)
  })

  it('an empty app says so; closing shows the component view again and stops refreshing', async () => {
    deliver('GRAPH', { graph: graph(0) })
    expect(document.getElementById('app-graph-notice').textContent).toBe('No live components on the page.')
    document.getElementById('app-graph-btn').click()
    expect(document.querySelector('.main').hidden).toBe(false)
    expect(document.getElementById('app-graph').hidden).toBe(true)
    sent.length = 0
    deliver('COMPONENT_CREATED', { id: 10, name: 'E' })
    await tick(200)
    expect(sent.filter(m => m.type === 'GET_GRAPH')).toEqual([])
  })
})
