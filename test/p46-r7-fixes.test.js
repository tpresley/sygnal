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

describe('G-350: the pragma caches stay bounded', () => {
  it('dynamic selectors and data keys do not grow the caches', async () => {
    const { createElement: ce, createElementWithModules, __cacheSizes } = await import('../src/pragma/index.ts')
    for (let i = 0; i < 50; i++) ce('li#row-w' + i, null, 'x')
    const before = __cacheSizes(ce)
    for (let i = 0; i < 3000; i++) { ce('li#row-' + i, null, 'x'); ce('div.c' + i, { ['data-k' + i]: i }); ce('span', { ['aria-x' + i]: 'y' }) }
    const after = __cacheSizes(ce)
    expect(after.tags).toBeLessThanOrEqual(before.tags + 2)
    expect(after.routes).toBeLessThanOrEqual(1024)
    // a fresh createElement: its route map is capped too
    const ce2 = createElementWithModules({ attrs: '', props: '', class: '', data: 'dataset', style: '', hook: '', on: '' })
    for (let i = 0; i < 3000; i++) ce2('p', { ['data-k' + i]: i })
    expect(__cacheSizes(ce2).routes).toBeLessThanOrEqual(1024)
    // still routed right past the cap
    const v = ce2('p', { 'data-late-key': 1, 'aria-label': 'l', title: 't' })
    expect(v.data).toEqual({ dataset: { lateKey: 1 }, attrs: { 'aria-label': 'l' }, props: { title: 't' } })
  })

  it('a selector with an id or class keeps the exact-tag rules (SVG, form fields, hosts)', async () => {
    const { createElement: ce } = await import('../src/pragma/index.ts')
    expect(ce('circle', { r: 1 }).data.ns).toBe('http://www.w3.org/2000/svg')
    // as before P46-P: only the bare tag is an SVG tag
    expect(ce('circle.c', { r: 1 }).data.ns).toBe(undefined)
    expect(ce('input', null).$p).toBe(undefined)
    expect(ce('input.x', null).$p).toBe(undefined)
    expect(ce('input#y', null).$p).toBe(undefined)
    expect(ce('collection', null).$p).toBe(undefined)
    expect(ce('collection.x', null).$p).toBe(1)
    expect(ce('div.x#y', null).$p).toBe(1)
  })
})
