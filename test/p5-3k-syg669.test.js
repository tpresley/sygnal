// @vitest-environment jsdom
// PLAN-5 3-K G-470: SYG669 tells a marker (<Slot>, <Transition>, ...) from a plain element of
// the same tag by the pragma's marker flag (`data.m`), not by "not a plain vnode": a plain <slot>
// whose child is a form field (so not `$p`) was reported as <Slot>. And the "already reported"
// state was set on the widget tag even when nothing was reported (diagnostics off), so a later app
// or test never got the report.
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as menu from '@zag-js/menu'
import { setupChecks, diagnostics, settle } from './diagnostics/helpers.js'
import { createElement as h } from '../src/pragma/index.js'
import { jsx } from '../src/jsx-runtime.js'
import run from '../src/extra/run.js'
import { Slot } from '../src/slot.ts'
import { Transition } from '../src/transition.ts'
import { fromZag } from '../src/zag.ts'

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }

let app
beforeEach(() => setupChecks())
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })
const mount = (App, diagnostics = 'collect') => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics })
}
const shell = (api, ...inside) => h('div', null,
  h('button', { className: 'tr', ...api.getTriggerProps() }, 'T'),
  h('div', api.getPositionerProps(), h('div', api.getContentProps(), h('div', api.getItemProps({ value: 'a' }), 'a'), ...inside)))

it('the pragma flags marker vnodes (data.m), not plain elements or components', () => {
  expect(h(Slot, null, h('input')).data.m).toBe(Slot)
  expect(jsx(Transition, {}).data.m).toBe(Transition)
  expect(h(Slot, null).data.c).toBeUndefined()
  expect(h('slot', null, h('input')).data.m).toBeUndefined()
  function C() { return null }
  expect(h(C, null).data).toMatchObject({ c: C })
  expect(h(C, null).data.m).toBeUndefined()
})

it('a plain <slot> with an <input> (or a <select>) is not a marker; <Slot> with one is', async () => {
  const P = fromZag(menu, (api) => shell(api, h('slot', { name: 'f' }, h('input', { name: 'q' })), h('slot', null, h('select', null))), { name: 'PlainField' })
  const S = fromZag(menu, (api) => shell(api, h(Slot, null, h('input', { name: 'q' }))), { name: 'SlotField' })
  function C() { return h('div', null, h(P, { className: 'p' }), h(S, { className: 's' })) }
  mount(C)
  await settle(60)
  const d = diagnostics('SYG669')
  expect(d).toHaveLength(1)
  expect(d[0].message).toContain('SlotField')
  expect(d[0].data.found).toEqual(['<Slot>'])
})

it('reported for the widget in a later app after an app with diagnostics off', async () => {
  const M = fromZag(menu, (api) => shell(api, h(Transition, null, h('p', null, 't'))), { name: 'Later' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  mount(C, 'off')
  await settle(60)
  app.dispose(); app = null
  mount(C)
  await settle(60)
  expect(diagnostics('SYG669')).toHaveLength(1)
})

it('reported again in a second app after the checks are reset (e.g. the next test)', async () => {
  const M = fromZag(menu, (api) => shell(api, h(Transition, null, h('p', null, 't'))), { name: 'Twice' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  mount(C)
  await settle(60)
  expect(diagnostics('SYG669')).toHaveLength(1)
  app.dispose(); app = null
  setupChecks()
  mount(C)
  await settle(60)
  expect(diagnostics('SYG669')).toHaveLength(1)
})

it('two instances of one widget: one report', async () => {
  const M = fromZag(menu, (api) => shell(api, h(Transition, null, h('p', null, 't'))), { name: 'Pair' })
  function C() { return h('div', null, h(M, { className: 'a' }), h(M, { className: 'b' })) }
  mount(C)
  await settle(60)
  expect(diagnostics('SYG669')).toHaveLength(1)
})
