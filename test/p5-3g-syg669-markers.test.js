// @vitest-environment jsdom
// PLAN-5 3-G, G-439: SYG669 (special JSX inside a fromZag render) missed prop-less markers
// (`<Suspense>`, `<ClientOnly>`, `h(Transition, null)`: no data.props) and `<Slot>`; a plain
// <slot> element stays clean. Once reported, the render isn't walked again (it ran on every draw).
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as menu from '@zag-js/menu'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { Transition } from '../src/transition.ts'
import { Suspense } from '../src/suspense.ts'
import { Slot } from '../src/slot.ts'
import { ClientOnly } from '../src/vike/ClientOnly.ts'
import { fromZag } from '../src/zag.ts'

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }

let app
beforeEach(() => setupChecks())
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })
const mount = (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
}
const shell = (api, ...inside) => h('div', null,
  h('button', { className: 'tr', ...api.getTriggerProps() }, 'T'),
  h('div', api.getPositionerProps(), h('div', api.getContentProps(), h('div', api.getItemProps({ value: 'a' }), 'a'), ...inside)))

it('prop-less markers and <Slot>: SYG669 names them', async () => {
  const M = fromZag(menu, (api) => shell(api,
    h(Suspense, null, h('p', null, 's')),
    h(ClientOnly, null, h('p', null, 'c')),
    h(Transition, null, h('p', null, 't')),
    h(Slot, null, h('p', null, 'x'))), { name: 'Bare' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  mount(C)
  await settle(60)
  const d = diagnostics('SYG669')
  expect(d).toHaveLength(1)
  expect(d[0].data.found).toEqual(['<Suspense>', '<ClientOnly>', '<Transition>', '<Slot>'])
})

it('a plain <slot> element (and one with text) is not a marker', async () => {
  const M = fromZag(menu, (api) => shell(api, h('slot', null), h('slot', { name: 'n' }, 'fallback'), h('slot', null, h('span', null, 'x'))), { name: 'Plain' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  mount(C)
  await settle(60)
  expect(diagnostics('SYG669')).toEqual([])
})

it('after reporting, later draws do not walk the render', async () => {
  let walks = 0
  // the walk visits an array render through forEach; the patch doesn't use it
  class Counted extends Array { forEach(f) { walks++; return super.forEach(f) } }
  const M = fromZag(menu, (api) => Counted.from(shell(api, h(Transition, null, h('p', null, 't'))).children), { name: 'Walked' })
  function C({ state }) { return h('div', null, h(M, { className: 'm', n: state.n }), h('button', { className: 'b' }, 'b')) }
  C.initialState = { n: 0 }
  C.intent = ({ DOM }) => ({ B: DOM.click('.b') })
  C.model = { B: (s) => ({ n: s.n + 1 }) }
  mount(C)
  await settle(60)
  expect(walks).toBe(1)
  document.querySelector('.b').click()
  await settle(60)
  document.querySelector('.m .tr').click()
  await settle(60)
  expect(diagnostics('SYG669')).toHaveLength(1)
  expect(walks).toBe(1)
})
