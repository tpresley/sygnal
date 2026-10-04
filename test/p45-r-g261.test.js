// @vitest-environment jsdom
// P45-R G-261: the DOM source emits after Sygnal's patches (P45-C), not on other DOM changes
// (D146: those of other scripts). Two DOM changes Sygnal makes outside a patch now emit too:
// a Transition's leave removing its element after the transition, and a Portal mounting into a
// target that appeared after it (its retry timer).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { run, makeDOMDriver, Transition, Portal } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })

let apps = []
beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1)) })
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = ''; vi.unstubAllGlobals() })

/** run() with a DOM driver whose root element emissions are recorded (what the DOM has then) */
function mount(App, probe) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  const seen = []
  const inner = makeDOMDriver('#root')
  const DOM = (vnode$, name) => {
    const src = inner(vnode$, name)
    src.elements().addListener({ next: () => seen.push(probe(el)) })
    return src
  }
  apps.push(run(App, { DOM }, { mountPoint: '#root' }))
  return { seen, $: (s) => el.querySelector(s) }
}
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))

describe('P45-R G-261: out-of-patch DOM changes made by Sygnal emit', () => {
  it("a Transition's leave: the DOM source emits once the element is removed", async () => {
    function App({ state }) {
      return h('div', null, h('button', { className: 'hide' }, 'hide'),
        h(Transition, { name: 'fade', duration: 10 }, state.show ? h('p', { className: 't' }, 'hi') : null))
    }
    App.initialState = { show: true }
    App.intent = ({ DOM }) => ({ HIDE: DOM.click('.hide') })
    App.model = { HIDE: (s) => ({ show: false }) }
    const m = mount(App, (el) => el.querySelectorAll('.t').length)
    await until(() => expect(m.$('.t')).toBeTruthy())
    await sleep(30)
    click(m.$('.hide'))
    await until(() => expect(m.$('.t')).toBe(null))
    await sleep(10)
    expect(m.seen[m.seen.length - 1]).toBe(0)
  })

  it('a Portal mounted by its retry: the DOM source emits with its content in place', async () => {
    // Kid renders the target later, in a patch that leaves the Portal's placeholder as it was
    function Kid({ state }) { return h('div', null, h('button', { className: 'show' }, 'show'), state.on ? h('div', { id: 'tgt' }) : null) }
    Kid.initialState = { on: false }
    Kid.isolatedState = true
    Kid.intent = ({ DOM }) => ({ ON: DOM.click('.show') })
    Kid.model = { ON: () => ({ on: true }) }
    function App() { return h('div', null, h(Kid), h(Portal, { target: '#tgt' }, h('span', { className: 'pc' }, 'portal'))) }
    App.initialState = {}
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const m = mount(App, (el) => el.querySelectorAll('.pc').length)
      await until(() => expect(m.$('.show')).toBeTruthy())
      await sleep(10)
      click(m.$('.show'))
      await until(() => expect(m.$('.pc')).toBeTruthy())
      await sleep(10)
      expect(m.seen[m.seen.length - 1]).toBe(1)
    } finally { warn.mockRestore() }
  })
})
