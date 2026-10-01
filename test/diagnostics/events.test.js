// SYG105 — EVENTS emitted but never selected / selected but never emitted
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupChecks, diagnostics, settle, later } from './helpers.js'
import { checkEventBus } from '../../src/extra/diagnostics/checks/index.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null })

/** Emits `emitType` on a .send click and counts received `selectType` events. */
function makeBusApp(name, emitType, selectType) {
  const App = function () { return createElement('div', null, 'x') }
  Object.defineProperty(App, 'name', { value: name })
  App.initialState = { got: 0 }
  App.intent = ({ DOM, EVENTS }) => ({
    SEND: DOM.select('.send').events('click'),
    GOT: EVENTS.select(selectType),
  })
  App.model = {
    SEND: { EVENTS: () => ({ type: emitType, data: 1 }) },
    GOT: s => ({ ...s, got: s.got + 1 }),
  }
  return App
}

describe('SYG105 — EVENTS emitted but never selected', () => {
  it('reports an event nobody selects, naming the emitter and the near miss', async () => {
    t = renderComponent(makeBusApp('Emitter', 'SAVED', 'SAVE'), { mockConfig: { '.send': { click: later() } } })
    await settle(150)
    const found = diagnostics('SYG105')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('info')
    expect(found[0].component).toBe('Emitter')
    expect(found[0].data.direction).toBe('emitted-not-selected')
    expect(found[0].message).toContain("did you mean 'SAVE'")
  })

  it('does not report an event that is selected', async () => {
    t = renderComponent(makeBusApp('Emitter', 'SAVED', 'SAVED'), { mockConfig: { '.send': { click: later() } } })
    await t.waitForState(s => s && s.got === 1)
    expect(diagnostics('SYG105')).toEqual([])
    expect(checkEventBus().emittedNeverSelected).toEqual([])
  })

  it('treats EVENTS.select() with no type as selecting everything', async () => {
    t = renderComponent(makeBusApp('Emitter', 'SAVED', undefined), { mockConfig: { '.send': { click: later() } } })
    await t.waitForState(s => s && s.got === 1)
    expect(diagnostics('SYG105')).toEqual([])
  })
})

describe('SYG105 — EVENTS selected but never emitted (checkEventBus)', () => {
  it('reports selected types that were never emitted when checkEventBus() is called', async () => {
    t = renderComponent(makeBusApp('Listener', 'OTHER', 'NEVER_SENT'))
    await settle(50)
    expect(diagnostics('SYG105')).toEqual([]) // never automatic
    const summary = checkEventBus()
    expect(summary.selectedNeverEmitted).toEqual(['NEVER_SENT'])
    const found = diagnostics('SYG105')
    expect(found).toHaveLength(1)
    expect(found[0].data).toEqual({ type: 'NEVER_SENT', direction: 'selected-not-emitted' })
  })

  it('does not report selected types that were emitted', async () => {
    t = renderComponent(makeBusApp('Both', 'SAVED', ['SAVED']), { mockConfig: { '.send': { click: later() } } })
    await t.waitForState(s => s && s.got === 1)
    expect(checkEventBus().selectedNeverEmitted).toEqual([])
    expect(diagnostics('SYG105')).toEqual([])
  })
})
