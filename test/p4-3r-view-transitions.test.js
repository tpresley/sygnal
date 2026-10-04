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

// a fake API: records each call and runs the update callback a task later (as browsers do)
function fakeVT() {
  const calls = []
  document.startViewTransition = (update) => {
    const t = { update }
    calls.push(t)
    t.updateCallbackDone = new Promise(r => setTimeout(r, 0)).then(() => update())
    return t
  }
  return calls
}

describe('3-R item 6: a View Transition request survives a slow render', () => {
  const busy = (ms) => { for (const end = Date.now() + ms; Date.now() < end;); }
  function Slow({ state }) {
    if (state.slow) busy(150)
    return h('div', null, h('button', { className: 'go' }, 'go'), h('button', { className: 'same' }, 'same'),
      h('button', { className: 'bump' }, 'bump'), h('p', { className: 'n' }, `${state.n}:${state.slow}`))
  }
  Slow.initialState = { n: 0, slow: false }
  Slow.intent = ({ DOM }) => ({ GO: DOM.click('.go'), SAME: DOM.click('.same'), BUMP: DOM.click('.bump') })
  // SAME returns an equal state (a new object): the request is made, but nothing renders
  Slow.model = { GO: (s) => ({ ...s, slow: true }), SAME: (s) => ({ ...s }), BUMP: (s) => ({ ...s, n: s.n + 1 }) }
  Slow.viewTransitions = ['GO', 'SAME']
  const start = () => {
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Slow, { DOM: makeViewTransitionDOMDriver('#root') }, { mountPoint: '#root' })
  }

  it('a listed action whose render takes 150 ms still runs as a View Transition', async () => {
    const calls = fakeVT()
    start()
    await settle()
    click('.go')
    await settle(300)
    expect(calls.length).toBe(1)
    await calls[0].updateCallbackDone
    await settle(40)
    expect(document.querySelector('.n').textContent).toBe('0:true')
  })

  it('a request whose state renders nothing new expires: a later, unrelated patch is not animated', async () => {
    const calls = fakeVT()
    start()
    await settle()
    click('.same')
    await settle(200)
    click('.bump')
    await settle()
    expect(document.querySelector('.n').textContent).toBe('1:false')
    expect(calls.length).toBe(0)
  })
})
