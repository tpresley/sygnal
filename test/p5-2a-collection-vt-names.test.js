// @vitest-environment jsdom
// PLAN-5 2-A (A-1, S-6): `<Collection viewTransitionName="card" />` gives each keyed item's root
// element `view-transition-name: card-<id>` and `view-transition-class: card`, so a move or a
// reorder in a `viewTransitions` action animates each item between its places (and between two
// Collections with the same prefix). Mock DOM here (the vnode's style); the real-browser
// animation is in browser-tests collection-vt-p5-2a.jsx.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { renderToString } from '../src/extra/ssr.ts'

let t
afterEach(() => { if (t) t.dispose(); t = null; document.body.innerHTML = '' })

const seen = []
const Item = (props) => { seen.push(props); return h('li', { className: 'item', style: props.state.style }, String(props.state.id ?? props.state.t)) }

function List({ state }) {
  return h('div', null,
    h('ul', { className: 'a' }, h(Collection, { of: Item, from: 'a', viewTransitionName: 'card' })),
    h('ul', { className: 'b' }, h(Collection, { of: Item, from: 'b', viewTransitionName: 'card' })),
    h('ul', { className: 'plain' }, h(Collection, { of: Item, from: 'p' })))
}
List.initialState = { a: [{ id: 1 }, { id: 2 }, { id: 3 }], b: [{ id: 4 }], p: [{ id: 9 }] }
List.model = {
  REVERSE: (s) => ({ ...s, a: [...s.a].reverse() }),
  MOVE: (s) => ({ ...s, a: s.a.slice(1), b: [...s.b, s.a[0]] }),
  SET: (s, a) => ({ ...s, a }),
}

const names = (sel) => t.queryAll(sel + ' .item').map(e => e.style.viewTransitionName + '/' + e.style.viewTransitionClass)

describe('Collection viewTransitionName (PLAN-5 A-1)', () => {
  it('names each item <prefix>-<id> with the prefix as its view-transition-class', async () => {
    t = renderComponent(List)
    await t.ready()
    expect(names('.a')).toEqual(['card-1/card', 'card-2/card', 'card-3/card'])
    expect(names('.b')).toEqual(['card-4/card'])
  })

  it('leaves the items of a Collection without the option alone', async () => {
    t = renderComponent(List)
    await t.ready()
    expect(t.query('.plain .item').style).toEqual({})
  })

  it('keeps the names on their items through a reorder and a move to another Collection', async () => {
    t = renderComponent(List)
    await t.ready()
    t.simulateAction('REVERSE')
    await t.next()
    expect(t.queryAll('.a .item').map(e => e.textContent + ':' + e.style.viewTransitionName)).toEqual(['3:card-3', '2:card-2', '1:card-1'])
    t.simulateAction('MOVE')
    await t.next()
    expect(names('.b')).toEqual(['card-4/card', 'card-3/card'])
    expect(names('.a')).toEqual(['card-2/card', 'card-1/card'])
  })

  it("keeps the item's own style; its own viewTransitionName / viewTransitionClass win", async () => {
    t = renderComponent(List, { initialState: { ...List.initialState, a: [{ id: 1, style: { color: 'red' } }, { id: 2, style: { viewTransitionName: 'own', viewTransitionClass: 'k' } }] } })
    await t.ready()
    expect(t.query('.a .item').style).toEqual({ viewTransitionName: 'card-1', viewTransitionClass: 'card', color: 'red' })
    expect(names('.a')[1]).toBe('own/k')
  })

  it('names nothing for an item without an id (keyed by its index, it has no identity to move)', async () => {
    t = renderComponent(List, { initialState: { ...List.initialState, a: [{ t: 'x' }, { id: 7 }] } })
    await t.ready()
    expect(names('.a')).toEqual(['undefined/undefined', 'card-7/card'])
  })

  it('turns an id that is not a CSS identifier into one, uniquely', async () => {
    t = renderComponent(List, { initialState: { ...List.initialState, a: [{ id: 'a b' }, { id: 'a_20_b' }, { id: 'x.y' }, { id: 'é' }, { id: 'A-z_9' }] } })
    await t.ready()
    const n = t.queryAll('.a .item').map(e => e.style.viewTransitionName)
    expect(n).toEqual(['card-a_32_b', 'card-a_95_20_95_b', 'card-x_46_y', 'card-_233_', 'card-A_45_z_95_9'])
    expect(n.every(x => /^card-[A-Za-z0-9_]+$/.test(x))).toBe(true)
  })

  it('is not passed to the items as a prop', async () => {
    seen.length = 0
    t = renderComponent(List)
    await t.ready()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(p => !('viewTransitionName' in p))).toBe(true)
  })

  it('renders the names in SSR (the hydrated page matches)', () => {
    const html = renderToString(List)
    expect(html).toContain('<li class="item" style="view-transition-name: card-1; view-transition-class: card">1</li>')
    expect(html).toContain('<li class="item">9</li>')
  })

  it('an item that renders again gets the name again; one that does not keeps its vnode', async () => {
    t = renderComponent(List)
    await t.ready()
    t.simulateAction('SET', [{ id: 1, t: 'new' }, { id: 2 }, { id: 3 }])
    await t.next()
    expect(names('.a')).toEqual(['card-1/card', 'card-2/card', 'card-3/card'])
  })
})
