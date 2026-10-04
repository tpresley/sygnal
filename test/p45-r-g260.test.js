// @vitest-environment jsdom
// P45-R G-260: an app that stores a value derived from the DOM after each patch that is never the
// same twice (a measurement that changes the layout, a timestamp) loops patch -> element ->
// action -> reducer -> flush -> patch. With microtask flushes that loop never yielded (the tab
// froze); before PLAN-4.5 the render debounce timers paced it. The scheduler now counts the
// flushes of a macrotask: after 100 the next flush waits for a macrotask.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { run } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = (fn) => vi.waitFor(fn, { timeout: 3000, interval: 2 })
const microtasks = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve() }

let apps = []
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = '' })

function mount(App) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  apps.push(run(App, {}, { mountPoint: '#root' }))
  return { $: (s) => el.querySelector(s) }
}

describe('P45-R G-260: a render loop yields to the event loop', () => {
  it('a timer scheduled before the loop runs while it is going', async () => {
    const CAP = 3000
    let n = 0
    function App({ state }) { n = state.n; return h('p', { className: 'n' }, String(state.n)) }
    App.initialState = { n: 0 }
    // every patch emits the elements; every emission makes a new state: a loop
    App.intent = ({ DOM }) => ({ TICK: DOM.select('.n').elements() })
    App.model = { TICK: (s) => s.n < CAP ? { n: s.n + 1 } : s }
    const m = mount(App)
    await until(() => expect(m.$('.n')).toBeTruthy())
    let seen = -1
    setTimeout(() => { seen = n }, 0)
    await until(() => expect(seen).toBeGreaterThan(-1))
    // the timer ran while the loop was still going
    expect(seen).toBeLessThan(CAP)
    await until(() => expect(m.$('.n').textContent).toBe(String(CAP)))
  })

  it('a normal app never waits: 150 clicks, each patched within microtasks', async () => {
    function App({ state }) { return h('button', { className: 'b' }, String(state.n)) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('.b') })
    App.model = { INC: (s) => ({ n: s.n + 1 }) }
    const m = mount(App)
    await until(() => expect(m.$('.b')).toBeTruthy())
    await sleep(20)
    for (let i = 1; i <= 150; i++) {
      m.$('.b').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await microtasks()
      expect(m.$('.b').textContent).toBe(String(i))
      await sleep(0)
    }
  })
})
