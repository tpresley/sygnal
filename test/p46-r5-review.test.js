// @vitest-environment jsdom
// PLAN-4.6 R5: fixes of the R4 review (G-324 ... G-335), each pinned here (failing first).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/index.js'

let t
afterEach(() => { t?.dispose(); t = null; vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('G-324: a child-only fake sink answers an intent-less child', () => {
  function App() { return h('div', null, h(Loader, { state: 'loader' })) }
  function Loader({ state }) { return h('p', { className: 'l' }, String(state.data)) }
  Loader.model = { BOOTSTRAP: { API: () => ({ url: '/x', ok: 'LOADED' }) }, LOADED: (s, d) => ({ ...s, data: d.v }) }
  App.initialState = { loader: { data: 'none' } }

  it('t.respond reaches a child that has a model but no intent', async () => {
    t = renderComponent(App)
    await t.ready()
    await t.settle()
    expect(t.requests('API')).toHaveLength(1)
    await t.respond('API', { v: 'yes' })
    await t.settle()
    expect(t.state.loader.data).toBe('yes')
    expect(t.html()).toContain('yes')
  })
})
