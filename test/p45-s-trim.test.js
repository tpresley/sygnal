// @vitest-environment jsdom
// P45-S: the byte trim rewrote three internal paths of src/component.ts without changing their
// behaviour: the calculated fields' setup (topological order, cycle message, memo), the
// Collection sort prop, and the Transition hooks. These pin that behaviour on the real code.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { run, makeDOMDriver, Transition } from '../src/index.js'
import component from '../src/component.js'

let t
afterEach(() => { t?.dispose(); t = null; vi.restoreAllMocks(); vi.unstubAllGlobals() })

const cycleMessage = (calculated) => {
  try {
    component({ name: 'C', sources: {}, view: () => null, calculated })
  } catch (e) {
    return e.message
  }
}

describe('P45-S: calculated fields', () => {
  it('computes the fields in Kahn order (fields without deps in declaration order, then their dependents)', async () => {
    const order = []
    const f = (name, fn) => (s) => (order.push(name), fn(s))
    function C({ state }) { return h('div', null, String(state.d)) }
    C.initialState = { n: 1 }
    C.model = { SET: (s, n) => ({ ...s, n }) }
    C.calculated = {
      d: [['b', 'c'], f('d', s => s.b + s.c)],
      a: f('a', s => s.n + 1),
      b: [['a'], f('b', s => s.a * 2)],
      c: [['a'], f('c', s => s.a * 3)],
      e: f('e', s => s.d),
    }
    t = renderComponent(C)
    await t.ready()
    order.length = 0
    t.simulateAction('SET', 2)
    await t.next(s => s.n === 2)
    expect(order.slice(0, 5)).toEqual(['a', 'e', 'b', 'c', 'd'])
    expect(t.state).toMatchObject({ n: 2, a: 3, b: 6, c: 9, d: 15 })
  })

  it('memoizes a field with deps on its dep values', async () => {
    let calls = 0
    function C({ state }) { return h('div', null, String(state.dbl)) }
    C.initialState = { n: 1, other: 0 }
    C.calculated = { dbl: [['n'], s => (calls++, s.n * 2)] }
    C.model = { OTHER: s => ({ ...s, other: s.other + 1 }), N: s => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(C)
    await t.ready()
    const before = calls
    t.simulateAction('OTHER')
    await t.next(s => s.other === 1)
    expect(calls).toBe(before)
    t.simulateAction('N')
    await t.next(s => s.n === 2)
    expect(calls).toBe(before + 1)
    expect(t.state.dbl).toBe(4)
  })

  it('names the cycle in the SYG209 message', () => {
    expect(cycleMessage({
      ok: s => s.v,
      in: [['x'], s => s.x],
      x: [['y'], s => s.y],
      y: [['z'], s => s.z],
      z: [['x'], s => s.x],
    })).toContain('Circular calculated dependency: x → y → z → x')
    expect(cycleMessage({ loop: [['loop'], s => s.loop] })).toContain('Circular calculated dependency: loop → loop')
    expect(cycleMessage({ a: [['b', 'a'], s => s], b: [['a'], s => s] })).toContain('Circular calculated dependency: a → b → a')
  })
})

describe('P45-S: Collection sort', () => {
  function Item({ state }) { return h('li', { className: 'item' }, state.name + state.n) }
  const items = [{ id: 1, name: 'b', n: 2 }, { id: 2, name: 'a', n: 2 }, { id: 3, name: 'c', n: 1 }]
  const sorted = async (sort, rows = items) => {
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'rows', sort })) }
    List.initialState = { rows }
    t = renderComponent(List, { dom: 'real' })
    await t.ready(); await t.settle()
    const out = [...t.queryAll('.item')].map(li => li.textContent)
    t.dispose(); t = null
    return out
  }

  it('sorts by a field, an object, a direction and an array of sorters', async () => {
    expect(await sorted('name')).toEqual(['a2', 'b2', 'c1'])
    expect(await sorted({ name: 'DESC' })).toEqual(['c1', 'b2', 'a2'])
    expect(await sorted({ name: 'asc' })).toEqual(['a2', 'b2', 'c1'])
    expect(await sorted({ n: -1 })).toEqual(['b2', 'a2', 'c1'])
    expect(await sorted({ n: 1 })).toEqual(['c1', 'b2', 'a2'])
    expect(await sorted(['n', { name: 'desc' }])).toEqual(['c1', 'b2', 'a2'])
    expect(await sorted([{ n: 'desc' }, 'asc', (a, b) => a.id - b.id])).toEqual(['b2', 'a2', 'c1'])
    expect(await sorted((a, b) => b.id - a.id)).toEqual(['c1', 'a2', 'b2'])
  })

  it("sorts primitive items with 'asc' / 'desc'", async () => {
    function P({ state }) { return h('li', { className: 'item' }, String(state.value)) }
    function List() { return h('ul', null, h(Collection, { of: P, from: 'rows', sort: 'Desc' })) }
    List.initialState = { rows: [2, 3, 1] }
    t = renderComponent(List, { dom: 'real' })
    await t.ready(); await t.settle()
    expect([...t.queryAll('.item')].map(li => li.textContent)).toEqual(['3', '2', '1'])
  })

  it('reports an invalid sort (SYG418) and leaves the order as it is', async () => {
    const errors = []
    vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(String(a[0])))
    const cases = [
      [{ a: 1, b: 1 }, 'sort object must have one key; ignored'],
      [{ n: true }, 'sort direction must be a string or number; ignored'],
      [{ n: 'up' }, "sort direction must be 'asc' or 'desc'; ignored"],
      [{ n: 2 }, 'sort direction must be 1 or -1; ignored'],
      [42, 'Invalid sort prop; ignored'],
    ]
    for (const [sort, msg] of cases) {
      errors.length = 0
      expect(await sorted(sort)).toEqual(['b2', 'a2', 'c1'])
      expect(errors.some(e => e.includes('SYG418') && e.includes(msg))).toBe(true)
    }
  })
})

describe('P45-S: Transition classes', () => {
  beforeEach(() => { vi.stubGlobal('requestAnimationFrame', (f) => setTimeout(f, 1)) })
  afterEach(() => { document.body.innerHTML = '' })

  it('adds and removes the enter and leave classes in order, and runs hooks already there', async () => {
    const el = document.createElement('div')
    el.id = 'root'
    document.body.appendChild(el)
    const log = []
    const insert = vi.fn(), remove = vi.fn()
    function App({ state }) {
      return h('div', null, h(Transition, { name: 'fade', duration: 20 },
        state.show ? h('p', { className: 't', hook: { insert, remove } }, 'hi') : null))
    }
    App.initialState = { show: true }
    App.model = { HIDE: s => ({ ...s, show: false }) }
    App.intent = ({ DOM }) => ({ HIDE: DOM.select('#root').events('hide') })
    const app = run(App, { DOM: makeDOMDriver('#root') }, { mountPoint: undefined })
    const classes = () => document.querySelector('p.t')?.className
    try {
      await vi.waitFor(() => expect(classes()).toBeDefined(), { timeout: 2000, interval: 1 })
      log.push(classes())
      await vi.waitFor(() => expect(classes()).toContain('fade-enter-to'), { timeout: 2000, interval: 1 })
      log.push(classes())
      await vi.waitFor(() => expect(classes()).toBe('t'), { timeout: 2000, interval: 1 })
      expect(insert).toHaveBeenCalledTimes(1)
      el.dispatchEvent(new Event('hide'))
      await vi.waitFor(() => expect(classes()).toContain('fade-leave-from'), { timeout: 2000, interval: 1 })
      log.push(classes())
      await vi.waitFor(() => expect(classes()).toContain('fade-leave-to'), { timeout: 2000, interval: 1 })
      log.push(classes())
      await vi.waitFor(() => expect(document.querySelector('p.t')).toBeNull(), { timeout: 2000, interval: 1 })
      expect(remove).toHaveBeenCalledTimes(1)
      expect(log).toEqual(['t fade-enter-from fade-enter-active', 't fade-enter-active fade-enter-to', 't fade-leave-from fade-leave-active', 't fade-leave-active fade-leave-to'])
    } finally {
      app.dispose()
    }
  })
})
