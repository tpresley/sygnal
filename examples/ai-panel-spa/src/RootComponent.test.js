import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { renderComponent, createElement, xs } from 'sygnal'
import 'sygnal/diagnostics'
import RootComponent from './RootComponent.jsx'

// The root `npx vitest` also collects this file, without this example's Vite
// config (no Sygnal JSX transform), so the .jsx views compile to classic
// React.createElement calls there. Point those at Sygnal's createElement.
let reactShim = false
beforeAll(() => {
  if (typeof globalThis.React === 'undefined') {
    globalThis.React = { createElement }
    reactShim = true
  }
})
afterAll(() => {
  if (reactShim) delete globalThis.React
})

// In-memory stand-ins for the app's KINDO, STORAGE and CLIPBOARD drivers
function mockDrivers(stored = {}) {
  const requests = []
  const writes = []
  const responses$ = xs.create()
  const KINDO = (fromApp$) => {
    fromApp$.addListener({ next: r => requests.push(r), error: () => {}, complete: () => {} })
    return { select: type => responses$.filter(e => e?.type === type) }
  }
  const STORAGE = (fx$) => {
    fx$.addListener({ next: w => writes.push(w), error: () => {}, complete: () => {} })
    return { get: (key, fallback) => xs.of(key in stored ? stored[key] : fallback) }
  }
  const CLIPBOARD = (fromApp$) => {
    fromApp$.addListener({ next: () => {}, error: () => {}, complete: () => {} })
    return {}
  }
  const respond = (event) => responses$.shamefullySendNext(event)
  return { drivers: { KINDO, STORAGE, CLIPBOARD }, requests, writes, respond }
}

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))

let t
afterEach(() => t?.dispose())

describe('RootComponent (smoke)', () => {
  it('drives setup, drawers and a failed run, with no diagnostics in strict mode', async () => {
    const mock = mockDrivers({ 'sygnal.aiPanel.model': 'test-model' })
    t = renderComponent(RootComponent, { drivers: mock.drivers, strict: true })
    await t.waitForState(s => s.model === 'test-model')

    // Drawers: opening the debug log closes history
    t.simulateEvent('.history-toggle', 'click')
    await t.waitForState(s => s.historyOpen)
    t.simulateEvent('.debug-toggle', 'click')
    await t.waitForState(s => s.debugOpen && !s.historyOpen)

    // Starting without an API key fails validation
    t.simulateEvent('.start-run', 'click')
    await t.waitForState(s => s.error === 'API key is required.')

    t.simulateEvent('.api-key-input', 'input', { value: 'test-key' })
    t.simulateEvent('.topic-input', 'input', { value: 'Tabs or spaces?' })
    await t.waitForState(s => s.apiKey === 'test-key' && s.topic === 'Tabs or spaces?')
    expect(mock.writes).toContainEqual({ key: 'sygnal.aiPanel.apiKey', value: 'test-key' })

    // Start: SetupCard sends the analysis request on KINDO
    t.simulateEvent('.start-run', 'click')
    await t.waitForState(s => s.phase === 'analyzing' && s.activeRunId === 1)
    await tick()
    expect(mock.requests.map(r => [r.kind, r.runId])).toEqual([['analyze-topic', 1]])

    // A response for another run is ignored (ABORT: no new state)
    const before = t.states.length
    mock.respond({ type: 'success', request: { kind: 'analyze-topic', runId: 99 }, response: {} })
    mock.respond({ type: 'error', request: { kind: 'analyze-topic', runId: 99 }, error: 'stale' })
    await tick()
    expect(t.states.length).toBe(before)

    // An error for the active run ends it
    mock.respond({ type: 'error', request: { kind: 'analyze-topic', runId: 1 }, error: 'boom' })
    const failed = await t.waitForState(s => s.phase === 'error')
    expect(failed.error).toBe('analyze-topic: boom')
    await tick() // child components (SetupCard) render after the root
    expect(t.html()).toContain('analyze-topic: boom')

    t.expectNoDiagnostics()
  })
})
