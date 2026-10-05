// B-029 (4C): ABORT from a non-STATE sink reducer (PARENT, EVENTS, a custom driver, EFFECT,
// shorthand) means "send nothing", silently. It used to report SYG218 ("returned a symbol").
// Other bad return types still report SYG218 / SYG217.
import { describe, it, expect, vi, afterEach } from 'vitest'
import xs from 'xstream'
import { renderComponent, h, createElement, ABORT } from '../src/index.ts'

let t
afterEach(() => { t?.dispose(); t = undefined; vi.restoreAllMocks() })

const view = ({ state }) => h('div', null, String(state.n))

describe('B-029: ABORT from non-STATE sinks is silent', () => {
  it('PARENT: a conditional ABORT sends nothing to the parent, with no diagnostics', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Child({ state }) { return h('button.ping', null, String(state.n)) }
    Child.intent = ({ DOM }) => ({ PING: DOM.click('.ping') })
    Child.model = {
      PING: {
        STATE: s => ({ ...s, n: s.n + 1 }),
        PARENT: s => (s.n % 2 ? ABORT : { n: s.n }),
      },
    }
    function Parent({ state }) { return createElement('div', null, createElement(Child, { state: 'child' }), createElement('p', null, String(state.got.length))) }
    Parent.initialState = { child: { n: 0 }, got: [] }
    Parent.intent = ({ CHILD }) => ({ GOT: CHILD.select(Child) })
    Parent.model = { GOT: (s, v) => ({ ...s, got: [...s.got, v] }) }
    t = renderComponent(Parent)
    // PARENT reads the state the action started from: n=0 sends {n: 0}, n=1 -> ABORT
    t.simulateEvent('.ping', 'click')
    await t.waitForState(s => s.child.n === 1 && s.got.length === 1)
    t.simulateEvent('.ping', 'click')
    await t.waitForState(s => s.child.n === 2)
    await t.settle()
    expect(t.states.at(-1).got).toEqual([{ n: 0 }])
    t.expectNoDiagnostics()
    expect(err.mock.calls.filter(c => /SYG21[68]/.test(String(c[0])))).toEqual([])
  })

  it('EVENTS: a conditional ABORT emits nothing on the bus, with no diagnostics', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = {
      GO: {
        STATE: (s, d) => ({ ...s, n: d }),
        EVENTS: (s, d) => (d > 1 ? { type: 'BIG', data: d } : ABORT),
      },
    }
    t = renderComponent(App)
    t.simulateAction('GO', 1)
    t.simulateAction('GO', 2)
    await t.waitForState(s => s.n === 2)
    await t.settle()
    expect(t.emitted).toEqual([{ type: 'BIG', data: 2 }])
    t.expectNoDiagnostics()
    expect(err.mock.calls.filter(c => /SYG21[68]/.test(String(c[0])))).toEqual([])
  })

  // PLAN-2 1-B (G-027): SYG218 is reported under its own code (it used to be thrown into the
  // reducer's catch and surface as SYG216 with the SYG218 error attached)
  it('a non-ABORT symbol still reports SYG218, and nothing is sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: { EVENTS: () => Symbol('oops') } }
    t = renderComponent(App)
    t.simulateAction('GO')
    await t.settle()
    expect(t.emitted).toEqual([])
    const d = t.diagnostics.find(d => d.code === 'SYG218')
    expect(d).toBeDefined()
    expect(d.message).toMatch(/returned a symbol/)
    expect(t.diagnostics.find(d => d.code === 'SYG216')).toBeUndefined()
  })

  it('undefined still warns SYG217', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    function App(p) { return view(p) }
    App.initialState = { n: 0 }
    App.model = { GO: { EVENTS: () => undefined } }
    t = renderComponent(App)
    t.simulateAction('GO')
    await t.settle()
    expect(t.diagnostics.map(d => d.code)).toContain('SYG217')
  })
})
