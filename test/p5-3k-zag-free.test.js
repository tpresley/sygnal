// @vitest-environment jsdom
// PLAN-5 3-K G-472: fromZag's free() cleared the rendered vnode only after releasing it, so a
// destroy hook that stopped the widget (x.stop(): free() again) released the content again,
// recursing until the stack overflowed, and one that threw left it to be released again by a
// later stop(). The vnode is now cleared first: each destroy hook runs once.
import { it, expect, afterEach, vi } from 'vitest'
import * as menu from '@zag-js/menu'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { fromZag } from '../src/zag.ts'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t, spy
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; spy?.mockRestore(); document.body.innerHTML = '' })

const view = (api, hook) => h('div', null,
  h('button', { className: 'tr', ...api.getTriggerProps() }, 'T'),
  h('span', { className: 'x', hook }, 'x'),
  h('div', api.getPositionerProps(), h('div', api.getContentProps(), h('div', api.getItemProps({ value: 'a' }), 'a'))))

it('a destroy hook in the render that stops the widget runs once', async () => {
  let destroyed = 0, xs
  const M = fromZag(menu, (api, _p, x) => (xs = x, view(api, { destroy: () => { destroyed++; if (destroyed < 50) x.stop() } })), { name: 'M' })
  function C({ state }) { return h('div', null, state.on ? h(M, { className: 'm' }) : null) }
  C.initialState = { on: true }
  C.model = { OFF: () => ({ on: false }) }
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await settle()
  expect(t.query('.m .x')).not.toBe(null)
  t.simulateAction('OFF')
  await settle(60)
  expect(destroyed).toBe(1)
  xs.stop()
  expect(destroyed).toBe(1)
})

it('a destroy hook that throws: a later stop() does not release again', async () => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  let destroyed = 0, xs
  const M = fromZag(menu, (api, _p, x) => (xs = x, view(api, { destroy: () => { destroyed++; throw new Error('hook') } })), { name: 'M' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await settle()
  expect(() => xs.stop()).toThrow('hook')
  expect(destroyed).toBe(1)
  xs.stop()
  expect(destroyed).toBe(1)
})
