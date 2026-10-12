// @vitest-environment jsdom
// PLAN-9 M-1: <Composed> in the real DOM driver (renderComponent's dom: 'real'): the parts keep
// their instances (state, events) and the DOM follows the layout when they move to an earlier
// parent element (G-750) or into a parent created in the same patch (G-753), and back out.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { defineCatalog, Composed } from '../src/extra/ai/index.ts'

let t
afterEach(() => { t?.dispose(); t = null })

function Tile({ state, node }) {
  return h('div', { className: 'tile', 'data-node': node }, h('span', { className: 'n' }, `${node}:${state.n}`), h('button', { className: `inc inc-${node}`, type: 'button' }, '+'))
}
Tile.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Tile.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

const catalog = defineCatalog({
  parts: { tile: { component: Tile, local: { n: 0 }, description: 'Tile', maxUses: 10 } },
  containers: { box: { slots: { default: null }, render: ({ key, slots }) => h('div', { className: 'box', 'data-key': key }, slots.default) } },
})
const tiles = (...ks) => Object.fromEntries(ks.map((k) => [k, { part: 'tile' }]))
const L = (nodes, keys) => ({ root: 'page', nodes: { page: { part: 'page', slots: { default: keys } }, ...nodes } })
const box = (k, kids) => ({ [k]: { part: 'box', slots: { default: kids } } })

function Host() { return h('main', null, h(Composed, { catalog, from: 'page' })) }
Host.model = { SET: (s, layout) => ({ ...s, page: { ...s.page, layout } }) }

/** the DOM: each top-level element of the page as `key` or `box[keys]` */
const dom = () => [...t.container.querySelector('main').firstElementChild.children].map((e) => e.classList.contains('box')
  ? `${e.dataset.key}[${[...e.querySelectorAll('.tile')].map((x) => x.querySelector('.n').textContent).join(',')}]`
  : e.querySelector('.n').textContent)

async function start(layout) {
  Host.initialState = { page: { layout, preview: null, ui: {}, local: {} } }
  t = renderComponent(Host, { dom: 'real' })
  await t.ready()
  await t.settle()
}
async function set(layout) {
  t.simulateAction('SET', layout)
  await t.next((s) => s.page.layout === layout)
  await t.settle()
}
async function click(k, n) {
  t.container.querySelector(`.inc-${k}`).click()
  await t.waitForState((s) => s.page.local[k]?.n === n)
  await t.settle()
}

describe('<Composed> in the real DOM', () => {
  it('a part moves to an EARLIER parent element (G-750): state, events and DOM follow', async () => {
    await start(L({ ...box('b1', []), ...box('b2', ['a', 'b']), ...tiles('a', 'b') }, ['b1', 'b2']))
    await click('b', 1)
    await set(L({ ...box('b1', ['b']), ...box('b2', ['a']), ...tiles('a', 'b') }, ['b1', 'b2']))
    expect(dom()).toEqual(['b1[b:1]', 'b2[a:0]'])
    await click('b', 2)
    expect(dom()).toEqual(['b1[b:2]', 'b2[a:0]'])
  })

  it('parts move into a row created in the same patch (G-753), and back out', async () => {
    await start(L(tiles('a', 'b', 'c'), ['a', 'b', 'c']))
    await click('a', 1)
    await click('c', 1)
    await set(L({ ...box('row', ['a', 'b']), ...tiles('a', 'b', 'c') }, ['row', 'c']))
    expect(dom()).toEqual(['row[a:1,b:0]', 'c:1'])
    await click('b', 1)
    expect(dom()).toEqual(['row[a:1,b:1]', 'c:1'])
    await set(L(tiles('a', 'b', 'c'), ['c', 'b', 'a']))
    expect(dom()).toEqual(['c:1', 'b:1', 'a:1'])
    await click('a', 2)
    expect(dom()).toEqual(['c:1', 'b:1', 'a:2'])
  })

  it('a later part moves into a new row before its earlier siblings, nested two levels', async () => {
    await start(L(tiles('a', 'b', 'c'), ['a', 'b', 'c']))
    await click('c', 1)
    await set(L({ ...box('outer', ['inner', 'a']), ...box('inner', ['c']), ...tiles('a', 'b', 'c') }, ['outer', 'b']))
    expect(t.container.querySelector('[data-key="inner"] .n').textContent).toBe('c:1')
    expect(dom()).toEqual(['outer[c:1,a:0]', 'b:0'])
    await click('c', 2)
    expect(t.container.querySelector('[data-key="inner"] .n').textContent).toBe('c:2')
  })
})
