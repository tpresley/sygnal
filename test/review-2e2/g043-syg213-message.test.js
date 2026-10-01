// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
// G-043: SYG213's message matches the behavior: duplicate entries for one action/sink both run.
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { wait, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

describe('G-043: SYG213 message', () => {
  it('says both run, and both do', async () => {
    const ran = []
    function Dup() { return h('div', null, 'x') }
    Dup.initialState = {}
    Dup.model = {
      GO: { EFFECT: () => { ran.push('longhand') } },
      'GO | EFFECT': () => { ran.push('shorthand') },
    }
    const t = renderComponent(Dup)
    await t.ready()
    t.simulateAction('GO')
    await wait(20)
    expect(ran.sort()).toEqual(['longhand', 'shorthand'])
    const d = t.diagnostics.find(d => d.code === 'SYG213')
    expect(d.message).toBe("Duplicate model entry for action 'GO' on sink 'EFFECT'; both run")
    expect(d.message).not.toMatch(/only the last/)
    t.dispose()
  })
})
