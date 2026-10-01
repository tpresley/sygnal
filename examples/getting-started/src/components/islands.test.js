// Smoke test: renders every island on the guide page with the dev checks
// ('sygnal/diagnostics') and strict mode on, drives each one through its real
// intent with simulateEvent, and asserts that no diagnostics were reported.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import 'sygnal/diagnostics'
import { renderComponent, createElement } from 'sygnal'
import HelloWorld from './HelloWorld.jsx'
import Counter from './Counter.jsx'
import Greeter from './Greeter.jsx'
import CounterWithHeader from './CounterWithHeader.jsx'
import UserCardDemo from './UserCardDemo.jsx'
import CalculatedTest from './CalculatedTest.jsx'
import ErrorBoundaryDemo from './ErrorBoundaryDemo.jsx'
import RefDemo from './RefDemo.jsx'
import PortalDemo from './PortalDemo.jsx'
import TransitionDemo from './TransitionDemo.jsx'
import LazyDemo from './LazyDemo.jsx'

// The root `npx vitest` also collects this file, but without this example's
// Vitest config (no Sygnal JSX transform), so the .jsx views compile to classic
// React.createElement calls there. Point those at Sygnal's createElement.
let reactShim = false
beforeAll(() => {
  if (typeof globalThis.React === 'undefined') {
    globalThis.React = { createElement }
    reactShim = true
  }
  // CalculatedTest logs every recalculation
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterAll(() => {
  if (reactShim) delete globalThis.React
  vi.restoreAllMocks()
})

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// Renders `Component` in strict mode, runs `drive`, then checks diagnostics
async function smoke(Component, drive, { expected } = {}) {
  const t = renderComponent(Component, { strict: true })
  try {
    await t.ready()
    await drive(t)
    if (expected) {
      // a demo that triggers a diagnostic on purpose: exactly those, nothing else
      expect(t.diagnostics.filter(d => d.severity !== 'info').map(d => d.code)).toEqual(expected)
    } else {
      t.expectNoDiagnostics()
    }
  } finally {
    t.dispose()
  }
}

describe('getting-started islands (smoke)', () => {
  it('HelloWorld', () => smoke(HelloWorld, async (t) => {
    expect(t.html()).toContain('Hello World!')
  }))

  it('Counter', () => smoke(Counter, async (t) => {
    t.simulateEvent('.increment', 'click')
    t.simulateEvent('.increment', 'click')
    t.simulateEvent('.decrement', 'click')
    await t.waitForState(s => s.count === 2)
    await wait(30)
    expect(t.states.at(-1).count).toBe(1)
    expect(t.html()).toContain('Count: 1')
  }))

  it('Greeter', () => smoke(Greeter, async (t) => {
    t.simulateEvent('.name-input', 'input', { value: 'Sygnal' })
    await t.waitForState(s => s.name === 'Sygnal')
    expect(t.html()).toContain('Hello Sygnal!')
  }))

  it('CounterWithHeader', () => smoke(CounterWithHeader, async (t) => {
    t.simulateEvent('.increment', 'click')
    await t.waitForState(s => s.count === 1)
  }))

  it('UserCardDemo (state passed to a child)', () => smoke(UserCardDemo, async (t) => {
    await wait(20)
    t.simulateEvent('.birthday', 'click')
    await t.waitForState(s => s.user.age === 31)
    await wait(20)
    expect(t.html()).toContain('Age: 31')
  }))

  it('CalculatedTest', () => smoke(CalculatedTest, async (t) => {
    t.simulateEvent('.inc-price', 'click')
    t.simulateEvent('.inc-qty', 'click')
    const s = await t.waitForState(s => s.price === 11 && s.quantity === 3)
    expect(s.subtotal).toBe(33)
    expect(s.total).toBe(33 + s.tax)
  }))

  it('ErrorBoundaryDemo (renders the fallback at 3)', () => smoke(ErrorBoundaryDemo, async (t) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    t.simulateEvent('.increment', 'click')
    t.simulateEvent('.increment', 'click')
    await t.waitForState(s => s.count === 2)
    expect(t.html()).toContain('Crashes at 3')
    t.simulateEvent('.increment', 'click')
    await t.waitForState(s => s.count === 3)
    await wait(20)
    expect(t.html()).toContain('Count too high!')
  }, {
    // the view throws at 3 by design; the runtime reports it (SYG406) and renders .onError
    expected: ['SYG406'],
  }))

  it('RefDemo (Measure aborts while the ref is unset)', () => smoke(RefDemo, async (t) => {
    t.simulateEvent('.measure', 'click')
    t.simulateEvent('.toggle', 'click')
    const s = await t.waitForState(s => s.expanded)
    expect(s.width).toBe(0)
    expect(t.html()).toContain('Shrink')
  }))

  it('PortalDemo', () => smoke(PortalDemo, async (t) => {
    t.simulateEvent('.toggle-modal', 'click')
    await t.waitForState(s => s.showModal)
    // the close button lives in #portal-root, so the intent listens on document
    t.simulateEvent('document', 'click', { target: { closest: sel => sel === '.close-modal-btn' } })
    await wait(30)
    expect(t.states.at(-1).showModal).toBe(false)
    expect(t.html()).toContain('Open Modal')
  }))

  it('TransitionDemo', () => smoke(TransitionDemo, async (t) => {
    t.simulateEvent('.fade-toggle', 'click')
    await t.waitForState(s => s.show)
    await wait(20)
    expect(t.html()).toContain('fades in and out')
  }))

  it('LazyDemo', () => smoke(LazyDemo, async (t) => {
    t.simulateEvent('.lazy-toggle', 'click')
    await t.waitForState(s => s.show)
    await wait(20)
    expect(t.html()).toContain('Unload')
  }))
})
