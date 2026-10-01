import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import 'sygnal/diagnostics'
import RootComponent from './RootComponent.jsx'

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
