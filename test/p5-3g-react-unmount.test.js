// @vitest-environment jsdom
// PLAN-5 3-G, G-437: fromReact's deferred root.unmount() waited for a document mutation that
// shows the host gone. A host inside a shadow root (sygnal/element `shadow: true`) is removed in
// the shadow tree, which a document observer never sees: the React root and the observer leaked.
// Now every root on the way up is observed, and a destroyed host still in the DOM unmounts after
// a bound (10 s).
import { it, expect, afterEach, vi } from 'vitest'
import { createElement as r, useEffect } from 'react'
import { createElement as h } from '../src/pragma/index.js'
import { defineElement } from '../src/element.ts'
import { run } from '../src/index.ts'
import { Transition } from '../src/transition.ts'
import { fromReact } from '../src/react.ts'

const settle = (ms = 30) => new Promise((res) => setTimeout(res, ms))
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

const tracked = (log) => fromReact(function Hello() {
  useEffect(() => { log.push('mount'); return () => log.push('unmount') }, [])
  return r('span', { className: 'hi' }, 'hello')
})

// the widget inside a <Transition> (the host leaves after 120 ms: unmount waits for its removal)
const leaving = (W) => {
  function Panel({ state }) {
    return h('div', null,
      state.on ? h(Transition, { name: 'fade', duration: 120 }, h(W, { className: 'w' })) : null,
      h('button', { className: 't' }, 't'))
  }
  Panel.initialState = { on: true }
  Panel.intent = ({ DOM }) => ({ T: DOM.click('.t') })
  Panel.model = { T: (s) => ({ on: !s.on }) }
  return Panel
}

it('inside a sygnal/element shadow root: once the leaving host is removed, the React root unmounts', async () => {
  const log = []
  defineElement('p5-3g-shadow-panel', leaving(tracked(log)), { shadow: true })
  const el = document.createElement('p5-3g-shadow-panel')
  document.body.appendChild(el)
  await settle(60)
  const root = el.shadowRoot, w = root.querySelector('.w')
  expect(w.querySelector('.hi')?.textContent).toBe('hello')
  root.querySelector('.t').click()
  await settle(20)
  expect(w.isConnected).toBe(true)
  expect(log).toEqual(['mount'])
  await settle(250)
  expect(w.isConnected).toBe(false)
  expect(log).toEqual(['mount', 'unmount'])
})

it('a manual shadow root (the app mounted inside it): the removal inside it is seen', async () => {
  const log = []
  const outer = document.body.appendChild(document.createElement('div'))
  const shadow = outer.attachShadow({ mode: 'open' })
  const mountPoint = shadow.appendChild(document.createElement('div'))
  const app = run(leaving(tracked(log)), {}, { mountPoint, diagnostics: 'off' })
  try {
    await settle(60)
    expect(log).toEqual(['mount'])
    shadow.querySelector('.t').click()
    await settle(250)
    expect(shadow.querySelector('.w')).toBe(null)
    expect(log).toEqual(['mount', 'unmount'])
  } finally { app.dispose() }
})

it('a destroyed host that stays in the DOM unmounts after the bound', async () => {
  const log = []
  const W = tracked(log)
  // a widget destroyed by hand while its element stays put (as a leave that never ends would)
  const el = document.body.appendChild(document.createElement('div'))
  vi.useFakeTimers()
  const i = W.def.mount(el, {}, () => {})
  expect(log).toEqual(['mount'])
  W.def.unmount(i)
  await vi.advanceTimersByTimeAsync(9000)
  expect(log).toEqual(['mount'])
  expect(el.querySelector('.hi')).not.toBe(null)
  await vi.advanceTimersByTimeAsync(1100)
  expect(log).toEqual(['mount', 'unmount'])
  expect(el.querySelector('.hi')).toBe(null)
})
