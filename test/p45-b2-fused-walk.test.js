// @vitest-environment jsdom
// PLAN-4.5 P45-B item 2: stampFields, preprocessVdom and getComponents walked the whole view
// tree three times per render (stamping every vnode, replacing every children array). Now one
// walk does the three, and it skips a subtree the pragma flagged plain (no component, marker,
// form field or vnode from elsewhere), so a view with none of them is not walked at all. What
// the walk must still find: form fields (G-146 stamp), components and markers anywhere,
// including in hoisted vnodes. (R5: the stamp and registered-name cases went with the old core.)
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { h as sh } from '../src/cycle/dom/snabbdom.js'
import { Transition } from '../src/transition.js'
import { Portal } from '../src/portal.js'
import { Collection } from '../src/collection.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; document.body.innerHTML = '' })

const all = (v, out = []) => { if (v && typeof v === 'object') { out.push(v); (v.children || []).forEach(c => all(c, out)) } return out }

describe('P45-B item 2: one view walk, skipped for plain subtrees', () => {
  it('a plain view is not walked: no vnode is stamped and the children arrays are kept', async () => {
    let tree, kids
    function App({ state }) {
      tree = h('div', { className: 'app' }, h('p', null, state.n), h('ul', null, h('li', null, 'a'), h('li', null, 'b')))
      kids = tree.children
      return tree
    }
    App.initialState = { n: 1 }
    t = renderComponent(App)
    await t.ready()
    expect(t.html()).toContain('<li>a</li>')
    expect(all(tree).some(v => v.data && 'inputSeq' in v.data)).toBe(false)
    expect(tree.children).toBe(kids)
  })

  it('a component inside a hoisted plain-looking subtree is instantiated', async () => {
    function Child({ state }) { return h('em', null, 'child') }
    const hoisted = h('section', null, h('div', null, h(Child, null)))
    function App() { return h('div', null, hoisted) }
    App.initialState = {}
    t = renderComponent(App)
    await t.ready()
    await t.settle()
    expect(t.html()).toContain('<em>child</em>')
  })

  it('a Collection, a Transition and a Portal deep in the tree are processed', async () => {
    function Item({ state }) { return h('li', null, state.name) }
    function App({ state }) {
      return h('div', null,
        h('div', null, h('div', null, h(Collection, { of: Item, from: 'items' }))),
        h('div', null, h(Transition, { name: 'fade' }, h('p', { className: 'tr' }, 'in'))),
        h('div', null, h(Portal, { target: 'body' }, h('i', null, 'portal'))))
    }
    App.initialState = { items: [{ id: 1, name: 'one' }] }
    t = renderComponent(App, { dom: 'real' })
    await t.ready()
    await t.settle()
    expect(t.container.innerHTML).toContain('<li>one</li>')
    expect(t.container.innerHTML).not.toContain('<transition')
    expect(t.container.innerHTML).toContain('data-sygnal-portal')
  })

})
