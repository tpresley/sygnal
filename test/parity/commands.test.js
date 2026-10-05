// @vitest-environment jsdom
// PLAN-4.6 parity (R3): a parent's Command reaches its child's `commands$` source (the browser
// suite's Commands tests in canonical forms: those use 'A | EFFECT' keys, removed in 6.0, D164).
import { it, expect } from 'vitest'
import { parity, mount, h, click, until, api } from './harness.js'

const { createCommand } = api

parity('parity: commands$ (createCommand)', () => {
  it("select(type) gets each send()'s data; other types and the other child's channel are not seen", async () => {
    const a = createCommand(), b = createCommand()
    function Child({ state }) { return h('p', { className: state.name }, `${state.n}:${state.label}`) }
    Child.intent = ({ commands$ }) => ({ INC: commands$.select('inc'), LABEL: commands$.select('label') })
    Child.model = { INC: (s) => ({ ...s, n: s.n + 1 }), LABEL: (s, label) => ({ ...s, label }) }
    function App() {
      return h('div', null, h('button', { className: 'a' }, 'a'), h('button', { className: 'b' }, 'b'), h('button', { className: 'l' }, 'l'),
        h(Child, { commands: a, state: 'x' }), h(Child, { commands: b, state: 'y' }))
    }
    App.initialState = { x: { name: 'x', n: 0, label: '-' }, y: { name: 'y', n: 0, label: '-' } }
    App.intent = ({ DOM }) => ({ A: DOM.click('.a'), B: DOM.click('.b'), L: DOM.click('.l') })
    App.model = {
      A: { EFFECT: () => a.send('inc') },
      B: { EFFECT: () => b.send('inc') },
      L: { EFFECT: () => a.send('label', 'Hello') },
    }
    const m = mount(App)
    await until(() => expect(m.text('.x')).toBe('0:-'))
    click(m.$('.a')); click(m.$('.a')); click(m.$('.b')); click(m.$('.l'))
    await until(() => expect([m.text('.x'), m.text('.y')]).toEqual(['2:Hello', '1:-']))
  })
}, 'R3')
