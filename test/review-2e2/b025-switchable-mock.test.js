// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
// B-025: a Switchable renders (and switches) under renderComponent's mock DOM.
import { describe, it, expect } from 'vitest'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { Switchable } from '../../src/switchable.js'
import { wait, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

function Home() { return h('div', { className: 'home' }, h('button', { className: 'go-settings' }, 'Settings')) }
Home.intent = ({ DOM }) => ({ GO: DOM.click('.go-settings') })
Home.model = { GO: { EVENTS: () => ({ type: 'NAV', data: 'settings' }) } }

function Settings({ state }) { return h('div', { className: 'settings' }, h('button', { className: 'inc' }, `n=${state.n}`)) }
Settings.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Settings.model = { INC: s => ({ ...s, n: s.n + 1 }) }

function App({ state }) {
  return h('main', null, h(Switchable, { of: { home: Home, settings: Settings }, current: state.page }))
}
App.initialState = { page: 'home', n: 0 }
App.intent = ({ EVENTS }) => ({ NAV: EVENTS.select('NAV') })
App.model = { NAV: (s, page) => ({ ...s, page }) }

describe('B-025: Switchable under renderComponent', () => {
  it('renders the current component and switches on simulateEvent', async () => {
    const errors = []
    const onErr = e => errors.push(e)
    process.on('uncaughtException', onErr)
    try {
      const t = renderComponent(App)
      await t.ready()
      await wait(30)
      expect(t.html()).toContain('class="home"')
      t.simulateEvent('.go-settings', 'click')
      await t.waitForState(s => s.page === 'settings')
      await wait(30)
      expect(t.html()).toContain('n=0')
      expect(t.html()).not.toContain('class="home"')
      t.simulateEvent('.inc', 'click')
      await t.waitForState(s => s.n === 1)
      await wait(30)
      expect(t.html()).toContain('n=1')
      t.dispose()
    } finally {
      process.off('uncaughtException', onErr)
    }
    expect(errors).toEqual([])
  })
})
