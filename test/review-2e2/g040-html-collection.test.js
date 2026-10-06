// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
// G-040: html() doesn't serialize a Collection's marker props as attributes (the real DOM sets
// them as element properties; see browser-tests/src/tests/review-2e2.jsx). 4-H (D229): there is
// no container element: the items are the parent's children, and className is ignored (SYG612).
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { Collection } from '../../src/collection.js'
import { wait, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

function Row({ state, label }) { return h('li', { className: 'row' }, label, state.title) }

describe('G-040: html() and Collection containers', () => {
  it('renders the items into the parent; no marker props, no className (SYG612)', async () => {
    function App() {
      return h('div', { className: 'app' },
        h(Collection, { of: Row, from: 'items', filter: i => i.show, label: '#' }),
        h(Collection, { of: Row, from: 'items', className: 'list' }))
    }
    App.initialState = { items: [{ id: 1, title: 'a', show: true }, { id: 2, title: 'b', show: false }] }
    const t = renderComponent(App)
    await t.ready()
    await wait(20)
    expect(t.html()).toBe(
      '<div class="app"><li class="row">#a</li>' +
      '<li class="row">a</li><li class="row">b</li></div>')
    expect(t.diagnostics.filter(d => d.code === 'SYG612').map(d => d.data.form)).toEqual(['collection-wrapper'])
    t.dispose()
  })
})
