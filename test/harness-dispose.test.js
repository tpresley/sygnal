// Sift: renderComponent handles are disposed even when a test fails. `using` / `await using`
// ([Symbol.dispose] / [Symbol.asyncDispose]), Vitest auto-dispose through onTestFinished
// (Testing Library's auto-cleanup; opt out with autoDispose: false), cleanup() for node:test, and
// strict: true failing at dispose on diagnostics the test never read.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent, cleanup } from '../src/extra/testing.js'
import { makeRouter } from '../src/extra/router.js'
import { Collection } from '../src/collection.js'

const router = makeRouter({ routes: { home: '/', item: '/items/:id' } })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const clock = (o = {}) => renderComponent(Clock, { router, ...o })

// a live timer (every 5 ms) and the router fake
function Clock({ state }) { return h('p', null, `${state.route.name} ${state.ticks}`) }
Clock.initialState = { route: router.current('/'), ticks: 0 }
Clock.route = 'ROUTE'
Clock.timers = () => ({ tick: { every: 5, action: 'TICK' } })
Clock.model = {
  ROUTE: (s, route) => ({ ...s, route }),
  TICK: (s) => ({ ...s, ticks: s.ticks + 1 }),
}

// SYG104 (warn): the parent selects '.remove', which only renders inside the isolated items
function Item({ state }) { return h('button', { className: 'remove' }, state.title) }
function List() { return h('div', null, h(Collection, { of: Item, from: 'items' })) }
List.initialState = { items: [{ id: 1, title: 'a' }] }
List.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
List.model = { REMOVE: (s) => s }

const isDisposed = async (t) => {
  const n = t.states.length
  await wait(30)
  return t.states.length === n
}

describe('Vitest auto-dispose', () => {
  let failed
  it.fails('a failing assertion with a live timer and router (fails on purpose)', async () => {
    failed = clock({ url: "/items/7" })
    await failed.next((s) => s.ticks >= 2)
    expect(failed.state.route.name).toBe('home')
  })

  it('...left that handle disposed: its timer stopped, its router fake is gone', async () => {
    expect(failed.state.route.name).toBe('item')
    expect(await isDisposed(failed)).toBe(true)
    // a second dispose is a no-op
    expect(() => failed.dispose()).not.toThrow()
  })

  let passed
  it('a passing test', async () => {
    passed = clock()
    await passed.next((s) => s.ticks >= 1)
  })
  it('...is disposed after it too', async () => {
    expect(await isDisposed(passed)).toBe(true)
  })

  let kept
  it('autoDispose: false keeps the handle past its test', async () => {
    kept = clock({ autoDispose: false })
    await kept.next((s) => s.ticks >= 1)
  })
  it('...until it is disposed', async () => {
    expect(await isDisposed(kept)).toBe(false)
    kept.dispose()
    expect(await isDisposed(kept)).toBe(true)
  })

  describe('a handle made in beforeAll is shared, so it is not auto-disposed', () => {
    let shared
    beforeAll(() => { shared = clock() })
    afterAll(() => shared.dispose())
    it('first test', async () => { await shared.next((s) => s.ticks >= 1) })
    it('second test: still live', async () => { expect(await isDisposed(shared)).toBe(false) })
  })
})

describe('dispose', () => {
  it('twice is a no-op', async () => {
    const t = clock()
    await t.ready()
    t.dispose()
    expect(() => t.dispose()).not.toThrow()
    expect(() => t[Symbol.dispose]()).not.toThrow()
  })

  it('using disposes at the end of the block, also when it throws', async () => {
    let t
    expect(() => {
      using u = clock({ autoDispose: false })
      t = u
      throw new Error('boom')
    }).toThrow('boom')
    expect(await isDisposed(t)).toBe(true)
  })

  it('await using', async () => {
    let t
    {
      await using u = clock({ autoDispose: false })
      t = u
      await u.next((s) => s.ticks >= 1)
    }
    expect(await isDisposed(t)).toBe(true)
  })

  it('cleanup() disposes every live handle', async () => {
    const a = clock({ autoDispose: false })
    const b = clock({ autoDispose: false })
    await Promise.all([a.ready(), b.ready()])
    cleanup()
    expect(await isDisposed(a)).toBe(true)
    expect(await isDisposed(b)).toBe(true)
    expect(() => cleanup()).not.toThrow()
  })
})

describe('strict: true fails at dispose on diagnostics the test never read', () => {
  it('dispose() throws with the list', async () => {
    const t = renderComponent(List, { strict: true, autoDispose: false })
    await t.ready()
    expect(() => t.dispose()).toThrow(/renderComponent\(List, \{ strict: true \}\): 1 diagnostic was reported that the test never checked[\s\S]*SYG104/)
    // and only once
    expect(() => t.dispose()).not.toThrow()
  })

  it('read through t.diagnostics: no throw', async () => {
    const t = renderComponent(List, { strict: true, autoDispose: false })
    await t.ready()
    expect(t.diagnostics.map((d) => d.code)).toContain('SYG104')
    expect(() => t.dispose()).not.toThrow()
  })

  it('checked by expectNoDiagnostics: its throw is the failure, dispose adds none', async () => {
    const t = renderComponent(List, { strict: true, autoDispose: false })
    await t.ready()
    expect(() => t.expectNoDiagnostics()).toThrow(/SYG104/)
    expect(() => t.dispose()).not.toThrow()
  })

  it('cleanup() throws them after disposing every handle', async () => {
    const t = renderComponent(List, { strict: true, autoDispose: false })
    const u = clock({ autoDispose: false })
    await Promise.all([t.ready(), u.ready()])
    expect(() => cleanup()).toThrow(/SYG104/)
    expect(await isDisposed(u)).toBe(true)
  })

  it('without strict nothing is thrown', async () => {
    const t = renderComponent(List, { autoDispose: false })
    await t.ready()
    expect(() => t.dispose()).not.toThrow()
  })

  let warn
  it.fails('auto-dispose after a failed test prints them instead of throwing over its error (fails on purpose)', async () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = renderComponent(List, { strict: true })
    await t.ready()
    throw new Error('the test\'s own failure')
  })
  it('...printed', () => {
    expect(warn.mock.calls.map((c) => c[0]).join('\n')).toMatch(/strict: true[\s\S]*SYG104/)
    warn.mockRestore()
  })

  it('using defers the check to the end of the test under Vitest (the block\'s own error is not wrapped)', async () => {
    const t = renderComponent(List, { strict: true })
    await t.ready()
    let caught
    try {
      using u = t
      throw new Error('inner')
    } catch (e) { caught = e }
    expect(caught.message).toBe('inner')
    // read before the test ends, so the deferred check passes
    void t.diagnostics
  })
})
