// @vitest-environment jsdom
// PLAN-5 3-F G-419: dev checks for a Collection's viewTransitionName (sygnal/diagnostics):
// SYG148 a prefix that is not a CSS identifier; SYG149 the same view-transition-name twice on the
// page after a patch (the same id in two Collections with one prefix).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { Collection } from '../src/collection.js'
import { VirtualCollection } from '../src/extra/virtual.ts'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { CODE_TITLES, DEV_CODE_SEVERITY } from '../src/extra/diagnostics/codes.js'

let app
beforeEach(() => setupChecks())
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

const Item = ({ state }) => h('li', { className: 'item' }, String(state.id))
const mount = async (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
  await settle(60)
}

describe('G-419: SYG148 (prefix)', () => {
  it('is registered as a dev-entry warning', () => {
    expect(CODE_TITLES.SYG148).toMatch(/not a CSS identifier/)
    expect(DEV_CODE_SEVERITY.SYG148).toBe('warn')
    expect(DEV_CODE_SEVERITY.SYG149).toBe('warn')
  })

  for (const bad of ['1card', 'my card', 'card.x', '-1']) {
    it(`reports viewTransitionName=${JSON.stringify(bad)} once`, async () => {
      function Bad({ state }) { return h('ul', null, h(Collection, { of: Item, from: 'a', viewTransitionName: bad }), h('i', null, String(state.n))) }
      Bad.initialState = { a: [{ id: 1 }], n: 0 }
      await mount(Bad)
      const d = diagnostics('SYG148')
      expect(d).toHaveLength(1)
      expect(d[0].component).toBe('Bad')
      expect(d[0].message).toContain(JSON.stringify(bad))
    })
  }

  it('accepts identifiers (and reports nothing for a Collection without the prop)', async () => {
    function Good() {
      return h('div', null,
        h('ul', null, h(Collection, { of: Item, from: 'a', viewTransitionName: 'card' })),
        h('ul', null, h(Collection, { of: Item, from: 'b', viewTransitionName: '-x_1' })),
        h('ul', null, h(Collection, { of: Item, from: 'c', viewTransitionName: '--z' })),
        h('ul', null, h(Collection, { of: Item, from: 'a' })))
    }
    Good.initialState = { a: [{ id: 1 }], b: [{ id: 1 }], c: [{ id: 1 }] }
    await mount(Good)
    expect(diagnostics('SYG148')).toEqual([])
    expect(diagnostics('SYG149')).toEqual([])
  })

  it('a VirtualCollection too', async () => {
    function V() { return h(VirtualCollection, { of: Item, from: 'a', className: 'rows', viewTransitionName: '9' }) }
    V.initialState = { a: [{ id: 1 }] }
    await mount(V)
    expect(diagnostics('SYG148')).toHaveLength(1)
  })
})

describe('G-419: SYG149 (duplicate names)', () => {
  function Board({ state }) {
    return h('div', null,
      h('ul', { className: 'all' }, h(Collection, { of: Item, from: 'all', viewTransitionName: 'card' })),
      h('ul', { className: 'fav' }, h(Collection, { of: Item, from: 'fav', viewTransitionName: state.favPrefix })))
  }
  Board.model = { FAV: (s, id) => ({ ...s, fav: [...s.fav, s.all.find(x => x.id == id)] }) }

  it('reports the same id in two Collections with one prefix, once per name, after the patch that shows it', async () => {
    Board.initialState = { all: [{ id: 1 }, { id: 2 }], fav: [], favPrefix: 'card' }
    await mount(Board)
    expect(diagnostics('SYG149')).toEqual([])
    app.__runtime.dispatch('root', 'FAV', 2)
    await settle(60)
    const d = diagnostics('SYG149')
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain("'card-2'")
    expect(d[0].data).toEqual({ name: 'card-2', prefix: 'card' })
    app.__runtime.dispatch('root', 'FAV', 2)
    await settle(60)
    expect(diagnostics('SYG149')).toHaveLength(1)
  })

  it('different prefixes: nothing', async () => {
    Board.initialState = { all: [{ id: 1 }, { id: 2 }], fav: [{ id: 2 }], favPrefix: 'fav' }
    await mount(Board)
    expect(diagnostics('SYG149')).toEqual([])
  })
})
