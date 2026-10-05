// @vitest-environment jsdom
// PLAN-4.6 parity: Collection (spike 0-S §2, ported to the public API), G-257 (PLAN-4.5), D169.
import { it, expect, vi } from 'vitest'
import { parity, itNext, mount, h, click, until, sleep, Collection } from './harness.js'

function Row({ state }) { return h('li', { className: 'row', 'data-id': String(state.id) }, state.text, h('button', { className: 'edit' }, 'e'), h('button', { className: 'del' }, 'x')) }
Row.intent = ({ DOM }) => ({ EDIT: DOM.click('.edit'), DEL: DOM.click('.del') })
Row.model = { EDIT: (s) => ({ ...s, text: s.text + '!' }), DEL: () => undefined }
const texts = () => [...document.querySelectorAll('.row')].map((li) => li.firstChild.textContent)

parity('parity: Collection filter, sort, removal, write-back (PF-1 cases)', () => {
  const rows = [{ id: 1, text: 'c', n: 2, done: false }, { id: 2, text: 'a', n: 1, done: true }, { id: 3, text: 'b', n: 2, done: false }, { id: 4, text: 'd', n: 1, done: false }]
  const listWith = (props) => {
    function L({ state }) { return h('ul', null, h(Collection, { of: Row, from: 'rows', ...props(state) })) }
    L.initialState = { rows, mode: 0 }
    return L
  }

  it.each([
    ['field name', () => ({ sort: 'text' }), ['a', 'b', 'c', 'd']],
    ['{ field: "desc" }', () => ({ sort: { text: 'desc' } }), ['d', 'c', 'b', 'a']],
    ['{ field: -1 }', () => ({ sort: { text: -1 } }), ['d', 'c', 'b', 'a']],
    ['array (n asc, then text desc)', () => ({ sort: ['n', { text: 'desc' }] }), ['d', 'a', 'c', 'b']],
    ['compare function', () => ({ sort: (x, y) => y.id - x.id }), ['d', 'b', 'a', 'c']],
    ['filter + sort', () => ({ filter: (r) => !r.done, sort: 'text' }), ['b', 'c', 'd']],
  ])('sort form: %s', async (_, props, want) => {
    mount(listWith(props))
    await until(() => expect(texts()).toEqual(want))
  })

  it("an item's edit is written back to its own element; the state array keeps its order", async () => {
    const m = mount(listWith(() => ({ filter: (r) => !r.done, sort: { text: 'desc' } })))
    await until(() => expect(texts()).toEqual(['d', 'c', 'b']))
    const before = m.state().rows
    click(m.$$('.edit')[1]) // 'c' (id 1)
    await until(() => expect(texts()).toEqual(['d', 'c!', 'b']))
    expect(m.state().rows.map((r) => r.text)).toEqual(['c!', 'a', 'b', 'd'])
    expect(m.state().rows[1]).toBe(before[1]) // the filtered-out one is untouched
    expect(m.state().rows[2]).toBe(before[2])
  })

  it('an item removing itself (returning undefined) removes only that element; a filter change re-filters', async () => {
    function L({ state }) { return h('ul', null, h('button', { className: 'hide' }), h(Collection, { of: Row, from: 'rows', filter: state.hideDone ? (r) => !r.done : undefined })) }
    L.initialState = { rows, hideDone: false }
    L.intent = ({ DOM }) => ({ T: DOM.click('.hide') })
    L.model = { T: (s) => ({ ...s, hideDone: !s.hideDone }) }
    const m = mount(L)
    await until(() => expect(texts()).toEqual(['c', 'a', 'b', 'd']))
    const keep = m.state().rows[3]
    click(m.$$('.del')[2]) // b
    await until(() => expect(texts()).toEqual(['c', 'a', 'd']))
    expect(m.state().rows.map((r) => r.text)).toEqual(['c', 'a', 'd'])
    expect(m.state().rows[2]).toBe(keep)
    click(m.$('.hide'))
    await until(() => expect(texts()).toEqual(['c', 'd']))
  })

  it('items without ids are keyed by index (write-back adds the id); primitives are written back as primitives', async () => {
    function P({ state }) { return h('li', { className: 'row' }, String(state.value ?? state.text ?? state), h('button', { className: 'edit' }, '+')) }
    P.intent = ({ DOM }) => ({ INC: DOM.click('.edit') })
    P.model = { INC: (s) => (s.value !== undefined ? { ...s, value: s.value + 10 } : { ...s, text: s.text + '!' }) }
    function L() { return h('div', null, h(Collection, { of: P, from: 'nums', className: 'nums' }), h(Collection, { of: P, from: 'objs', className: 'objs' })) }
    L.initialState = { nums: [1, 2, 3], objs: [{ text: 'a' }, { text: 'b' }] }
    const m = mount(L)
    await until(() => expect(texts()).toEqual(['1', '2', '3', 'a', 'b']))
    click(m.$$('.nums .edit')[2])
    await until(() => expect(m.state().nums).toEqual([1, 2, 13]))
    click(m.$$('.objs .edit')[1])
    await until(() => expect(m.state().objs.map((o) => o.text)).toEqual(['a', 'b!']))
    expect(texts()).toEqual(['1', '2', '13', 'a', 'b!'])
  })

  it('a parent change elsewhere does not re-render the items (PF-1)', async () => {
    let views = 0
    function Item({ state }) { views++; return h('li', null, state.text) }
    function L({ state }) { return h('div', null, h('b', { className: 'n' }, String(state.n)), h(Collection, { of: Item, from: 'rows' })) }
    L.initialState = { n: 0, rows: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] }
    L.intent = ({ DOM }) => ({ BUMP: DOM.click('.n') })
    L.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
    const m = mount(L)
    await until(() => expect(m.text('.n')).toBe('0'))
    await sleep(20)
    const v = views
    click(m.$('.n'))
    await until(() => expect(m.text('.n')).toBe('1'))
    await sleep(20)
    expect(views).toBe(v)
  })
}, 'R2')

parity('parity: G-257 cross-Collection move of items with intent + model', () => {
  function Item({ state }) { return h('li', { className: 'item' }, h('button', { className: 'x' }, state.id + ':' + (state.n || 0))) }
  Item.intent = ({ DOM }) => ({ CLICK: DOM.click('.x') })
  Item.model = { CLICK: (s) => ({ ...s, n: (s.n || 0) + 1 }) }
  function Lanes() {
    return h('div', null, h('button', { className: 'mv' }, 'mv'),
      h('ul', { className: 'l' }, h(Collection, { of: Item, from: 'left' })),
      h('ul', { className: 'r' }, h(Collection, { of: Item, from: 'right' })))
  }
  Lanes.initialState = { left: [{ id: 'x' }, { id: 'y' }], right: [{ id: 'z' }] }
  Lanes.intent = ({ DOM }) => ({ MV: DOM.click('.mv') })
  Lanes.model = { MV: (s) => ({ left: s.left.slice(1), right: [...s.right, s.left[0]] }) }

  it('a move between Collections is one patch, and no DOM state in between misses the item', async () => {
    const m = mount(Lanes)
    await until(() => expect(m.$$('.item').length).toBe(3))
    await sleep(20)
    const before = m.patches(), counts = []
    const mo = new MutationObserver(() => counts.push(m.$$('.item').length))
    mo.observe(document.body, { subtree: true, childList: true })
    click(m.$('.mv'))
    await until(() => expect(m.$$('.r .item').map((e) => e.textContent)).toEqual(['z:0', 'x:0']))
    await sleep(20)
    mo.disconnect()
    expect(m.patches() - before).toBe(1)
    expect(counts.length).toBeGreaterThan(0)
    expect(counts.every((n) => n == 3)).toBe(true)
  })

  it('the moved item responds to a click as soon as it is visible (D153)', async () => {
    const m = mount(Lanes)
    await until(() => expect(m.$$('.item').length).toBe(3))
    click(m.$('.mv'))
    await until(() => expect(m.$$('.r .item').length).toBe(2))
    click(m.$$('.r .x')[1])
    await until(() => expect(m.$$('.r .item').map((e) => e.textContent)).toEqual(['z:0', 'x:1']))
  })
}, 'R2')

parity('parity: D169 id-less items under filter/sort are keyed by raw index; duplicate ids warn', () => {
  // an id-less item's instance keeps its identity when a filter change moves it in the shown list
  const boots = [], disposed = []
  function Note({ state }) { return h('li', { className: 'note' }, state.t) }
  Note.model = { BOOTSTRAP: { EFFECT: (s) => boots.push(s.t) }, DISPOSE: { EFFECT: (s) => disposed.push(s.t) } }
  function L({ state }) { return h('ul', null, h('button', { className: 'all' }), h(Collection, { of: Note, from: 'notes', filter: state.all ? undefined : (n) => !n.done })) }
  L.initialState = { all: false, notes: [{ t: 'a', done: true }, { t: 'b' }, { t: 'c' }] }
  L.intent = ({ DOM }) => ({ ALL: DOM.click('.all') })
  L.model = { ALL: (s) => ({ ...s, all: true }) }

  it('baseline (both cores): the filter change shows the hidden item', async () => {
    boots.length = 0; disposed.length = 0
    const m = mount(L)
    await until(() => expect(m.$$('.note').map((e) => e.textContent)).toEqual(['b', 'c']))
    click(m.$('.all'))
    await until(() => expect(m.$$('.note').map((e) => e.textContent)).toEqual(['a', 'b', 'c']))
  })

  itNext('D169 raw-index keys (G-291)', "showing a filtered-out item creates only that item; the others keep their instances", async () => {
    boots.length = 0; disposed.length = 0
    const m = mount(L)
    await until(() => expect(boots.sort()).toEqual(['b', 'c']))
    click(m.$('.all'))
    await until(() => expect(m.$$('.note').map((e) => e.textContent)).toEqual(['a', 'b', 'c']))
    await sleep(30)
    expect(boots.sort()).toEqual(['a', 'b', 'c']) // only 'a' is new
    expect(disposed).toEqual([])
  })

  itNext('D169 duplicate ids warn in dev', 'duplicate item ids: a dev warning names the id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    function Item({ state }) { return h('li', { className: 'dup' }, state.t) }
    function D() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    D.initialState = { items: [{ id: 7, t: 'a' }, { id: 7, t: 'b' }] }
    mount(D, {}, { diagnostics: 'warn' })
    await sleep(30)
    expect(warn.mock.calls.some((c) => /duplicate/i.test(String(c[0])) && String(c[0]).includes('7'))).toBe(true)
  })
}, 'R2')
