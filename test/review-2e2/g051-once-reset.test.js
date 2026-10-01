// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { wait, track, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

// ─── G-051: check dedupe is reset per outermost renderComponent ──────────────

describe('G-051: once() dedupe is reset when an outermost renderComponent starts', () => {
  function Bad() { return h('div', null, 'x') }
  Bad.initialState = {}
  Bad.intent = ({ DOM }) => ({ CLICK: DOM.click('.x') })
  Bad.model = { CLICKED: s => s }

  it('a second instance still reports the finding', async () => {
    for (let i = 0; i < 2; i++) {
      const t = renderComponent(Bad)
      await t.ready()
      expect(t.diagnostics.map(d => d.code)).toContain('SYG101')
      expect(() => t.expectNoDiagnostics()).toThrow(/SYG101/)
      t.dispose()
    }
  })

  it("does not wipe inspect()'s records of another live instance", async () => {
    function Live() { return h('div', null, 'live') }
    Live.initialState = {}
    const outer = renderComponent(Live)
    await outer.ready()
    const t = renderComponent(Bad)
    await t.ready()
    t.dispose()
    expect(outer.inspect().components.map(c => c.name)).toEqual(['Live'])
    outer.dispose()
  })
})
