// @vitest-environment jsdom
// PLAN-4.5 P45-A item 2 (audit finding 1, rec 2): a render keeps the vnodes of what didn't
// change. processSuspensePost copied every vnode with children on every render, and
// injectComponents copied every ancestor, so snabbdom's `oldVnode === vnode` shortcut never
// fired and each child render re-diffed the whole tree. Now both return their input when
// nothing changed and copy only the path to a changed node, so an unchanged subtree (a sibling
// component, the other Collection items) is skipped. Counted with a snabbdom module whose
// update hook runs once for each vnode patchVnode actually diffs.
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'
import run from '../src/extra/run.js'
import { makeDOMDriver } from '../src/cycle/dom/makeDOMDriver.js'
import defaultModules from '../src/cycle/dom/modules.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { Suspense } from '../src/suspense.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let app
afterEach(() => { if (app) app.dispose(); app = null; _resetDiagnostics(); document.body.innerHTML = '' })

const wait = (ms = 40) => new Promise(r => setTimeout(r, ms))
async function until(pred, ms = 2000) {
  const end = Date.now() + ms
  while (!pred()) { if (Date.now() > end) throw new Error('timeout'); await wait(5) }
  await wait(40)
}

let diffed = []
const counter = { update: (_old, vnode) => { diffed.push(vnode) } }
function start(App) {
  const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
  app = run(App, { DOM: makeDOMDriver('#root', { modules: [...defaultModules, counter], snabbdomOptions: { experimental: { fragments: true } } }) }, { mountPoint: '#root' })
  return root
}
const click = (root, sel) => root.querySelector(sel).dispatchEvent(new Event('click', { bubbles: true }))
const diffedIn = (sel) => diffed.filter(v => v.elm && v.elm.closest && v.elm.closest(sel)).length

// ---- a 200-item Collection: select one item
function Item({ state }) {
  return h('tr', { className: state.sel ? 'row danger' : 'row' },
    h('td', { className: 'id' }, String(state.id)),
    h('td', null, h('a', { className: 'lbl' }, state.label)),
    h('td', null, h('a', { className: 'remove' }, h('span', { className: 'icon' }, 'x'))))
}
Item.intent = ({ DOM }) => ({ PICK: DOM.click('.lbl') })
Item.model = { PICK: (s) => ({ ...s, sel: true }) }

function Table({ state }) {
  return h('div', null,
    h('p', { className: 'title' }, state.title),
    h('button', { className: 'retitle' }, 'retitle'),
    h('table', null, h('tbody', null, h(Collection, { of: Item, from: 'rows' }))))
}
Table.initialState = { title: 't0', rows: Array.from({ length: 200 }, (_, i) => ({ id: i, label: 'r' + i, sel: false })) }
Table.intent = ({ DOM }) => ({ RETITLE: DOM.click('.retitle') })
Table.model = { RETITLE: (s) => ({ ...s, title: s.title + '!' }) }

// ---- a parent with a static subtree and two children with their own state (a child's render
// doesn't change the parent's state, so the parent's own vnodes are the same objects)
function Big({ state }) {
  return h('div', null,
    h('button', { className: 'add' }, 'add'),
    h('ul', { className: 'big' }, ...state.items.map(i => h('li', { key: i }, h('b', null, String(i))))))
}
Big.isolatedState = true
Big.initialState = { items: Array.from({ length: 50 }, (_, i) => i) }
Big.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
Big.model = { ADD: (s) => ({ ...s, items: [...s.items, s.items.length] }) }
function Host() {
  return h('div', null,
    h('section', { className: 'static' }, ...Array.from({ length: 30 }, (_, i) => h('p', null, h('i', null, 'p' + i)))),
    h('div', { className: 'one' }, h(Big)),
    h('div', { className: 'two' }, h(Big)))
}

describe('P45-A: unchanged vnodes keep their identity', () => {
  it('selecting one Collection item diffs that item, not the other 199', async () => {
    const root = start(Table)
    await until(() => root.querySelectorAll('.row').length === 200)
    diffed = []
    click(root, '.row:nth-child(2) .lbl')
    await until(() => root.querySelector('.row:nth-child(2)').classList.contains('danger'))
    expect(root.querySelectorAll('.danger').length).toBe(1)
    // the selected row's 7 vnodes, its ancestors and the parent's own elements; not 200 rows
    expect(diffedIn('.row')).toBeLessThanOrEqual(7)
    expect(diffed.length).toBeLessThan(30)
  })

  it("the parent's own render doesn't re-diff the items it didn't change", async () => {
    const root = start(Table)
    await until(() => root.querySelectorAll('.row').length === 200)
    diffed = []
    click(root, '.retitle')
    await until(() => root.querySelector('.title').textContent === 't0!')
    expect(diffedIn('.row')).toBe(0)
  })

  it("a child's render diffs neither the parent's static subtree nor a sibling child", async () => {
    const root = start(Host)
    await until(() => root.querySelectorAll('.big li').length === 100)
    diffed = []
    click(root, '.one .add')
    await until(() => root.querySelectorAll('.big li').length === 101)
    expect(root.querySelectorAll('.one li').length).toBe(51)
    expect(diffedIn('.static')).toBe(0)
    // the sibling's wrapper and the element the parent placed it in; nothing inside it
    expect(diffedIn('.two .big')).toBe(0)
    expect(diffedIn('.two')).toBeLessThanOrEqual(2)
  })

  it('Suspense still shows the fallback, then the children, around unchanged siblings', async () => {
    function Slow({ state }) { return h('p', { className: state.ready ? 'slow' : 'notyet' }, 'loaded') }
    Slow.initialState = { ready: false }
    Slow.isolatedState = true
    Slow.intent = () => ({ GO: xs.periodic(60).take(1) })
    Slow.model = {
      BOOTSTRAP: { READY: () => false },
      GO: { STATE: (s) => ({ ...s, ready: true }), READY: () => true },
    }
    function Page() {
      return h('div', null,
        h('section', { className: 'static' }, h('p', null, h('i', null, 'a'))),
        h(Suspense, { fallback: h('em', { className: 'wait' }, 'loading') }, h(Slow)))
    }
    const root = start(Page)
    await until(() => root.querySelector('.wait'))
    expect(root.querySelector('.slow')).toBe(null)
    await until(() => root.querySelector('.slow'))
    expect(root.querySelector('.wait')).toBe(null)
    expect(root.querySelector('.static i').textContent).toBe('a')
  })

  it('a hoisted vnode used twice in one view still renders and updates both places', async () => {
    const ICON = h('span', { className: 'ic' }, h('b', null, '*'))
    function Icons({ state }) {
      return h('div', null, ...(state.show ? [ICON] : []), h('p', { className: 'n' }, String(state.n)), ICON, h('button', { className: 'go' }, 'go'))
    }
    Icons.initialState = { n: 0, show: true }
    Icons.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Icons.model = { GO: (s) => ({ n: s.n + 1, show: !s.show }) }
    const root = start(Icons)
    await until(() => root.querySelectorAll('.ic').length === 2)
    for (let i = 1; i <= 4; i++) {
      click(root, '.go')
      await until(() => root.querySelector('.n').textContent === String(i))
      expect(root.querySelectorAll('.ic').length).toBe(i % 2 ? 1 : 2)
      expect(root.querySelector('div').lastElementChild.className).toBe('go')
    }
  })
})
