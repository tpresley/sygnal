// @vitest-environment jsdom
// P45-R G-269: the render parameters named the children + slots input 'c', so a peer named `c`
// took its place: the view got no children and no peer. Its key can't be a peer's name now.
import { it, expect, afterEach, vi } from 'vitest'
import { run, component } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

it('a peer named c and children both reach the view', async () => {
  const c = component({ name: 'C', view: () => h('b', { className: 'peer' }, 'P') })
  function Box({ peers, children }) { return h('div', { className: 'box' }, peers.c, ...(children || [])) }
  Box.peers = { c }
  function App() { return h('div', null, h(Box, null, h('span', { className: 'kid' }, 'K'))) }
  App.initialState = {}
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root' })
  await until(() => expect(document.querySelector('.box')?.textContent).toBe('PK'))
})
