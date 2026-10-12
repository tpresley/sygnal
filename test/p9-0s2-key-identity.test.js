// @vitest-environment jsdom
// PLAN-9 0-S2 (D456): a component instance's identity among its parent's children is its vnode
// `key`, else its `id` prop, else its path in the view. A keyed instance (and its isolatedState)
// survives a move between plain-element containers and a sibling reorder; a key change makes a
// new instance; `key` is never a prop of the component.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'

const MODES = [['mock', {}], ['real', { dom: 'real' }]]

// each instance stamps a serial number at BOOTSTRAP: a new number is a new instance
let serial = 0
const seen = []
function Part({ state, name, ...rest }) {
  seen.push(rest)
  return h('b', null, `${name}:${state.born}`)
}
Part.isolatedState = true
Part.initialState = { born: 0 }
Part.model = { BOOTSTRAP: (s) => ({ ...s, born: ++serial }) }

// two plain containers; each entry is { k, id?, name }, `keyed` toggles key={k}
function Board({ state }) {
  const part = (e) => h(Part, { ...(state.keyed ? { key: e.k } : {}), ...(e.id !== undefined ? { id: e.id } : {}), name: e.name })
  return h('div', null, h('section', { className: 'L' }, ...state.left.map(part)), h('section', { className: 'R' }, ...state.right.map(part)))
}
Board.model = { SET: (s, d) => ({ ...s, ...d }) }

const text = (t, sel) => (t.html().match(new RegExp(`<section class="${sel}">(.*?)</section>`)) || [])[1]?.replace(/<\/?b>/g, ' ').trim().split(/\s+/).filter(Boolean) || []

let t
afterEach(() => { t?.dispose(); t = null; seen.length = 0 })

describe.each(MODES)('0-S2 key identity (%s DOM)', (_, opts) => {
  const start = async (initialState) => {
    t = renderComponent(Board, { ...opts, initialState }); await t.ready(); await t.settle()
  }
  const set = async (d) => { t.simulateAction('SET', d); await t.settle() }

  it('key: an instance survives a move to another container', async () => {
    await start({ keyed: true, left: [{ k: 'a', name: 'a' }, { k: 'b', name: 'b' }], right: [] })
    const [a, b] = text(t, 'L')
    await set({ left: [{ k: 'b', name: 'b' }], right: [{ k: 'a', name: 'a' }] })
    expect(text(t, 'L')).toEqual([b])
    expect(text(t, 'R')).toEqual([a])
  })

  it('key: an instance survives a sibling reorder (numeric keys, including 0)', async () => {
    await start({ keyed: true, left: [0, 1, 2].map(k => ({ k, name: 'p' + k })), right: [] })
    const before = text(t, 'L')
    await set({ left: [2, 1, 0].map(k => ({ k, name: 'p' + k })) })
    expect(text(t, 'L')).toEqual([...before].reverse())
  })

  it('no key, no id: identity is the path (a move re-creates, a reorder keeps positions)', async () => {
    await start({ keyed: false, left: [{ k: 'a', name: 'a' }, { k: 'b', name: 'b' }], right: [] })
    const [a, b] = text(t, 'L')
    await set({ left: [{ k: 'b', name: 'b' }], right: [{ k: 'a', name: 'a' }] })
    const born = (s) => +s.split(':')[1]
    // L's first slot keeps the instance that was a's (now with b's props); R's is new
    expect(text(t, 'L')).toEqual([`b:${born(a)}`])
    const [r] = text(t, 'R')
    expect(born(r)).toBeGreaterThan(born(b))
  })

  it('a key change makes a new instance', async () => {
    await start({ keyed: true, left: [{ k: 'a', name: 'x' }], right: [] })
    const [x1] = text(t, 'L')
    await set({ left: [{ k: 'z', name: 'x' }] })
    const [x2] = text(t, 'L')
    expect(x2).not.toEqual(x1)
  })

  it('key wins over id: an id change under the same key keeps the instance (and the id reaches the props)', async () => {
    await start({ keyed: true, left: [{ k: 'a', id: 'one', name: 'x' }], right: [] })
    const [x1] = text(t, 'L')
    await set({ left: [{ k: 'a', id: 'two', name: 'x' }] })
    expect(text(t, 'L')).toEqual([x1])
    expect(seen.at(-1).id).toBe('two')
    await set({ left: [{ k: 'b', id: 'two', name: 'x' }] })
    expect(text(t, 'L')).not.toEqual([x1])
  })

  it('id alone still keys an instance (unchanged)', async () => {
    await start({ keyed: false, left: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], right: [] })
    const [a, b] = text(t, 'L')
    await set({ left: [{ id: 'b', name: 'b' }], right: [{ id: 'a', name: 'a' }] })
    expect(text(t, 'L')).toEqual([b])
    expect(text(t, 'R')).toEqual([a])
  })

  it('key is not a prop of the component', async () => {
    await start({ keyed: true, left: [{ k: 'a', name: 'a' }], right: [] })
    expect(seen.every(p => !('key' in p))).toBe(true)
  })

  it('Collection items are unaffected (keyed by item id); a key on the Collection keeps its items while unchanged', async () => {
    function Item({ state }) { return h('i', null, `${state.id}:${state.n}`) }
    Item.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
    function List({ state }) { return h('ul', null, h(Collection, { of: Item, from: 'items', key: 'list' }), h('em', null, String(state.tick))) }
    List.model = { REV: (s) => ({ ...s, items: [...s.items].reverse() }), TICK: (s) => ({ ...s, tick: s.tick + 1 }) }
    t = renderComponent(List, { ...opts, initialState: { tick: 0, items: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }] } })
    await t.ready(); await t.settle()
    expect(t.html()).toContain('<i>a:1</i><i>b:2</i>')
    t.simulateAction('REV'); await t.settle()
    expect(t.html()).toContain('<i>b:2</i><i>a:1</i>')
    t.simulateAction('TICK'); await t.settle()
    expect(t.html()).toContain('<i>b:2</i><i>a:1</i><em>1</em>')
  })

  it('a new key on the Collection re-creates its items (docs: guide/collections, Item Keys and Identity)', async () => {
    // each item holds an isolatedState Part (a serial stamped at BOOTSTRAP)
    function Item({ state }) { return h('li', null, h(Part, { name: state.id })) }
    function List({ state }) { return h('ul', null, h(Collection, { of: Item, from: 'items', key: state.listKey })) }
    List.model = { SET: (s, d) => ({ ...s, ...d }) }
    t = renderComponent(List, { ...opts, initialState: { listKey: 'one', items: [{ id: 'a' }, { id: 'b' }] } })
    await t.ready(); await t.settle()
    const parts = () => (t.html().match(/<b>[^<]*<\/b>/g) || []).map((s) => s.slice(3, -4))
    const before = parts()
    expect(before.map((p) => p.split(':')[0])).toEqual(['a', 'b'])
    t.simulateAction('SET', { items: [{ id: 'b' }, { id: 'a' }] }); await t.settle()
    expect(parts()).toEqual([before[1], before[0]])
    t.simulateAction('SET', { listKey: 'two' }); await t.settle()
    const after = parts()
    expect(after.map((p) => p.split(':')[0])).toEqual(['b', 'a'])
    for (const p of after) expect(before).not.toContain(p)
  })

  it('key is not a prop of a Collection item either', async () => {
    const got = []
    function Item({ state, ...rest }) { got.push(Object.keys(rest).filter((k) => k !== 'children' && k !== 'slots' && k !== 'context' && k !== 'uid')); return h('li', null, state.id) }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items', key: 'k', tone: 'x' })) }
    t = renderComponent(List, { ...opts, initialState: { items: [{ id: 'a' }] } })
    await t.ready(); await t.settle()
    expect(got.at(-1)).toEqual(['tone'])
  })
})

describe('0-S2 key identity and uid() (SSR = client)', () => {
  it("a keyed child's uid() is the same from renderToString and on the client, and comes from the key", async () => {
    const { renderToString } = await import('../src/extra/ssr.ts')
    function Field({ uid }) { return h('input', { attrs: { id: uid('in') } }) }
    function Form({ state }) { return h('form', null, ...state.ks.map(k => h(Field, { key: k })), h(Field, { key: 0 }), h(Field, { key: 'a', id: 'ignored' })) }
    const initialState = { ks: ['x', 7] }
    const ids = (html) => [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])
    const ssr = ids(renderToString(Form, { state: initialState }))
    t = renderComponent(Form, { dom: 'real', initialState }); await t.ready(); await t.settle()
    expect(ids(t.html())).toEqual(ssr)
    expect(ssr).toEqual(['u-x-in', 'u-7-in', 'u-0-in', 'u-a-in'])
  })
})
