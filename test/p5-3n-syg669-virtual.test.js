// @vitest-environment jsdom
// PLAN-5 3-N G-493: SYG669 (special JSX inside a fromZag render) names <VirtualCollection> again:
// its control vnode carries the marker (`data.m`) as the pragma's markers do; a plain
// <virtual-collection> element stays clean.
import { it, expect, beforeEach, afterEach } from 'vitest'
import * as menu from '@zag-js/menu'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { VirtualCollection } from '../src/extra/virtual.ts'
import { fromZag } from '../src/zag.ts'

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }

let app
beforeEach(() => setupChecks())
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })
const mount = (App) => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
}
const shell = (api, ...inside) => h('div', null,
  h('button', { className: 'tr', ...api.getTriggerProps() }, 'T'),
  h('div', api.getPositionerProps(), h('div', api.getContentProps(), h('div', api.getItemProps({ value: 'a' }), 'a'), ...inside)))
const Row = ({ state }) => h('div', null, state.label)

it('<VirtualCollection> in a fromZag render: SYG669 names it', async () => {
  const M = fromZag(menu, (api) => shell(api, h(VirtualCollection, { of: Row, from: 'rows', estimateSize: 20 })), { name: 'Virt' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  C.initialState = { rows: [] }
  mount(C)
  await settle(60)
  const d = diagnostics('SYG669')
  expect(d).toHaveLength(1)
  expect(d[0].data.found).toEqual(['<VirtualCollection>'])
})

it('a plain <virtual-collection> element is not a marker', async () => {
  const M = fromZag(menu, (api) => shell(api, h('virtual-collection', { props: { title: 'x' } }, 'x')), { name: 'PlainVirt' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  mount(C)
  await settle(60)
  expect(diagnostics('SYG669')).toEqual([])
})
