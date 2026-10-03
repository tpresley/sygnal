// @vitest-environment jsdom
// PLAN-3 1-G (G-143), real DOM: the canonical Escape-key pattern receives native keydown events
// on document, and SYG421 names the dataset key the DOM driver would throw a bare DOMException for.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupChecks, diagnostics, settle } from './helpers.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'
import { until } from '../support/wait.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null; vi.restoreAllMocks() })

describe('G-143 with a real DOM', () => {
  it("DOM.keydown('document').key().filter(k => k === 'Escape') receives native keydown events", async () => {
    function Modal({ state }) { return createElement('div', null, state.open ? 'open' : 'closed') }
    Modal.initialState = { open: true }
    Modal.intent = ({ DOM }) => ({ CLOSE: DOM.keydown('document').key().filter(k => k === 'Escape') })
    Modal.model = { CLOSE: s => ({ ...s, open: false }) }
    t = renderComponent(Modal, { dom: 'real' })
    await t.ready()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle(30)
    expect(t.state.open).toBe(true)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await t.waitForState(s => s.open === false)
  })

  it('SYG421 is reported before the DOMException the patch throws for an invalid dataset key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Card() { return createElement('div', { className: 'card', data: { 'task-id': 7 } }, 'x') }
    t = renderComponent(Card, { dom: 'real' })
    await t.ready().catch(() => {})
    await until(() => expect(diagnostics('SYG421')).toHaveLength(1))   // G-176: wait for the report
    await settle(30)
    const found = diagnostics('SYG421')
    expect(found).toHaveLength(1)
    expect(found[0].component).toBe('Card')
    expect(found[0].data.key).toBe('task-id')
  })
})
