// @vitest-environment jsdom
// P45-R G-264: the view walk gives a sub-component without a key its path id as `props.key`. Since
// P45-B the props object of `<Child props={obj} />` is the caller's (by reference), and the key
// was written into it. The walk copies the props now.
import { it, expect, afterEach, vi } from 'vitest'
import { run, component } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 2 })
let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

it("a props object lent to a sub-component isn't written to", async () => {
  const shared = Object.freeze({ label: 'L' })
  const open = { label: 'M' }
  const Child = component({ name: 'Child', view: ({ label }) => h('b', { className: 'c' }, label) })
  // a registered component used by name: its vnode's props are the object passed
  function App() { return h('div', null, h('Child', { props: shared }), h('Child', { props: open })) }
  App.components = { Child }
  App.initialState = {}
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root' })
  await until(() => expect([...document.querySelectorAll('.c')].map(e => e.textContent)).toEqual(['L', 'M']))
  expect(open).toEqual({ label: 'M' })
})
