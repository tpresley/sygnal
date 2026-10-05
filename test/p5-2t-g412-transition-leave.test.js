// @vitest-environment jsdom
// PLAN-5 2-T, G-412: an adapter widget inside <Transition> keeps its content while it leaves.
// - fromZag: stop() stops the machine but doesn't patch the content away; the content leaves
//   with the host; a ref in the render still gets its destroy (null) call.
// - fromReact: root.unmount() waits until the host has left the document.
import { it, expect, afterEach } from 'vitest'
import * as menu from '@zag-js/menu'
import { createElement as r, useEffect } from 'react'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.js'
import { Transition } from '../src/transition.ts'
import { createRef } from '../src/extra/ref.ts'
import { fromZag } from '../src/zag.ts'
import { fromReact } from '../src/react.ts'

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame ||= (f) => setTimeout(f, 0)

const settle = (ms = 30) => new Promise((res) => setTimeout(res, ms))
let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

const toggled = (widget) => {
  function C({ state }) {
    return h('div', null,
      state.on ? h(Transition, { name: 'fade', duration: 120 }, widget) : null,
      h('button', { className: 't' }, 't'))
  }
  C.initialState = { on: true }
  C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
  C.model = { T: (s) => ({ on: !s.on }) }
  document.body.innerHTML = '<div id="root"></div>'
  app = run(C, {}, { mountPoint: '#root', diagnostics: 'off' })
}

it('fromZag: the content stays while the host leaves; the machine stops; a ref in the render is released', async () => {
  const ref = createRef()
  let x
  const M = fromZag(menu, (api, p, xx) => {
    x = xx
    return h('div', null,
      h('button', { className: 'tr', ref, ...api.getTriggerProps() }, 'Actions'),
      h('div', api.getPositionerProps(), h('div', api.getContentProps(), h('div', api.getItemProps({ value: 'a' }), 'a'))))
  }, { name: 'M' })
  toggled(h(M, { className: 'w' }))
  await settle(150)
  const el = document.querySelector('.w')
  expect(ref.current).toBe(el.querySelector('.tr'))
  document.querySelector('.t').click()
  await settle(20)
  // leaving: still in the document, with its content
  expect(el.isConnected).toBe(true)
  expect(el.querySelector('.tr')?.textContent).toBe('Actions')
  expect(x.machine.status).toBe('Stopped')
  expect(ref.current).toBe(null)
  await settle(250)
  expect(el.isConnected).toBe(false)
})

it('fromReact: the React content stays while the host leaves; unmounted once it is gone', async () => {
  const log = []
  function Hello() {
    useEffect(() => { log.push('mount'); return () => log.push('unmount') }, [])
    return r('span', { className: 'hi' }, 'hello')
  }
  const W = fromReact(Hello)
  toggled(h(W, { className: 'w' }))
  await settle(150)
  const el = document.querySelector('.w')
  expect(el.querySelector('.hi')?.textContent).toBe('hello')
  document.querySelector('.t').click()
  await settle(20)
  expect(el.isConnected).toBe(true)
  expect(el.querySelector('.hi')?.textContent).toBe('hello')
  expect(log).toEqual(['mount'])
  await settle(250)
  expect(el.isConnected).toBe(false)
  expect(log).toEqual(['mount', 'unmount'])
})

it('fromReact: removed without a transition, it unmounts right away (next microtask)', async () => {
  const log = []
  function Hello() {
    useEffect(() => { log.push('mount'); return () => log.push('unmount') }, [])
    return r('span', null, 'hello')
  }
  const W = fromReact(Hello)
  function C({ state }) { return h('div', null, state.on ? h(W, { className: 'w' }) : null, h('button', { className: 't' }, 't')) }
  C.initialState = { on: true }
  C.intent = ({ DOM }) => ({ T: DOM.click('.t') })
  C.model = { T: (s) => ({ on: !s.on }) }
  document.body.innerHTML = '<div id="root"></div>'
  app = run(C, {}, { mountPoint: '#root', diagnostics: 'off' })
  await settle(60)
  document.querySelector('.t').click()
  await settle(20)
  expect(log).toEqual(['mount', 'unmount'])
})
