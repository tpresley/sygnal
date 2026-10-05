// @vitest-environment jsdom
// PLAN-5 2-S G-396: renderToString for a VirtualCollection (and a Collection) lists its items as
// the client's host does: filter, sort, a lens or missing `from`, duplicate ids, and the other
// props and the children go to every item. The server's rows are the client's first window.
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { VirtualCollection, Collection } from '../src/index.js'

function Row({ state, tag, children }) {
  return h('div', { className: 'row' }, h('span', { className: 'lbl' }, `${state.label}|${tag}`), ...(children || []))
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'r' + (i + 1) }))
const labels = (html) => [...html.matchAll(/<span class="lbl">([^<]*)<\/span>/g)].map((m) => m[1])
const attr = (html, name) => [...html.matchAll(new RegExp(name + '="([^"]*)"', 'g'))].map((m) => m[1])

async function client(App) {
  const t = renderComponent(App, { diagnostics: 'off' })
  await t.ready()
  const out = {
    labels: t.queryAll('.lbl').map((e) => e.textContent),
    setsize: t.queryAll('.row').map((e) => e.getAttribute('aria-setsize')),
    index: t.queryAll('.row').map((e) => e.getAttribute('data-index')),
    spacer: t.query('.rows')?.firstElementChild?.style.height,
    kids: t.queryAll('.row .kid').length,
  }
  t.dispose()
  return out
}

describe('G-396: VirtualCollection on the server', () => {
  it('filter, sort, other props and children: the server rows are the client window; aria-setsize and the spacer count the filtered list', async () => {
    function A() {
      return h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', tag: 'T', estimateSize: 20, filter: (r) => r.id > 500, sort: { id: 'desc' } },
        h('i', { className: 'kid' }, '*'))
    }
    A.initialState = { rows: rows(1000) }
    const html = renderToString(A)
    const c = await client(A)
    expect(labels(html)).toEqual(c.labels)
    expect(labels(html).slice(0, 3)).toEqual(['r1000|T', 'r999|T', 'r998|T'])
    expect(labels(html)).toHaveLength(15)
    expect(attr(html, 'aria-setsize')).toEqual(c.setsize)
    expect(c.setsize[0]).toBe('500')
    expect(attr(html, 'data-index')).toEqual(c.index)
    expect(html).toContain('height: 10000px')
    expect(c.spacer).toBe('10000px')
    expect((html.match(/class="kid"/g) || []).length).toBe(15)
    expect(c.kids).toBe(15)
  })

  it('a { get, set } lens; a missing from renders no rows; no from: the owner state is the array', async () => {
    function L() { return h(VirtualCollection, { of: Row, from: { get: (s) => s.list, set: (s, v) => ({ ...s, list: v }) }, className: 'rows' }) }
    L.initialState = { list: [{ id: 1, label: 'a' }, { id: 1, label: 'dup' }, { id: 2, label: 'b' }] }
    const html = renderToString(L)
    expect(labels(html)).toEqual(['a|undefined', 'b|undefined'])
    expect(labels(html)).toEqual((await client(L)).labels)
    expect(attr(html, 'aria-setsize')).toEqual(['2', '2'])

    function M() { return h(VirtualCollection, { of: Row, from: 'later', className: 'rows' }) }
    M.initialState = { rows: rows(3) }
    expect(labels(renderToString(M))).toEqual([])

    function Item({ state }) { return h('div', { className: 'row' }, h('span', { className: 'lbl' }, state.label)) }
    function Own() { return h(VirtualCollection, { of: Item, className: 'rows' }) }
    function P() { return h('div', null, h(Own, { state: 'rows' })) }
    P.initialState = { rows: rows(3) }
    expect(labels(renderToString(P))).toEqual(['r1', 'r2', 'r3'])
  })

  it('estimateSize as a function gets the filtered item and its position', () => {
    const seen = []
    function A() { return h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', filter: (r) => r.id % 2 === 0, estimateSize: (r, i) => { seen.push([r.id, i]); return 10 } }) }
    A.initialState = { rows: rows(6) }
    const html = renderToString(A)
    expect(seen.slice(0, 3)).toEqual([[2, 0], [4, 1], [6, 2]])
    expect(html).toContain('height: 30px')
  })
})

describe('G-396: Collection on the server', () => {
  it('filter, sort, the other props and children, as the client', async () => {
    function A() {
      return h(Collection, { of: Row, from: 'rows', className: 'rows', tag: 'C', filter: (r) => r.id % 2, sort: { id: 'desc' } }, h('i', { className: 'kid' }, '*'))
    }
    A.initialState = { rows: rows(6) }
    const html = renderToString(A)
    expect(labels(html)).toEqual(['r5|C', 'r3|C', 'r1|C'])
    expect(labels(html)).toEqual((await client(A)).labels)
    expect((html.match(/class="kid"/g) || []).length).toBe(3)
  })
})
