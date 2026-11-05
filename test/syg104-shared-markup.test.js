// @vitest-environment jsdom
// 7.3 (Sift's live-writes walk): SYG104 isn't reported for shared markup: a component that draws
// its own `.confirm [data-act="confirm"]` and listens to it, around a child that draws and listens
// to its own (the retire confirmation inside the settings screen). Still reported: a parent that
// never draws the child's elements (test/diagnostics/controls.test.js "SYG104 by identifier").
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'

const confirmBox = (name) => h('div', { className: 'confirm' }, h('button', { 'data-act': 'confirm', 'data-name': name }, 'Yes'))

function Retire({ state }) { return state.open ? confirmBox('retire') : h('button', { className: 'open' }, 'Retire') }
Retire.initialState = { open: true }
Retire.isolatedState = true
Retire.intent = ({ DOM }) => ({ CONFIRM: DOM.click('.confirm [data-act="confirm"]') })
Retire.model = { CONFIRM: (s) => ({ ...s, open: false }) }

function Layout({ state }) {
  return h('main', null, state.opened ? h('div', { className: 'confirm' }, h('button', { 'data-act': 'confirm' }, 'Stop')) : null, h('section', null, h(Retire)))
}
Layout.initialState = { opened: false, n: 0 }
Layout.intent = ({ DOM }) => ({ CONFIRM: DOM.click('.confirm [data-act="confirm"]') })
Layout.model = { CONFIRM: (s) => ({ ...s, n: s.n + 1 }) }

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null; vi.restoreAllMocks(); document.body.innerHTML = '' })

describe('SYG104: shared markup', () => {
  for (const dom of ['mock', 'real']) {
    it(`no SYG104 when both components draw and handle their own confirmation (${dom} DOM)`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      t = renderComponent(Layout, dom === 'real' ? { dom: 'real' } : {})
      await t.ready()
      await settle(120)
      await t.simulateEvent('.confirm [data-act="confirm"]', 'click')
      await settle(120)
      expect(t.state.n).toBe(0)
      expect(t.diagnostics.filter(d => d.code === 'SYG104')).toEqual([])
      expect(diagnostics('SYG104')).toEqual([])
    })
  }
})
