// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
// B-023: the EVENTS emitter stamp names the component that emitted, not the root.
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { Collection } from '../../src/collection.js'
import { wait, track, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

function Item({ state }) { return h('li', null, h('button', { className: 'ping' }, String(state.id))) }
Item.intent = ({ DOM }) => ({ PING: DOM.click('.ping') })
Item.model = { PING: { EVENTS: s => ({ type: 'PINGED', data: s.id }) } }

function Panel() { return h('div', null, h('button', { className: 'hello' }, 'hi')) }
Panel.intent = ({ DOM }) => ({ HELLO: DOM.click('.hello') })
Panel.model = { HELLO: { EVENTS: () => ({ type: 'HELLO', data: 1 }) } }

function App({ state }) {
  return h('main', null, h(Collection, { of: Item, from: 'items' }), h(Panel, { state: 'panel' }))
}
App.initialState = { items: [{ id: 1 }], panel: {}, n: 0 }
App.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('PINGED') })
App.model = { GOT: { STATE: s => ({ ...s, n: s.n + 1 }), EVENTS: () => ({ type: 'ROOT_EV', data: 0 }) } }

describe('B-023: EVENTS emitter stamp', () => {
  // R5 (D165, PLAN-4.6 §5): FIFO run-to-completion: the PING action's EVENTS cascade (App's GOT
  // and its ROOT_EV) finishes before the next simulated input (HELLO) is handled
  it('onBusEmit and the sink value name the emitting component', async () => {
    const seen = []
    track({ onBusEmit(type, emitter) { seen.push(`${type}:${emitter}`) } })
    const t = renderComponent(App)
    await t.ready()
    await wait(30)
    t.simulateEvent('.ping', 'click')
    t.simulateEvent('.hello', 'click')
    await t.waitForState(s => s.n === 1)
    await wait(20)
    expect(seen).toEqual(['PINGED:Item', 'ROOT_EV:App', 'HELLO:Panel'])
    const raw = []
    t.sinks.EVENTS.addListener({ next: v => raw.push(v.__emitterName) })
    t.simulateEvent('.hello', 'click')
    await wait(20)
    expect(raw).toEqual(['Panel'])
    // the stamps stay non-enumerable (G-020)
    expect(t.emitted.at(-1)).toEqual({ type: 'HELLO', data: 1 })
    t.dispose()
  })
})
