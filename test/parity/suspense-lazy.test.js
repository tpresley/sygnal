// @vitest-environment jsdom
// PLAN-4.6 parity: Suspense / READY and lazy (spike 0-S §4, ported to the public API).
import { it, expect } from 'vitest'
import { parity, mount, h, click, until, sleep, xs, Suspense, lazy } from './harness.js'

parity('parity: Suspense / READY and lazy', () => {
  function NotReady() { return h('div', { className: 'nr' }, 'not ready') }
  NotReady.isolatedState = true
  NotReady.initialState = {}
  NotReady.model = { BOOTSTRAP: { READY: () => false } }
  function Delayed({ state }) { return h('div', { className: 'delayed' }, state.ready ? 'Now ready!' : 'Still loading...') }
  Delayed.isolatedState = true
  Delayed.initialState = { ready: false }
  Delayed.intent = () => ({ BECOME_READY: xs.periodic(30).take(1) })
  Delayed.model = { BOOTSTRAP: { READY: () => false }, BECOME_READY: { STATE: (s) => ({ ...s, ready: true }), READY: () => true } }
  function Ready() { return h('div', { className: 'ready' }, 'ready') }

  it('renders the fallback (pending wrapper) while a child is not READY, then the content', async () => {
    function A() { return h('div', null, h(Suspense, { fallback: h('p', { className: 'fb' }, 'Loading') }, h(Delayed))) }
    A.initialState = {}
    const m = mount(A)
    await until(() => expect(m.text('.fb')).toBe('Loading'))
    expect(m.$('[data-sygnal-suspense="pending"]')).toBeTruthy()
    await until(() => expect(m.text('.delayed')).toBe('Now ready!'))
    expect(m.$('.fb')).toBe(null)
  })

  it('a string fallback; several resolved children; READY=false stays pending', async () => {
    function A() { return h('div', null, h(Suspense, { fallback: 'wait' }, h(NotReady)), h(Suspense, { fallback: 'x' }, h(Ready), h(Ready))) }
    A.initialState = {}
    const m = mount(A)
    await until(() => expect(m.$('[data-sygnal-suspense="pending"]')?.textContent).toBe('wait'))
    await until(() => expect(m.$$('.ready').length).toBe(2))
    await sleep(30)
    expect(m.$('[data-sygnal-suspense="pending"]')?.textContent).toBe('wait')
  })

  it('lazy: the Suspense fallback until the import resolves, then a working component with its state slice', async () => {
    let resolve
    const loaded = new Promise((r) => { resolve = r })
    function Heavy({ state }) { return h('button', { className: 'heavy' }, `heavy ${state.n}`) }
    Heavy.intent = ({ DOM }) => ({ INC: DOM.click('.heavy') })
    Heavy.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    const LazyHeavy = lazy(() => loaded)
    function A() { return h('div', null, h(Suspense, { fallback: h('i', { className: 'fb' }, '...') }, h(LazyHeavy, { state: 'heavy' }))) }
    A.initialState = { heavy: { n: 1 } }
    const m = mount(A)
    await until(() => expect(m.$('.fb')).toBeTruthy())
    resolve({ default: Heavy })
    await until(() => expect(m.text('.heavy')).toBe('heavy 1'))
    expect(m.$('.fb')).toBe(null)
    click(m.$('.heavy'))
    await until(() => expect(m.text('.heavy')).toBe('heavy 2'))
    expect(m.state().heavy.n).toBe(2)
  })
})
