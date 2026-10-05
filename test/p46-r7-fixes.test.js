// @vitest-environment jsdom
// P46-R7: review fixes on the P46-P/Q fast paths.
import { describe, it, expect, afterEach } from 'vitest'
import { run, createElement as h } from '../src/index.js'

const ticks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }
let apps = []
afterEach(() => { apps.forEach((a) => a.dispose()); apps = []; document.body.innerHTML = '' })
function mount(App, options = {}) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  const app = run(App, {}, { mountPoint: '#root', ...options })
  apps.push(app)
  return { app, el, rt: app.__runtime }
}
const step = async (m, f) => { m.rt.setState('root', f); await m.rt.flushed(); await ticks() }

describe('G-349: a vnode with a hook object is never reused', () => {
  it('a hoisted hook object gets update/postpatch on every render, the output unchanged too', async () => {
    let post = 0, upd = 0
    const HOOK = { postpatch: () => post++, update: () => upd++ }
    function App({ state }) { return h('div', null, h('p', { hook: HOOK }, 'x'), h('i', null, String(state.shown))) }
    App.initialState = { shown: 1, n: 0 }
    const m = mount(App)
    await m.rt.flushed(); await ticks()
    await step(m, (s) => ({ ...s, shown: 2 }))
    expect([post, upd]).toEqual([1, 1])
    await step(m, (s) => ({ ...s, n: 1 }))
    expect([post, upd]).toEqual([2, 2])
  })

  it('refs still point at the element after a same-output render', async () => {
    const ref = { current: null }
    function App({ state }) { return h('div', null, h('p', { ref }, 'x'), h('i', null, String(state.k))) }
    App.initialState = { k: 1, n: 0 }
    const m = mount(App)
    await m.rt.flushed(); await ticks()
    const p = m.el.querySelector('p')
    expect(ref.current).toBe(p)
    await step(m, (s) => ({ ...s, n: 1 }))
    expect(ref.current).toBe(p)
    await step(m, (s) => ({ ...s, k: 2 }))
    expect(ref.current).toBe(m.el.querySelector('p'))
  })
})
