// @vitest-environment jsdom
// PLAN-5 3-I G-460: SYG148 / SYG149 (sygnal/diagnostics) review fixes.
// SYG148: a falsy viewTransitionName ('' / 0 / false) names nothing (the host checks `if (vn)`):
// no warning. SYG149: only elements the browser renders count (not one in a display: none
// subtree: a hidden tab panel, a list shown only at another width), checked on the DOM after the
// patch; the walk stops once the instances that render named Collections are disposed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { Collection } from '../src/collection.js'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'

let app
beforeEach(() => setupChecks())
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

const Item = ({ state }) => h('li', { className: 'item' }, String(state.id))
const mount = async (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
  await settle(60)
}

describe('G-460: SYG148 with a falsy prefix', () => {
  for (const p of ['', 0, false]) {
    it(`viewTransitionName=${JSON.stringify(p)}: nothing (no item is named)`, async () => {
      function Off() { return h('ul', null, h(Collection, { of: Item, from: 'a', viewTransitionName: p })) }
      Off.initialState = { a: [{ id: 1 }] }
      await mount(Off)
      expect(diagnostics('SYG148')).toEqual([])
      expect(document.querySelector('.item').style.viewTransitionName || '').toBe('')
    })
  }
})

describe('G-460: SYG149 counts rendered elements only', () => {
  // the same ids in two lists with one prefix; the second list is hidden (display: none, or the
  // hidden attribute) unless `shown`
  function Tabs({ state }) {
    return h('div', null,
      h('ul', { className: 'a' }, h(Collection, { of: Item, from: 'items', viewTransitionName: 'card' })),
      h('div', state.how == 'attr' ? { attrs: { hidden: !state.shown } } : { style: { display: state.shown ? 'block' : 'none' } },
        h('ul', { className: 'b' }, h(Collection, { of: Item, from: 'items', viewTransitionName: 'card' }))))
  }
  Tabs.model = { SHOW: (s) => ({ ...s, shown: true }) }

  for (const how of ['style', 'attr']) {
    it(`a list in a display: none subtree (${how}): no SYG149; once it is shown: SYG149`, async () => {
      Tabs.initialState = { items: [{ id: 1 }, { id: 2 }], shown: false, how }
      await mount(Tabs)
      expect(document.querySelectorAll('.item')).toHaveLength(4)
      expect(diagnostics('SYG149')).toEqual([])
      app.__runtime.dispatch('root', 'SHOW')
      await settle(60)
      expect(diagnostics('SYG149').map((d) => d.data.name).sort()).toEqual(['card-1', 'card-2'])
    })
  }
})

describe('G-460: the SYG149 walk stops when no named Collection is mounted', () => {
  // the named Collection is in a child the parent removes; then the parent shows two elements it
  // names itself with that prefix's class: no Collection is mounted, so they aren't looked at
  function Board({ state }) {
    return h('ul', { className: 'board' }, h(Collection, { of: Item, from: 'items', viewTransitionName: 'card' }))
  }
  function Page({ state }) {
    const own = (k) => h('li', { key: k, style: { viewTransitionName: 'card-9', viewTransitionClass: 'card' } }, 'x')
    return h('div', null,
      state.board ? h(Board, { state: 'b' }) : null,
      state.own ? h('ul', null, own('x'), own('y')) : null)
  }
  Page.initialState = { b: { items: [{ id: 1 }] }, board: true, own: false }
  Page.model = { HIDE: (s) => ({ ...s, board: false }), OWN: (s) => ({ ...s, own: true }) }

  it('after the instance that rendered it is disposed', async () => {
    await mount(Page)
    expect(document.querySelectorAll('.item')).toHaveLength(1)
    app.__runtime.dispatch('root', 'HIDE')
    await settle(60)
    expect(document.querySelector('.board')).toBe(null)
    app.__runtime.dispatch('root', 'OWN')
    await settle(60)
    expect(diagnostics('SYG149')).toEqual([])
  })
})
