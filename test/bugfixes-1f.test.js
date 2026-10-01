// Regression tests for PLAN-1 workstream 1F (framework bug fixes).
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const last = t => t.states[t.states.length - 1]

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
})

// ─── B-003: every sink of one action sees the same state snapshot ───────────

describe('B-003: non-STATE sinks see the state as of their action', () => {
  function Editor({ state }) {
    return h('div', null,
      h('input', { className: 'draft', value: state.draft }),
      h('button', { className: 'save' }, 'Save'),
    )
  }
  Editor.initialState = { draft: '', saved: '' }
  Editor.intent = ({ DOM }) => ({
    EDIT: DOM.input('.draft').value(),
    SAVE: DOM.click('.save'),
  })
  Editor.model = {
    EDIT: (s, draft) => ({ ...s, draft }),
    SAVE: {
      STATE: s => ({ ...s, saved: s.draft }),
      EVENTS: s => ({ type: 'SAVED', data: s.draft.length }),
      SPY: s => s.draft,
    },
  }

  it('EDIT and SAVE in the same tick: STATE, EVENTS and a custom sink all see the edited draft', async () => {
    t = renderComponent(Editor)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'hello' })
    t.simulateEvent('.save', 'click')
    await t.waitForState(s => s.saved === 'hello')
    await settle()
    expect(last(t).saved).toBe('hello')
    expect(t.emitted).toEqual([{ type: 'SAVED', data: 5 }])
    expect(t.sinkValues('SPY')).toEqual(['hello'])
  })

  it('same for a sub-component without initialState (state from the parent, no delay)', async () => {
    const saved = []
    function Child({ state }) {
      return h('div', null,
        h('input', { className: 'draft', value: state.draft }),
        h('button', { className: 'save' }, 'Save'))
    }
    Child.intent = Editor.intent
    Child.model = {
      EDIT: (s, draft) => ({ ...s, draft }),
      SAVE: { STATE: s => ({ ...s, saved: s.draft }), EVENTS: s => ({ type: 'SAVED', data: s.draft.length }) },
    }
    function App() { return h('div', null, h(Child)) }
    App.initialState = { draft: '', saved: '' }
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'hey' })
    t.simulateEvent('.save', 'click')
    await t.waitForState(s => s.saved === 'hey')
    await settle()
    expect(t.emitted).toEqual([{ type: 'SAVED', data: 3 }])
  })

  it('EFFECT handlers see the same snapshot', async () => {
    const seen = []
    function C() { return h('div', null) }
    C.initialState = { n: 0 }
    C.model = {
      INC: s => ({ ...s, n: s.n + 1 }),
      LOOK: { EFFECT: s => { seen.push(s.n) } },
    }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('INC')
    t.simulateAction('INC')
    t.simulateAction('LOOK')
    await t.waitForState(s => s.n === 2)
    await settle()
    expect(seen).toEqual([2])
  })

  it('a non-STATE sink sees the state before its own STATE reducer (unchanged semantics)', async () => {
    function C() { return h('div', null) }
    C.initialState = { n: 0 }
    C.model = {
      BUMP: { STATE: s => ({ ...s, n: s.n + 1 }), SPY: s => s.n },
    }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('BUMP')
    t.simulateAction('BUMP')
    await t.waitForState(s => s.n === 2)
    await settle()
    expect(t.sinkValues('SPY')).toEqual([0, 1])
  })
})
