// @vitest-environment jsdom
// PLAN-5 3-F G-431: renderToString numbers a VirtualCollection's rows as the client does: a row
// that renders nothing still counts (data-index / aria-posinset of the rows after it).
import { describe, it, expect } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { VirtualCollection } from '../src/index.js'

const Row = ({ state }) => (state.hide ? null : h('div', { className: 'row' }, h('span', { className: 'lbl' }, state.label)))
function List() { return h(VirtualCollection, { of: Row, from: 'rows', className: 'rows', estimateSize: 32 }) }
List.initialState = { rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b', hide: true }, { id: 3, label: 'c' }, { id: 4, label: 'd', hide: true }, { id: 5, label: 'e' }] }

const attr = (html, name) => [...html.matchAll(new RegExp(name + '="([^"]*)"', 'g'))].map((m) => m[1])

describe('G-431: SSR row positions after rows that render nothing', () => {
  it('data-index, aria-posinset and aria-setsize match the client', async () => {
    const html = renderToString(List)
    const t = renderComponent(List, { diagnostics: 'off' })
    await t.ready()
    const client = {
      index: t.queryAll('.row').map((e) => e.getAttribute('data-index')),
      pos: t.queryAll('.row').map((e) => e.getAttribute('aria-posinset')),
      size: t.queryAll('.row').map((e) => e.getAttribute('aria-setsize')),
    }
    t.dispose()
    expect(client.index).toEqual(['0', '2', '4'])
    expect(attr(html, 'data-index')).toEqual(client.index)
    expect(attr(html, 'aria-posinset')).toEqual(client.pos)
    expect(attr(html, 'aria-setsize')).toEqual(client.size)
  })
})
