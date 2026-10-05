// @vitest-environment jsdom
// PLAN-5 2-T (D211): SYG144 (a declared event the host also fires natively) skips the
// first-party Zag parts: Menu's `select` is its documented event. A user's fromZag widget that
// declares `select` still gets it.
import { it, expect, beforeEach, afterEach } from 'vitest'
import * as menu from '@zag-js/menu'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { fromZag } from '../src/zag.ts'
import { Menu } from '../src/ui-menu.ts'

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }

let app
beforeEach(() => setupChecks())
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })
const mount = (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
}

it('Menu: no SYG144', async () => {
  mount(() => h('div', null, h(Menu, { className: 'm', label: 'Actions', items: ['a'] })))
  await settle(60)
  expect(diagnostics('SYG144')).toEqual([])
})

it('a user fromZag widget declaring select: SYG144', async () => {
  const Mine = fromZag(menu, (api) => h('div', null, h('button', api.getTriggerProps(), 'T')), { name: 'Mine', events: { select: 'onSelect' } })
  mount(() => h('div', null, h(Mine, { className: 'm' })))
  await settle(60)
  expect(diagnostics('SYG144').map((d) => d.component)).toEqual(['widget Mine'])
})
