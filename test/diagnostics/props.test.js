// SYG106 — parent prop silently overwritten by a reserved view argument (G-007 item 2)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupChecks, diagnostics, settle } from './helpers.js'
import { until } from '../support/wait.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null; vi.restoreAllMocks() })

function Card({ title }) { return createElement('div', { className: 'card' }, String(title)) }

function parentRendering(childProps) {
  function Parent() { return createElement('div', null, createElement(Card, childProps)) }
  Parent.initialState = { card: { title: 'x' } }
  return Parent
}

describe('SYG106 — reserved prop names', () => {
  it('reports a prop named context / slots that the view overwrites (R5: not peers, which 6.0 no longer passes)', async () => {
    t = renderComponent(parentRendering({ title: 'a', context: 'mine', peers: 1, slots: 2 }))
    // G-176: the child reports when it is instantiated, which a loaded machine does later than a
    // fixed 120ms (and a late report then leaked into the next test): wait for it
    await until(() => expect(diagnostics('SYG106')).toHaveLength(2))
    await settle(120)
    const found = diagnostics('SYG106')
    expect(found.map(d => d.data.prop).sort()).toEqual(['context', 'slots'])
    expect(found[0].severity).toBe('warn')
    expect(found[0].component).toBe('Card')
  })

  it("reports a 'state' prop that can't be a state lens", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // Sygnal's own "invalid 'state' field" message
    t = renderComponent(parentRendering({ state: 42 }))
    await until(() => expect(diagnostics('SYG106')).toHaveLength(1))
    await settle(120)
    const found = diagnostics('SYG106')
    expect(found).toHaveLength(1)
    expect(found[0].data).toEqual({ prop: 'state', valueType: 'number' })
  })

  it("does not report ordinary props or a state lens (state=\"field\")", async () => {
    t = renderComponent(parentRendering({ title: 'a', state: 'card', item: { id: 1 } }))
    await until(() => expect(t.html()).toContain('card'))   // the child rendered
    await settle(120)
    expect(diagnostics('SYG106')).toEqual([])
  })
})
