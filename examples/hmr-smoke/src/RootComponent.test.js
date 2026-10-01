import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
import { renderComponent, createElement } from 'sygnal'
import 'sygnal/diagnostics'
import RootComponent from './RootComponent.jsx'

// The root `npx vitest` also collects this file, without this example's Vite
// config (no Sygnal JSX transform), so the .jsx view compiles to classic
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

let t
afterEach(() => t?.dispose())

describe('RootComponent', () => {
  it('counts clicks, with no diagnostics in strict mode', async () => {
    t = renderComponent(RootComponent, { strict: true })
    t.simulateEvent('.increment-button', 'click')
    t.simulateEvent('.increment-button', 'click')
    t.simulateEvent('.increment-button', 'click')
    await t.waitForState(s => s.count === 3)
    expect(t.html()).toContain('<strong>3</strong>')
    t.expectNoDiagnostics()
  })
})
