// @vitest-environment jsdom
// G-224: the runtime SYG102 heuristic counts the action names a `timers` static declares
// (`action: 'TICK'`, `frame: 'FRAME'`) as triggers, as sygnal-check does, so the dev entry
// doesn't report a timer action as "no intent trigger" under run().
import { it, expect, beforeEach, describe } from 'vitest'
import { onIntent, onModel } from '../src/extra/diagnostics/index.js'
import { replyNamesOf } from '../src/extra/diagnostics/checks/shared.js'
import { setupChecks, diagnostics } from './diagnostics/helpers.js'

beforeEach(() => setupChecks())

describe('G-224: timer actions are SYG102 triggers', () => {
  it('reads every / after / frame actions from the timers function', () => {
    const view = () => null
    view.timers = (state) => ({
      tick: state.running && { every: 100, action: 'TICK' },
      done: state.armed && { after: 5000, "action": "EXPIRE", background: true },
      anim: state.animating && { frame: `FRAME` },
    })
    expect([...replyNamesOf({ view, model: {} })].sort()).toEqual(['EXPIRE', 'FRAME', 'TICK'])
  })

  it('reports only the model entries nothing triggers', () => {
    const view = () => null
    view.timers = (state) => ({ tick: state.running && { every: 100, action: 'TICK' }, anim: { frame: 'FRAME' } })
    const component = { name: 'Watch', view, intent$: {}, model: { TICK: () => ({}), FRAME: () => ({}), ORPHAN: () => ({}) } }
    onIntent(component, [], undefined)
    onModel(component, { TICK: ['STATE'], FRAME: ['STATE'], ORPHAN: ['STATE'] })
    expect(diagnostics('SYG102').map(d => d.data.action)).toEqual(['ORPHAN'])
  })
})
