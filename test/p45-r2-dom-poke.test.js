// @vitest-environment jsdom
// P45-R2 G-276 / G-277 / G-279: the `sygnal-dom` event (G-261) that makes an app's DOM source
// emit for a DOM change Sygnal makes outside a patch (a Transition's leave, a late Portal).
// - G-276: it was listened for on the first root element only; a patch that replaces the root
//   (mount point `#app`, view `<div id="app">`: `div` vs `div#app`) left the app without it.
// - G-277: it kept bubbling past the app's root: an app nested in another (an island, a custom
//   element) made the outer app's DOM source emit too, and it reached document.
// - G-279: a Transition's leave poked right after its own remove callback, but an element that
//   also has a `style.remove` is removed later (at its own transitionend).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, makeDOMDriver, Transition } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { pokeDOM } from '../src/cycle/dom/utils.ts'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })

let apps = []
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1)) })
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** run() at `#id` (inside `parent`), recording what `probe` reads when the DOM source emits */
function mount(App, id, probe = () => 1, parent = document.body) {
  const el = document.createElement('div')
  el.id = id
  parent.appendChild(el)
  const seen = []
  const inner = makeDOMDriver('#' + id)
  const DOM = (vnode$, name) => {
    const src = inner(vnode$, name)
    src.elements().addListener({ next: () => seen.push(probe()) })
    return src
  }
  apps.push(run(App, { DOM }, { mountPoint: '#' + id }))
  return { seen, first: el }
}

describe('P45-R2 G-276: the root element replaced by the first patch', () => {
  it('a poke inside the new root still emits', async () => {
    function App() { return h('div', { id: 'app' }, h('p', { className: 'kid' }, 'hi')) }
    App.initialState = {}
    const m = mount(App, 'app')
    await until(() => expect(document.querySelector('.kid')).toBeTruthy())
    await sleep(20)
    expect(document.querySelector('#app')).not.toBe(m.first) // the shape this is about
    const before = m.seen.length
    pokeDOM(document.querySelector('.kid'))
    expect(m.seen.length).toBe(before + 1)
  })
})

describe('P45-R2 G-277: nested apps', () => {
  it("a poke inside the inner app emits the inner app's DOM source only", async () => {
    function Outer() { return h('div', null, h('section', { className: 'slot' })) }
    Outer.initialState = {}
    function Inner() { return h('div', null, h('p', { className: 'in' }, 'in')) }
    Inner.initialState = {}
    const outer = mount(Outer, 'outer')
    await until(() => expect(document.querySelector('.slot')).toBeTruthy())
    const inner = mount(Inner, 'inner', () => 1, document.querySelector('.slot'))
    await until(() => expect(document.querySelector('.in')).toBeTruthy())
    await sleep(20)
    const onDoc = vi.fn()
    document.addEventListener('sygnal-dom', onDoc)
    try {
      const o = outer.seen.length, i = inner.seen.length
      pokeDOM(document.querySelector('.in'))
      expect(inner.seen.length).toBe(i + 1)
      expect(outer.seen.length).toBe(o)
      expect(onDoc).not.toHaveBeenCalled()
      // a poke in the outer app (outside the inner one) still emits the outer one
      pokeDOM(document.querySelector('.slot'))
      expect(outer.seen.length).toBe(o + 1)
    } finally { document.removeEventListener('sygnal-dom', onDoc) }
  })
})

describe('P45-R2 G-279: a Transition leave on an element with a style.remove', () => {
  it('emits once the element is gone', async () => {
    function App({ state }) {
      return h('div', null, h('button', { className: 'hide' }, 'hide'),
        h(Transition, { name: 'fade', duration: 5 }, state.show ? h('p', { className: 't', style: { remove: { opacity: '0' } } }, 'hi') : null))
    }
    App.initialState = { show: true }
    App.intent = ({ DOM }) => ({ HIDE: DOM.click('.hide') })
    App.model = { HIDE: () => ({ show: false }) }
    const m = mount(App, 'root', () => document.querySelectorAll('.t').length)
    await until(() => expect(document.querySelector('.t')).toBeTruthy())
    await sleep(20)
    // jsdom computes no transitions: the style module waits for one transitionend of opacity
    const gcs = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => el.classList?.contains('t') ? { 'transition-property': 'opacity' } : gcs(el))
    const t = document.querySelector('.t')
    document.querySelector('.hide').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // D212: deterministic: the leave starts (its classes go on), then ends (they come off in the
    // same callback that hands the element to the style module's remove, which stays pending)
    await until(() => expect(t.classList.contains('fade-leave-active')).toBe(true))
    await until(() => expect(t.classList.contains('fade-leave-active')).toBe(false))
    expect(t.parentNode).toBeTruthy()
    const before = m.seen.length
    t.dispatchEvent(new Event('transitionend'))
    expect(t.parentNode).toBe(null)
    expect(m.seen.length).toBe(before + 1)
    expect(m.seen[m.seen.length - 1]).toBe(0)
  })
})
