// @vitest-environment jsdom
// PLAN-5 3-V G-538: a fragment root has no element after 3-Q's flattening (its children are
// patched into the container), so renderComponent({ dom: 'real' }) waited for one forever (settle
// timed out) and SYG149 never checked a fragment app root
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { Collection } from '../src/collection.js'
import { Fragment } from '../src/cycle/dom/fragment.ts'
import { renderComponent } from '../src/extra/testing.ts'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'

describe("renderComponent({ dom: 'real' }) of a fragment root", () => {
  for (const frag of [false, true]) it(`settles (fragment root: ${frag})`, async () => {
    function C({ state }) {
      const k = [h('button', { className: 'b' }, '+'), h('output', null, String(state.n))]
      return frag ? h(Fragment, null, ...k) : h('div', null, ...k)
    }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => ({ T: DOM.select('.b').events('click') })
    C.model = { T: (s) => ({ n: s.n + 1 }) }
    const t = renderComponent(C, { dom: 'real', timeoutMs: 500 })
    await t.ready()
    t.query('.b').click()
    await t.waitForState((s) => s.n == 1)
    const t0 = performance.now()
    await t.settle()
    // (it timed out after timeoutMs)
    expect(performance.now() - t0).toBeLessThan(300)
    expect(t.query('output').textContent).toBe('1')
    t.dispose()
  })
})

describe('SYG149 checks a fragment app root', () => {
  let app
  beforeEach(() => setupChecks())
  afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

  it('two Collections with one prefix showing the same item, under a fragment root', async () => {
    const Item = ({ state }) => h('li', { className: 'item' }, String(state.id))
    function Two({ state }) {
      return h(Fragment, null,
        h('ul', { className: 'a' }, h(Collection, { of: Item, from: 'items', viewTransitionName: 'card' })),
        state.shown ? h('ul', { className: 'b' }, h(Collection, { of: Item, from: 'items', viewTransitionName: 'card' })) : null)
    }
    Two.initialState = { items: [{ id: 1 }], shown: false }
    Two.model = { SHOW: (s) => ({ ...s, shown: true }) }
    document.body.innerHTML = '<div id="root"></div>'
    app = run(Two, {}, { mountPoint: '#root', diagnostics: 'collect' })
    await settle(60)
    app.__runtime.dispatch('root', 'SHOW')
    await settle(120)
    expect(document.querySelectorAll('.item')).toHaveLength(2)
    expect(diagnostics('SYG149')).toHaveLength(1)
  })
})
