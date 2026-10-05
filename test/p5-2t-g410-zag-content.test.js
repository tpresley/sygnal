// @vitest-environment jsdom
// PLAN-5 2-T, G-410: a fromZag render is patched by the adapter's own snabbdom patch, so Sygnal
// components, widget tags and special JSX (Portal, Transition, Collection…) can't run inside it.
// In dev (the diagnostics entry), SYG669 names what was found, once per widget; plain elements
// (and Zag's prop getters) are clean.
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as menu from '@zag-js/menu'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { defineWidget } from '../src/extra/widget.ts'
import { Transition } from '../src/transition.ts'
import { fromZag } from '../src/zag.ts'
import { getCodeInfo, DEV_CODE_SEVERITY, CODE_TITLES } from '../src/extra/diagnostics/codes.ts'

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }

let app
beforeEach(() => setupChecks())
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })
const mount = (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
}

const Icon = defineWidget({ name: 'Icon', tag: 'i', mount: (el) => { el.textContent = '*' } })
function Badge({ text }) { return h('b', { className: 'badge' }, text) }

it('SYG669 is a dev-entry warning with a title', () => {
  expect(DEV_CODE_SEVERITY.SYG669).toBe('warn')
  expect(CODE_TITLES.SYG669).toBeTruthy()
  expect(getCodeInfo('SYG669').severity).toBe('warn')
})

it('a component, a widget tag and a Transition inside a fromZag render: SYG669 once, naming them', async () => {
  const M = fromZag(menu, (api) => h('div', null,
    h('button', { className: 'tr', ...api.getTriggerProps() }, h(Icon, { className: 'ic' }), h(Badge, { text: 'hi' })),
    h('div', api.getPositionerProps(), h('div', api.getContentProps(), h(Transition, { name: 'fade' }, h('p', null, 'x'))))), { name: 'Actions' })
  function C({ state }) { return h('div', null, h(M, { className: 'm', n: state.n }), h('button', { className: 'b' }, 'b')) }
  C.initialState = { n: 0 }
  C.intent = ({ DOM }) => ({ B: DOM.click('.b') })
  C.model = { B: (s) => ({ n: s.n + 1 }) }
  mount(C)
  await settle(60)
  document.querySelector('.b').click()
  await settle(60)
  const d = diagnostics('SYG669')
  expect(d).toHaveLength(1)
  expect(d[0].message).toMatch(/widget Actions/)
  expect(d[0].message).toMatch(/<Badge>/)
  expect(d[0].message).toMatch(/<Icon>/)
  expect(d[0].message).toMatch(/<Transition>/)
  expect(d[0].fix).toMatch(/plain elements/)
})

it('plain elements only: no SYG669', async () => {
  const M = fromZag(menu, (api) => h('div', null,
    h('button', { className: 'tr', ...api.getTriggerProps() }, h('span', null, 'T')),
    h('div', api.getPositionerProps(), h('div', api.getContentProps(), h('div', api.getItemProps({ value: 'a' }), 'a')))), { name: 'Actions' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  mount(C)
  await settle(60)
  expect(diagnostics('SYG669')).toEqual([])
})
