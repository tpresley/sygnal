// @vitest-environment jsdom
// PLAN-5 3-N G-501: SYG149 checks the DOM after the patch, retrying (50 ms, up to 10 times) while
// the patched root vnode has no element yet (a View Transition patches in its update callback).
// The retries stop once the app is disposed, and when a newer patch is checked (a vnode a View
// Transition replaced before patching never gets an element); a root that never gets one isn't
// checked on its children's old elements.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { Collection } from '../src/collection.js'
import { makeViewTransitionDOMDriver } from '../src/extra/viewTransitions.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'

let app, spy
const realVT = document.startViewTransition
beforeEach(() => {
  setupChecks()
  // a View Transition whose update callback never runs: the held vnode is never patched
  document.startViewTransition = () => ({ ready: new Promise(() => {}) })
  spy = vi.spyOn(globalThis, 'setTimeout')
})
afterEach(() => {
  spy.mockRestore()
  app?.dispose(); app = null
  document.startViewTransition = realVT
  document.body.innerHTML = ''
})
const retries = () => spy.mock.calls.filter(([fn, ms]) => ms === 50 && String(fn).includes('vtRendered')).length

const Item = ({ state }) => h('li', { className: 'item' }, String(state.id))
// two lists with one prefix; the second shown by SHOW (in a View Transition): duplicate names
function Two({ state }) {
  return h('div', null,
    h('ul', { className: 'a' }, h(Collection, { of: Item, from: 'items', viewTransitionName: 'card' })),
    state.shown >= 1 ? h('ul', { className: 'b' }, h(Collection, { of: Item, from: 'items', viewTransitionName: 'card' })) : null,
    h('p', null, String(state.shown)))
}
Two.model = { SHOW: (s) => ({ ...s, shown: s.shown + 1 }) }
Two.viewTransitions = ['SHOW']

const mount = async () => {
  Two.initialState = { items: [{ id: 1 }, { id: 2 }], shown: 0 }
  document.body.innerHTML = '<div id="root"></div>'
  app = run(Two, { DOM: makeViewTransitionDOMDriver('#root') }, { mountPoint: '#root', diagnostics: 'collect' })
  await settle(60)
  expect(document.querySelectorAll('.item')).toHaveLength(2)
}

describe('G-501: the SYG149 retries', () => {
  it('stop once the app is disposed', async () => {
    await mount()
    app.__runtime.dispatch('root', 'SHOW')
    await settle(20)
    expect(retries()).toBe(1)
    app.dispose(); app = null
    await settle(700)
    expect(retries()).toBe(1)
  })

  it('of a patch a newer one replaced stop; a root that never gets its element is not checked', async () => {
    await mount()
    app.__runtime.dispatch('root', 'SHOW')
    await settle(20)
    app.__runtime.dispatch('root', 'SHOW')
    await settle(700)
    // the first patch's chain stopped at its next try; the second ran its 10
    expect(retries()).toBe(11)
    // (nothing was patched: the old elements aren't looked at)
    expect(diagnostics('SYG149')).toEqual([])
  })
})
