// PLAN-4 PF-1 (D128): Collection O(1) item lookups. Each item's lens checks its last index
// first, the Collection writes items back through one Map by id, and an item that already has
// an id keeps its identity. No API or behaviour change: these pin the semantics around it.
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { makeCollection, StateSource } from '../src/cycle/state/index.js'

let t
afterEach(() => { t?.dispose(); t = null; vi.restoreAllMocks() })

function Row({ state }) { return h('li', { className: 'row', 'data-id': String(state.id) }, state.text, h('button', { className: 'edit' }, 'e')) }
Row.intent = ({ DOM }) => ({ EDIT: DOM.click('.edit') })
Row.model = { EDIT: (state) => ({ ...state, text: state.text + '!' }) }

const texts = (t) => [...t.queryAll('.row')].map(li => li.firstChild.textContent)

async function mount(List) {
  t = renderComponent(List, { dom: 'real' })
  await t.ready(); await t.settle()
  return t
}

describe('PF-1: identity of items', () => {
  it('an edit writes one item back; the other items keep their identity in the parent state', async () => {
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }] }
    await mount(List)
    const before = t.state.rows
    t.queryAll('.edit')[1].click(); await t.next(s => s.rows[1].text === 'b!')
    const after = t.state.rows
    expect(after).not.toBe(before)
    expect(after[0]).toBe(before[0])
    expect(after[2]).toBe(before[2])
    expect(after[1]).toEqual({ id: 2, text: 'b!' })
  })

  it('an item with an id receives the parent\'s own object as its state', async () => {
    const seen = []
    function Item({ state }) { seen.push(state); return h('li', null, state.text) }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'rows' })) }
    List.initialState = { rows: [{ id: 'x', text: 'a' }] }
    await mount(List)
    expect(seen.at(-1)).toBe(t.state.rows[0])
  })

  it('a parent change elsewhere does not re-render the items', async () => {
    let views = 0
    function Item({ state }) { views++; return h('li', null, state.text) }
    function List({ state }) { return h('div', null, String(state.n), h(Collection, { of: Item, from: 'rows' })) }
    List.initialState = { n: 0, rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }
    List.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
    await mount(List)
    const v = views
    t.simulateAction('BUMP'); await t.next(s => s.n === 1); await t.settle()
    expect(views).toBe(v)
  })
})

describe('PF-1: reorder, remove, add', () => {
  function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
  List.initialState = { rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }, { id: 4, text: 'd' }] }
  List.model = {
    SWAP: (s) => { const r = [...s.rows]; [r[0], r[3]] = [r[3], r[0]]; return { ...s, rows: r } },
    REVERSE: (s) => ({ ...s, rows: [...s.rows].reverse() }),
    REMOVE: (s, id) => ({ ...s, rows: s.rows.filter(r => r.id !== id) }),
    ADD: (s, row) => ({ ...s, rows: [row, ...s.rows] }),
  }

  it('after a swap each item still edits its own row, and item instances are kept', async () => {
    await mount(List)
    const nodes = [...t.queryAll('.row')]
    t.simulateAction('SWAP'); await t.next(s => s.rows[0].id === 4); await t.settle()
    expect(texts(t)).toEqual(['d', 'b', 'c', 'a'])
    // snabbdom moved the same elements: the item instances survived the reorder
    expect(t.queryAll('.row')[0]).toBe(nodes[3])
    t.queryAll('.edit')[0].click(); await t.next(s => s.rows[0].text === 'd!')
    t.queryAll('.edit')[3].click(); await t.next(s => s.rows[3].text === 'a!')
    expect(t.state.rows.map(r => [r.id, r.text])).toEqual([[4, 'd!'], [2, 'b'], [3, 'c'], [1, 'a!']])
    expect(texts(t)).toEqual(['d!', 'b', 'c', 'a!'])
  })

  it('a reverse, a removal and an insert at the front keep each item\'s writes on its own row', async () => {
    await mount(List)
    t.simulateAction('REVERSE'); await t.next(s => s.rows[0].id === 4)
    t.simulateAction('REMOVE', 3); await t.next(s => s.rows.length === 3)
    t.simulateAction('ADD', { id: 9, text: 'z' }); await t.next(s => s.rows.length === 4); await t.settle()
    expect(texts(t)).toEqual(['z', 'd', 'b', 'a'])
    for (const i of [0, 2, 3]) { t.queryAll('.edit')[i].click(); await t.settle() }
    expect(t.state.rows.map(r => [r.id, r.text])).toEqual([[9, 'z!'], [4, 'd'], [2, 'b!'], [1, 'a!']])
  })

  it('an item removing itself (returning undefined) removes only that row', async () => {
    function Del({ state }) { return h('li', { className: 'row' }, state.text, h('button', { className: 'edit' }, 'x')) }
    Del.intent = ({ DOM }) => ({ DEL: DOM.click('.edit') })
    Del.model = { DEL: () => undefined }
    function L() { return h('ul', null, h(Collection, { of: Del, from: 'rows' })) }
    L.initialState = { rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }] }
    await mount(L)
    const keep = t.state.rows[2]
    t.queryAll('.edit')[1].click(); await t.next(s => s.rows.length === 2); await t.settle()
    expect(t.state.rows.map(r => r.text)).toEqual(['a', 'c'])
    expect(t.state.rows[1]).toBe(keep)
    expect(texts(t)).toEqual(['a', 'c'])
  })
})

describe('PF-1: items without ids, primitives, duplicates, idfield', () => {
  it('items without ids are keyed by index; a write-back adds the index as their id (unchanged behaviour)', async () => {
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }
    await mount(List)
    t.queryAll('.edit')[1].click(); await t.next(s => s.rows[1].text === 'b!')
    expect(t.state.rows).toEqual([{ text: 'a', id: 0 }, { text: 'b!', id: 1 }, { text: 'c', id: 2 }])
    expect(texts(t)).toEqual(['a', 'b!', 'c'])
  })

  it('an id of 0 is replaced by the index (unchanged behaviour)', async () => {
    const seen = []
    function Item({ state }) { seen.push(state); return h('li', null, state.text) }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'rows' })) }
    List.initialState = { rows: [{ id: 5, text: 'a' }, { id: 0, text: 'b' }] }
    await mount(List)
    expect(seen.find(s => s.text === 'b')).toEqual({ id: 1, text: 'b' })
  })

  it('primitive items arrive as { value, id } and are written back as primitives', async () => {
    function P({ state }) { return h('li', { className: 'row' }, String(state.value), h('button', { className: 'edit' }, '+')) }
    P.intent = ({ DOM }) => ({ INC: DOM.click('.edit') })
    P.model = { INC: (s) => ({ ...s, value: s.value + 10 }) }
    function List() { return h('ul', null, h(Collection, { of: P, from: 'nums' })) }
    List.initialState = { nums: [1, 2, 3] }
    await mount(List)
    t.queryAll('.edit')[2].click(); await t.next(s => s.nums[2] === 13)
    expect(t.state.nums).toEqual([1, 2, 13])
    t.queryAll('.edit')[0].click(); await t.next(s => s.nums[0] === 11)
    expect(t.state.nums).toEqual([11, 2, 13])
    expect(texts(t)).toEqual(['11', '2', '13'])
  })

  it('duplicate ids: one item instance per id, and a write-back gives every duplicate the first match (unchanged behaviour)', async () => {
    let views = 0
    function D({ state }) { views++; return h('li', { className: 'row' }, state.text, h('button', { className: 'edit' }, 'e')) }
    D.intent = Row.intent
    D.model = Row.model
    function List() { return h('ul', null, h(Collection, { of: D, from: 'rows' })) }
    List.initialState = { rows: [{ id: 1, text: 'a' }, { id: 1, text: 'b' }, { id: 2, text: 'c' }] }
    await mount(List)
    // both rows render the first item's state: one instance appears twice
    expect(texts(t)).toEqual(['a', 'a', 'c'])
    t.queryAll('.edit')[2].click(); await t.next(s => s.rows[2].text === 'c!')
    expect(t.state.rows.map(r => r.text)).toEqual(['a', 'a', 'c!'])
  })

  it('idfield: items are written back by that field', async () => {
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows', idfield: 'key' })) }
    List.initialState = { rows: [{ key: 'p', text: 'a' }, { key: 'q', text: 'b' }] }
    await mount(List)
    t.queryAll('.edit')[1].click(); await t.next(s => s.rows[1].text === 'b!')
    expect(t.state.rows).toEqual([{ key: 'p', text: 'a' }, { key: 'q', text: 'b!' }])
  })
})

describe('PF-1: filter, sort, calculated, custom lens', () => {
  it('filter + sort: edits write back to the right raw item; filtered-out items are kept', async () => {
    function List({ state }) { return h('ul', null, h(Collection, { of: Row, from: 'rows', filter: (r) => r.show, sort: 'text' })) }
    List.initialState = { rows: [{ id: 1, text: 'c', show: true }, { id: 2, text: 'a', show: false }, { id: 3, text: 'b', show: true }] }
    await mount(List)
    expect(texts(t)).toEqual(['b', 'c'])
    const hidden = t.state.rows[1]
    t.queryAll('.edit')[1].click(); await t.next(s => s.rows[0].text === 'c!')
    expect(t.state.rows.map(r => [r.id, r.text])).toEqual([[1, 'c!'], [2, 'a'], [3, 'b']])
    expect(t.state.rows[1]).toBe(hidden)
  })

  it('from a calculated field: items render and their writes are ignored (SYG409, unchanged)', async () => {
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'shown' })) }
    List.initialState = { rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }
    List.calculated = { shown: (s) => s.rows.filter(r => r.id > 1) }
    await mount(List)
    expect(texts(t)).toEqual(['b'])
    const rows = t.state.rows
    t.queryAll('.edit')[0].click(); await t.settle()
    expect(t.state.rows).toBe(rows)
  })

  it('a custom { get, set } lens gets the item array the items wrote', async () => {
    function List() {
      return h('ul', null, h(Collection, { of: Row, from: { get: (s) => s.data.items, set: (s, items) => ({ ...s, data: { ...s.data, items } }) } }))
    }
    List.initialState = { data: { items: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] } }
    await mount(List)
    t.queryAll('.edit')[0].click(); await t.next(s => s.data.items[0].text === 'a!')
    expect(t.state.data.items.map(r => r.text)).toEqual(['a!', 'b'])
  })

  it('nested collections: an inner item edit reaches the right outer item', async () => {
    function Inner({ state }) { return h('li', { className: 'row' }, state.text, h('button', { className: 'edit' }, 'e')) }
    Inner.intent = Row.intent
    Inner.model = Row.model
    function Outer({ state }) { return h('li', null, state.name, h(Collection, { of: Inner, from: 'items' })) }
    function List() { return h('ul', null, h(Collection, { of: Outer, from: 'groups' })) }
    List.initialState = { groups: [{ id: 'g1', name: 'one', items: [{ id: 1, text: 'a' }] }, { id: 'g2', name: 'two', items: [{ id: 1, text: 'x' }, { id: 2, text: 'y' }] }] }
    await mount(List)
    const g1 = t.state.groups[0]
    t.queryAll('.edit')[2].click(); await t.next(s => s.groups[1].items[1].text === 'y!')
    expect(t.state.groups[1].items.map(r => r.text)).toEqual(['x', 'y!'])
    expect(t.state.groups[0]).toBe(g1)
  })
})

describe('PF-1: O(1) per item', () => {
  it('a state change calls itemKey O(n) times, not O(n²), when the order is unchanged', () => {
    const n = 300
    let calls = 0
    const itemKey = (s, i) => { calls++; return s.id }
    const item = (sources) => { sources.state.stream.addListener({ next: () => {} }); return {} }
    const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1, text: String(i) }))
    const state$ = xs.createWithMemory()
    const C = makeCollection({ item, itemKey, collectSinks: (inst) => ({ x: inst.pickMerge('x') }), channel: 'state' })
    const sinks = C({ state: new StateSource(state$, 'state') })
    sinks.x.addListener({ next: () => {} })
    state$.shamefullySendNext(rows)
    const next = rows.map((r, i) => i === 150 ? { ...r, text: 'edited' } : r)
    calls = 0
    state$.shamefullySendNext(next)
    // the fold keys each item once (n); each item's lens checks its last index (n)
    expect(calls).toBeLessThanOrEqual(3 * n)
    // a reorder rescans only the moved items' lenses
    const swapped = [...next]; [swapped[1], swapped[n - 2]] = [swapped[n - 2], swapped[1]]
    calls = 0
    state$.shamefullySendNext(swapped)
    expect(calls).toBeLessThan(6 * n)
    sinks.__dispose()
  })

  it('an item write-back does not search the array per item', async () => {
    const n = 200
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: Array.from({ length: n }, (_, i) => ({ id: i + 1, text: String(i) })) }
    await mount(List)
    const find = vi.spyOn(Array.prototype, 'find')
    t.queryAll('.edit')[100].click(); await t.next(s => s.rows[100].text === '100!')
    const calls = find.mock.calls.length
    find.mockRestore()
    expect(calls).toBeLessThan(n / 2)
  })
})
