// @vitest-environment jsdom
// PLAN-4.5 P45-B item 2: stampFields, preprocessVdom and getComponents walked the whole view
// tree three times per render (stamping every vnode, replacing every children array). Now one
// walk does the three, and it skips a subtree the pragma flagged plain (no component, marker,
// form field or vnode from elsewhere), so a view with none of them is not walked at all. What
// the walk must still find: form fields (G-146 stamp), components and markers anywhere,
// including in hoisted vnodes, in vnodes built with snabbdom's h(), and by registered name.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { h as sh } from '../src/cycle/dom/snabbdom.js'
import { Transition } from '../src/transition.js'
import { Portal } from '../src/portal.js'
import { Collection } from '../src/collection.js'
import component from '../src/component.js'

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

  it('form fields are stamped (G-146), their plain siblings are not', async () => {
    let tree
    function App({ state }) {
      return (tree = h('div', null, h('section', null, h('p', null, 'x')), h('label', null, h('input', { className: 'f', value: state.v }), h('textarea', { value: '' }), h('select', null, h('option', null, 'o')))))
    }
    App.initialState = { v: 'a' }
    t = renderComponent(App)
    await t.ready()
    const [section, label] = tree.children
    const [input, textarea, select] = label.children
    for (const f of [input, textarea, select]) expect(typeof f.data.inputSeq).toBe('number')
    expect('inputSeq' in section.data).toBe(false)
    expect('inputSeq' in section.children[0].data).toBe(false)
  })

  it('a hoisted vnode with a field is stamped on every render', async () => {
    const hoisted = h('div', null, h('input', { className: 'h' }))
    let n = 0
    function App({ state }) { n++; return h('main', null, h('b', null, state.n), hoisted) }
    App.initialState = { n: 1 }
    App.intent = ({ DOM }) => ({ INC: DOM.click('b') })
    App.model = { INC: s => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(App)
    await t.ready()
    const first = hoisted.children[0].data.inputSeq
    expect(typeof first).toBe('number')
    hoisted.children[0].data.inputSeq = -1
    t.simulateEvent('b', 'click')
    await t.waitForState(s => s.n === 2)
    await t.settle()
    expect(n).toBeGreaterThan(1)
    expect(hoisted.children[0].data.inputSeq).not.toBe(-1)
  })

  it('a field and a component in vnodes built with snabbdom h() are found', async () => {
    let tree
    function Child() { return h('em', null, 'child') }
    const Factory = component({ name: 'Fact', view: () => h('strong', null, 'fact') })
    function App() {
      return (tree = h('div', null, sh('div', {}, [sh('input', { props: { value: 'x' } })]), sh('span', { props: { sygnalFactory: Factory } }, [])))
    }
    App.initialState = {}
    t = renderComponent(App)
    await t.ready()
    await t.settle()
    expect(typeof tree.children[0].children[0].data.inputSeq).toBe('number')
    expect(t.html()).toContain('<strong>fact</strong>')
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

  it('a component registered by name (.components) inside a plain tree is instantiated', async () => {
    const Badge = component({ name: 'Badge', view: () => h('b', { className: 'badge' }, 'ok') })
    function Page() { return h('div', null, h('section', null, h('Badge'))) }
    Page.components = { Badge }
    Page.initialState = {}
    t = renderComponent(Page)
    await t.ready()
    await t.settle()
    expect(t.html()).toMatch(/<b class="badge"[^>]*>ok<\/b>/)
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

  it('the children of a child component are preprocessed in the parent (a Transition inside)', async () => {
    let seen
    function Wrap({ children }) { seen = children; return h('div', { className: 'wrap' }, ...children) }
    function App() { return h('div', null, h(Wrap, null, h(Transition, { name: 'fade' }, h('p', null, 'x')))) }
    App.initialState = {}
    t = renderComponent(App)
    await t.ready()
    await t.settle()
    expect(seen[0].sel).toBe('p')
    expect(typeof seen[0].data.hook.insert).toBe('function')
  })
})
