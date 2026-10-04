// @vitest-environment jsdom
// P45-R G-271: a component's sink hubs (its own sinks + its children's) looked each kept stream up
// in two arrays on every render: O(children^2 x sinks). They use a Set now. Counted as the array lengths
// Array.prototype.includes scans during one re-render of a parent with 300 child components.
import { it, expect, afterEach, vi } from 'vitest'
import { run } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const until = (fn) => vi.waitFor(fn, { timeout: 4000, interval: 5 })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = ''; vi.restoreAllMocks() })

it('re-rendering a parent of 300 children does not scan the sink lists per child', async () => {
  function Kid({ i }) { return h('i', { className: 'k' }, String(i)) }
  Kid.model = { NOP: { EVENTS: () => null } }
  function App({ state }) { return h('div', null, h('b', { className: 'n' }, String(state.n)), ...Array.from({ length: 300 }, (_, i) => h(Kid, { i, key: 'k' + i }))) }
  App.initialState = { n: 0 }
  App.intent = ({ DOM }) => ({ INC: DOM.click('.n') })
  App.model = { INC: (s) => ({ n: s.n + 1 }) }
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root' })
  await until(() => expect(document.querySelectorAll('.k').length).toBe(300))
  await sleep(20)
  // the array lengths scanned by includes() during the update
  const real = Array.prototype.includes
  let scanned = 0
  Array.prototype.includes = function (...a) { scanned += this.length; return real.apply(this, a) }
  try {
    document.querySelector('.n').click()
    await until(() => expect(document.querySelector('.n').textContent).toBe('1'))
  } finally { Array.prototype.includes = real }
  expect(scanned).toBeLessThan(20000)
})
