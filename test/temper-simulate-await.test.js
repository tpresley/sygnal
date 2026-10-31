// Temper feedback 2026-10: simulateEvent returns a promise that resolves once the event is
// delivered and the tree has rendered what it caused, so `t.query()` after `await` sees the new
// view. Resolve-only; the fake clock moves only while it is awaited.
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent, createElement as h } from '../src/index.ts'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = undefined
  vi.useRealTimers()
})

function Start({ state }) {
  return h('div', null,
    h('div', { className: 'filters' }, 'f'),
    state.loading ? h('p', { className: 'skeleton' }, '…') : h('div', { className: 'empty' }, 'none'),
    h('button', { className: 'retry' }, 'Try again'))
}
Start.initialState = { loading: false, n: 0 }
Start.intent = ({ DOM }) => ({ RETRY: DOM.click('.retry') })
Start.model = { RETRY: (s) => ({ ...s, loading: true, n: s.n + 1 }) }

function Child({ state }) { return h('span', { className: 'child' }, String(state.n)) }
function Parent({ state }) {
  return h('div', null, h('button', { className: 'inc' }, '+'), h(Child, { state: 'inner' }))
}
Parent.initialState = { inner: { n: 0 } }
Parent.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Parent.model = { INC: (s) => ({ ...s, inner: { n: s.inner.n + 1 } }) }

describe('await t.simulateEvent()', () => {
  it('the mock DOM: query() before the await sees the old view, after it the new one', async () => {
    t = renderComponent(Start)
    await t.ready()
    const p = t.simulateEvent('.retry', 'click')
    expect(p).toBeInstanceOf(Promise)
    expect(t.query('.skeleton')).toBeNull()
    await expect(p).resolves.toBeUndefined()
    expect(t.query('.skeleton')).not.toBeNull()
    expect(t.state.n).toBe(1)
    // a child component has rendered it too
    t.dispose()
    t = renderComponent(Parent)
    await t.simulateEvent('.inc', 'click')
    expect(t.query('.child').textContent).toBe('1')
  })

  it('before ready (buffered) and on the real DOM', async () => {
    t = renderComponent(Start)
    await t.simulateEvent('.retry', 'click')
    expect(t.query('.skeleton')).not.toBeNull()
    t.dispose()
    t = renderComponent(Start, { dom: 'real' })
    await t.ready()
    await t.simulateEvent('.retry', 'click')
    expect(t.container.querySelector('.skeleton')).not.toBeNull()
    expect(t.query('.empty')).toBeNull()
  })

  it('never rejects: a selector that matches nothing fails the next wait instead', async () => {
    t = renderComponent(Start, { eventWaitMs: 30 })
    await t.ready()
    t.simulateEvent('.retry', 'click') // keeps the queue busy, so the missing one isn't thrown at the call
    await expect(t.simulateEvent('.missing', 'click')).resolves.toBeUndefined()
    await expect(t.settle()).rejects.toThrow(/\.missing/)
  })

  it('resolves on dispose', async () => {
    t = renderComponent(Start, { eventWaitMs: 5000 })
    await t.ready()
    t.simulateEvent('.retry', 'click')
    const p = t.simulateEvent('.missing', 'click', { allowMissing: true })
    t.dispose()
    await expect(p).resolves.toBeUndefined()
  })

  it('fake timers: an un-awaited call leaves the clock alone; an awaited one drives it', async () => {
    vi.useFakeTimers()
    t = renderComponent(Start)
    await t.ready()
    const before = Date.now()
    t.simulateEvent('.retry', 'click')
    await Promise.resolve()
    expect(Date.now()).toBe(before)
    await t.simulateEvent('.retry', 'click')
    expect(t.state.n).toBe(2)
    expect(t.query('.skeleton')).not.toBeNull()
  })
})
