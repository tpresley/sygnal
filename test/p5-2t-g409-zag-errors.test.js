// @vitest-environment jsdom
// PLAN-5 2-T, G-409: errors in a fromZag widget stay inside the widget error boundary.
// - A render that throws on a machine-driven redraw (a click opens the menu) is SYG661: the
//   owner's onError fallback renders in its place and the machine stops (no unhandled error).
// - A render that throws during start() (the second draw, after the machine started) stops the
//   machine before the error goes on as SYG660 (no leaked running machine).
import { it, expect, afterEach, vi } from 'vitest'
import * as menu from '@zag-js/menu'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { fromZag } from '../src/zag.ts'

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
let t, spy
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  spy?.mockRestore()
  document.body.innerHTML = ''
})

const parts = (api) => [
  h('button', { className: 'tr', ...api.getTriggerProps() }, 'T'),
  h('div', api.getPositionerProps(), h('div', api.getContentProps(), h('div', api.getItemProps({ value: 'a' }), 'a'))),
]

it('a render that throws on a machine-driven redraw: SYG661, the owner fallback, the machine stopped', async () => {
  const unhandled = []
  const onErr = (e) => unhandled.push(e.message)
  process.on('uncaughtException', onErr)
  spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  let x
  const M = fromZag(menu, (api, p, xx) => {
    x = xx
    if (api.open) throw new Error('boom in render')
    return h('div', null, parts(api))
  }, { name: 'M' })
  const appErrors = []
  function C() { return h('div', null, h(M, { className: 'm' })) }
  C.onError = (e) => { appErrors.push(e.message); return h('p', { className: 'fb' }, 'fallback') }
  try {
    t = renderComponent(C, { dom: 'real' })
    await t.ready()
    await settle()
    t.query('.m .tr').click()
    await settle(60)
  } finally {
    process.off('uncaughtException', onErr)
  }
  expect(unhandled).toEqual([])
  expect(appErrors).toEqual(['boom in render'])
  expect(t.query('.fb')?.textContent).toBe('fallback')
  expect(t.query('.m')).toBe(null)
  expect(x.machine.status).toBe('Stopped')
  expect(spy.mock.calls.some((c) => String(c[0]).includes('SYG661'))).toBe(true)
})

it('a render that throws in start() after the machine started: the machine is stopped, SYG660', async () => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  let x, draws = 0
  const M = fromZag(menu, (api, p, xx) => {
    x = xx
    if (++draws == 2) throw new Error('second draw')
    return h('div', null, parts(api))
  }, { name: 'M' })
  function C() { return h('div', null, h(M, { className: 'm' })) }
  C.onError = () => h('p', { className: 'fb' }, 'fallback')
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await settle()
  expect(t.query('.fb')).not.toBe(null)
  expect(x.machine.status).toBe('Stopped')
  expect(spy.mock.calls.some((c) => String(c[0]).includes('SYG660'))).toBe(true)
})
