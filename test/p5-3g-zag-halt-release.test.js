// @vitest-environment jsdom
// PLAN-5 3-G, G-438: after a G-409 halt (a render that throws on a machine-driven redraw), the
// owner's fallback replaces the host and unmount calls stop(). stop() returned early because the
// machine was already stopped, so the content was never released: a ref in the render kept the
// detached element, destroy hooks never ran, listeners stayed on. Now it is released; a mount
// that fails (SYG660) releases what it drew too.
import { it, expect, afterEach, vi } from 'vitest'
import * as menu from '@zag-js/menu'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { createRef } from '../src/extra/ref.ts'
import { fromZag } from '../src/zag.ts'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t, spy
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; spy?.mockRestore(); document.body.innerHTML = '' })

it('halted on a redraw: the ref is nulled, destroy hooks run, listeners come off', async () => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const ref = createRef()
  const destroyed = []
  let clicks = 0
  const M = fromZag(menu, (api) => {
    if (api.open) throw new Error('boom')
    return h('div', null,
      h('button', { className: 'tr', ref, ...api.getTriggerProps() }, 'T'),
      h('span', { className: 'x', hook: { destroy: () => destroyed.push('x') }, on: { click: () => clicks++ } }, 'x'),
      h('div', api.getPositionerProps(), h('div', api.getContentProps(), h('div', api.getItemProps({ value: 'a' }), 'a'))))
  }, { name: 'M' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  C.onError = () => h('p', { className: 'fb' }, 'fallback')
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await settle()
  const x = t.query('.m .x')
  expect(ref.current).toBe(t.query('.m .tr'))
  t.query('.m .tr').click()
  await settle(60)
  expect(t.query('.fb')).not.toBe(null)
  expect(ref.current).toBe(null)
  expect(destroyed).toEqual(['x'])
  x.click()
  expect(clicks).toBe(0)
})

it('a mount that fails after the first draw: what it drew is released', async () => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const ref = createRef()
  let draws = 0
  const M = fromZag(menu, (api) => {
    if (++draws == 2) throw new Error('second draw')
    return h('div', null, h('button', { className: 'tr', ref, ...api.getTriggerProps() }, 'T'))
  }, { name: 'M' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  C.onError = () => h('p', { className: 'fb' }, 'fallback')
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await settle()
  expect(t.query('.fb')).not.toBe(null)
  expect(ref.current).toBe(null)
})
