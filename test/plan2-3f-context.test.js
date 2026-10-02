// PLAN-2 3-F: .context reading a calculated field (G-122)
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null })

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms))

// The eval's task-04 shape: cart lines in a Collection show their share of a calculated total
function CartLine({ state, context }) {
  const share = context.total > 0 ? Math.round((state.price * state.qty / context.total) * 100) : 0
  return h('div', { className: 'line', data: { id: state.id } },
    h('button', { className: 'inc' }, '+'),
    h('span', { className: 'share' }, `(${share}%)`))
}
CartLine.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
CartLine.model = { INC: (state) => ({ ...state, qty: state.qty + 1 }) }

function Cart({ state }) {
  return h('div', null,
    h(Collection, { of: CartLine, from: 'lines' }),
    h('button', { className: 'add' }, 'add'),
    h('p', { className: 'total' }, `Total: ${state.total}`))
}
Cart.initialState = {
  lines: [
    { id: 1, price: 12.5, qty: 2 },
    { id: 2, price: 8, qty: 1 },
    { id: 3, price: 4, qty: 1 },
  ],
}
Cart.calculated = { total: [['lines'], (state) => state.lines.reduce((sum, l) => sum + l.price * l.qty, 0)] }
Cart.context = { total: (state) => state.total }
Cart.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
Cart.model = { ADD: (state) => ({ ...state, lines: state.lines.map(l => l.id === 3 ? { ...l, qty: l.qty + 1 } : l) }) }

const shares = (html) => [...html.matchAll(/class="share">\((\d+)%\)/g)].map(m => Number(m[1]))

describe('G-122: .context sees the current calculated values', () => {
  it('starts with the initial calculated value', async () => {
    t = renderComponent(Cart)
    await t.ready()
    await wait()
    // total 37: 25/37, 8/37, 4/37
    expect(shares(t.html())).toEqual([68, 22, 11])
  })

  it('a Collection item write updates the context in the same render (no one-update lag)', async () => {
    t = renderComponent(Cart)
    await t.ready()
    t.simulateEvent('.line[data-id="1"] .inc', 'click')
    await t.next(s => s.lines[0].qty === 3)
    await wait()
    // total 49.5: 37.5/49.5 = 76%, 8/49.5 = 16%, 4/49.5 = 8%
    expect(t.html()).toContain('Total: 49.5')
    expect(shares(t.html())).toEqual([76, 16, 8])
    t.simulateEvent('.line[data-id="2"] .inc', 'click')
    await t.next(s => s.lines[1].qty === 2)
    await wait()
    // total 57.5: 37.5/57.5 = 65%, 16/57.5 = 28%, 4/57.5 = 7%
    expect(shares(t.html())).toEqual([65, 28, 7])
  })

  it("a parent's own reducer and an item's write both keep the context current", async () => {
    t = renderComponent(Cart)
    await t.ready()
    t.simulateEvent('.add', 'click')
    await t.next(s => s.lines[2].qty === 2)
    await wait()
    // total 41: 25/41 = 61%, 8/41 = 20%, 8/41 = 20%
    expect(shares(t.html())).toEqual([61, 20, 20])
    t.simulateEvent('.line[data-id="1"] .inc', 'click')
    await t.next(s => s.lines[0].qty === 3)
    await wait()
    // total 53.5: 37.5/53.5 = 70%, 8/53.5 = 15%, 8/53.5 = 15%
    expect(shares(t.html())).toEqual([70, 15, 15])
  })
})
