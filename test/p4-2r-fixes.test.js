// @vitest-environment jsdom
// PLAN-4 2-R: fixes from the Phase 1+2 code review (G-214) and queued small items.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { ABORT } from '../src/index.js'
import { defineBehavior } from '../src/extra/behaviors.js'
import { undoable } from '../src/extra/undo.js'
import { setupChecks, settle } from './diagnostics/helpers.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
beforeEach(() => { setupChecks() })
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; _resetDiagnostics() })

describe('G-214 (1): constant sink values in a behavior model entry', () => {
  it('a constant is sent as is, `true` passes the data through, a constant EFFECT is ignored (as in the core)', async () => {
    const b = defineBehavior({
      initialState: { open: true },
      model: {
        CLOSE: { STATE: (s) => ({ ...s, open: false }), PARENT: 'closed', EFFECT: true },
        PICK: { PARENT: true },
        SET: { STATE: true },
      },
    })
    function C({ state }) { return h('div', null, String(state.d.open)) }
    C.uses = { d: b() }
    C.model = { 'd.PICK': { EFFECT: true } }   // a host constant for a behavior action
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('d.CLOSE'); await t.next(s => s.d.open === false)
    t.simulateAction('d.PICK', 7); await settle(30)
    expect(t.sinkValues('PARENT').map(v => v?.value ?? v)).toEqual(['closed', 7])
    t.simulateAction('d.SET', { open: 'yes' }); await t.next(s => s.d.open === 'yes')
    expect(t.state.d).toEqual({ open: 'yes' })
    t.expectNoDiagnostics()
  })

  it('undoable() leaves an entry with a constant STATE value alone and keeps constant sinks', async () => {
    const model = undoable({ A: { STATE: (s) => ({ ...s, doc: s.doc + 1 }), PARENT: 'a' }, B: { PARENT: true }, UNDO: { PARENT: 'u' }, K: { STATE: 5 } }, { key: 'doc' })
    expect(model.K).toEqual({ STATE: 5 })
    expect(model.A.PARENT).toBe('a')
    expect(model.B).toEqual({ PARENT: true })
    function C({ state }) { return h('div', null, String(state.doc)) }
    C.initialState = { doc: 0 }
    C.model = model
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('A'); await t.next(s => s.doc === 1)
    t.simulateAction('B', 'x'); await settle(30)
    t.simulateAction('UNDO'); await t.next(s => s.doc === 0)
    expect(t.sinkValues('PARENT').map(v => v?.value ?? v)).toEqual(['a', 'x', 'u'])
  })
})
