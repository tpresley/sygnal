// @vitest-environment jsdom
// Sift (preview.4 bump): B1, a next() after a waitForState() that matched the history starts after
// the states recorded by then, not after the (older) state it returned; B2, an input on a disposed
// handle fails at the call instead of never settling.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'

function Counter({ state }) { return h('p', null, String(state.n)) }
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ n: s.n + 1 }) }

describe('B1: next() after a waitForState() that matched the history', () => {
  for (const dom of ['mock', 'real']) {
    it(`starts after the current state, not after the one returned (${dom} DOM)`, async () => {
      using t = renderComponent(Counter, dom == 'real' ? { dom: 'real' } : {})
      await t.ready()
      await t.simulateAction('INC')
      await t.simulateAction('INC')
      expect(t.state.n).toBe(2)
      // the history search returns the earliest match (documented)
      expect((await t.waitForState((s) => s.n >= 0)).n).toBe(0)
      const p = t.next((s) => s.n >= 1)
      await t.simulateAction('INC')
      expect((await p).n).toBe(3)
    })
  }

  it('a state that arrives while the matched state renders can still match', async () => {
    using t = renderComponent(Counter)
    await t.ready()
    const w = t.waitForState((s) => s.n === 1)
    t.simulateAction('INC')
    t.simulateAction('INC')
    expect((await w).n).toBe(1)
    expect((await t.next((s) => s.n === 2)).n).toBe(2)
  })
})

describe('B2: an input on a disposed handle', () => {
  for (const [name, input] of [
    ['simulateEvent', (t) => t.simulateEvent('.inc', 'click')],
    ['simulateAction', (t) => t.simulateAction('INC')],
  ]) {
    it(`${name} throws at the call`, async () => {
      const t = renderComponent(Counter)
      await t.ready()
      t.dispose()
      expect(() => input(t)).toThrow(`t.${name}() after t.dispose()`)
    })
  }
})
