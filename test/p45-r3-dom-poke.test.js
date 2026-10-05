// @vitest-environment jsdom
// P45-R3 G-285: the DOM driver's `sygnal-dom` listener (G-261/G-276) was never removed: each
// run()/dispose() on the same mount point left one on the root element, keeping the disposed
// driver (its remembered vnode stream) alive. It now goes when the app stops, and moves with the
// root when a patch replaces it.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { pokeDOM } from '../src/cycle/dom/utils.ts'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })

const add = EventTarget.prototype.addEventListener, rm = EventTarget.prototype.removeEventListener
let pairs // [element, listener] of each live `sygnal-dom` listener
const live = { get size() { return pairs.length }, values: () => pairs.map(p => p[0]) }
function track() {
  pairs = []
  const at = (el, f) => pairs.findIndex(p => p[0] == el && p[1] == f)
  EventTarget.prototype.addEventListener = function (t, f, o) { if (t == 'sygnal-dom' && at(this, f) < 0) pairs.push([this, f]); return add.call(this, t, f, o) }
  EventTarget.prototype.removeEventListener = function (t, f, o) { const i = t == 'sygnal-dom' ? at(this, f) : -1; if (i >= 0) pairs.splice(i, 1); return rm.call(this, t, f, o) }
}
afterEach(() => {
  EventTarget.prototype.addEventListener = add
  EventTarget.prototype.removeEventListener = rm
  document.body.innerHTML = ''
})

describe('P45-R3 G-285: the poke listener', () => {
  it('5 run/dispose cycles on the same mount point leave no listener', async () => {
    track()
    function App({ state }) { return h('div', { className: 'x' }, String(state.n)) }
    App.initialState = { n: 0 }
    document.body.innerHTML = '<div id="root"></div>'
    for (let i = 0; i < 5; i++) {
      const app = run(App, {}, { mountPoint: '#root' })
      await until(() => expect(document.querySelector('.x')).toBeTruthy())
      expect(live.size).toBe(1)
      app.dispose()
      await sleep(30)
    }
    expect(live.size).toBe(0)
  })

  it('a root replaced by a patch: one listener, on the new root, and pokes still emit', async () => {
    track()
    let n = 0
    // the view's root is the mount point; its key changes after the first render, so that patch
    // replaces it (the first patch adopts it since 3-J, G-456)
    function App({ state }) { return h('div', { id: 'app', key: state.k }, h('p', { className: 'kid' }, 'hi')) }
    App.initialState = { k: 1 }
    App.intent = ({ DOM }) => ({ SEEN: DOM.select('.kid').elements() })
    App.model = { SEEN: { EFFECT: () => { n++ } }, BOOTSTRAP: () => ({ k: 2 }) }
    document.body.innerHTML = '<div id="app"></div>'
    const first = document.querySelector('#app')
    const app = run(App, {}, { mountPoint: '#app' })
    try {
      await until(() => expect(document.querySelector('.kid')).toBeTruthy())
      await until(() => expect(document.querySelector('#app')).not.toBe(first))
      await sleep(20)
      const root = document.querySelector('#app')
      expect(root).not.toBe(first)
      expect([...live.values()]).toEqual([root])
      const before = n
      pokeDOM(document.querySelector('.kid'))
      await until(() => expect(n).toBe(before + 1))
    } finally { app.dispose() }
  })
})
