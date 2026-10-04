// @vitest-environment jsdom
// PLAN-4 3-R: View Transitions follow-ups.
// - item 3 (G-228): a non-array `viewTransitions` static (`true`, a string) must not make every
//   STATE reducer throw (SYG216); the dev entry reports it (SYG645, its second cause).
// - item 6: a request isn't lost when the render it asked for takes longer than 100 ms: it is
//   consumed by the next patch, however late (a listed action whose state renders no new view
//   doesn't animate a later, unrelated patch).
import { describe, it, expect, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { makeViewTransitionDOMDriver } from '../src/extra/viewTransitions.js'
import { renderComponent } from '../src/extra/testing.js'
import { getDiagnostics, clearDiagnostics } from '../src/extra/diagnostics/index.js'
import { installChecks, resetChecks } from '../src/extra/diagnostics/checks/index.js'

installChecks()

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
  delete document.startViewTransition
  clearDiagnostics()
  resetChecks()
})

const click = (sel) => document.querySelector(sel).click()

function Counter({ state }) {
  return h('div', null, h('button', { className: 'inc' }, 'inc'), h('p', { className: 'n' }, String(state.n)))
}
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ n: s.n + 1 }) }

describe('3-R item 3 (G-228): a non-array viewTransitions static', () => {
  for (const [label, value] of [['true', true], ["a string ('INC')", 'INC'], ['an object', { INC: 1 }]]) {
    it(`${label}: reducers still run`, async () => {
      const C = Object.assign((p) => Counter(p), Counter, { viewTransitions: value })
      const t = renderComponent(C)
      await t.ready()
      t.simulateAction('INC')
      await t.waitForState(s => s.n === 1)
      expect(t.state.n).toBe(1)
      expect(getDiagnostics().map(d => d.code)).not.toContain('SYG216')
      t.dispose()
    })

    it(`${label}: the dev entry reports SYG645 (not an array)`, async () => {
      const C = Object.assign((p) => Counter(p), Counter, { viewTransitions: value })
      document.body.innerHTML = '<div id="root"></div>'
      app = run(C, { DOM: makeViewTransitionDOMDriver('#root') }, { mountPoint: '#root', diagnostics: 'collect' })
      await settle()
      const d = getDiagnostics().filter(d => d.code == 'SYG645')
      expect(d.length).toBe(1)
      expect(d[0].message).toMatch(/viewTransitions is not an array/)
      expect(d[0].fix).toMatch(/\['INC'\]|array of action names/)
      click('.inc')
      await settle()
      expect(document.querySelector('.n').textContent).toBe('1')
    })
  }
})
