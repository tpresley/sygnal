// @vitest-environment jsdom
// PLAN-5 3-M G-480: the <Slot> marker is told by its marker flag (`data.m`), not by its tag, so a
// plain <slot> element (a shadow-DOM component's) renders as an element: on the client (passed
// as a child, where the core splits children into slots) and in renderToString.
import { describe, it, expect, afterEach } from 'vitest'
import { run, renderToString, Slot } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'
import { defineElement } from '../src/element.ts'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 2000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
afterEach(() => { document.body.innerHTML = '' })

function Panel({ slots }) {
  return h('section', { className: 'panel' }, h('header', null, ...(slots.head || [])), h('div', { className: 'body' }, ...(slots.default || [])))
}

describe('G-480: a plain <slot> element', () => {
  it('in a sygnal/element shadow: true component, passed to a child component', async () => {
    function Card() {
      return h('div', { className: 'card' }, h('slot', { name: 'own' }), h(Panel, null, h('slot', { name: 'inner' }), h(Slot, { name: 'head' }, h('b', null, 'H'))))
    }
    Card.initialState = {}
    defineElement('p5-3m-slot-card', Card, { shadow: true })
    document.body.innerHTML = '<p5-3m-slot-card><i slot="inner">light</i></p5-3m-slot-card>'
    const root = document.body.firstElementChild.shadowRoot
    await until(() => root.querySelector('.panel'), 'render')
    expect(root.querySelector('.card > slot[name="own"]')).toBeTruthy()
    expect(root.querySelector('.panel .body > slot[name="inner"]')).toBeTruthy()
    // the marker still fills the named slot
    expect(root.querySelector('.panel header b')?.textContent).toBe('H')
    expect(root.querySelector('slot[name="head"]')).toBeNull()
  })

  it('in run(): a plain <slot> child is a child, the <Slot> marker a slot', async () => {
    function App() { return h('main', null, h(Panel, null, h('slot', null), h(Slot, { name: 'head' }, 'T'))) }
    App.initialState = {}
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(App, {}, { mountPoint: '#root' })
    await sleep(30)
    expect(document.getElementById('root').innerHTML).toBe('<main><section class="panel"><header>T</header><div class="body"><slot></slot></div></section></main>')
    app.dispose()
  })

  it('renderToString writes it as an element (in a view and as a child)', () => {
    function App() { return h('div', null, h('slot', { name: 'own' }), h(Panel, null, h('slot', null, 'fallback'), h(Slot, { name: 'head' }, 'T'))) }
    App.initialState = {}
    const html = renderToString(App, { hydrateState: false })
    expect(html).toContain('<slot name="own"></slot>')
    expect(html).toContain('<header>T</header><div class="body"><slot>fallback</slot></div>')
  })
})
