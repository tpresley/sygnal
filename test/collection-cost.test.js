// The per-instance cuts of dev-plans/research/collection-cost keep what intents and views see:
// the intent's sources act as a plain object of sources (a Proxy with one shared handler), the
// view's context reads are tracked through a shared handler (a read after the view returned
// too), a Collection's items share one key -> index pair per array, and an enriched event
// stream's helpers are shared methods.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'
import { indexer } from '../src/core/cell.js'
import { enrichEventStream } from '../src/cycle/dom/enrichEventStream.js'
import xs from 'xstream'

let t
afterEach(() => { if (t) t.dispose(); t = null })

describe('intent sources', () => {
  it('spread, Object.keys, in, destructuring and added properties work as on a plain object', async () => {
    let seen
    function Child() { return h('div', { className: 'c' }, 'c') }
    Child.intent = (sources) => {
      const { DOM, STATE } = sources
      const copy = { ...sources }
      sources.extra = 42
      let threw
      try { sources.DOM = null } catch (e) { threw = e }
      seen = {
        keys: Object.keys(sources),
        copyKeys: Object.keys(copy),
        has: ['DOM' in sources, 'STATE' in sources, 'props$' in sources, 'nope' in sources],
        same: copy.DOM === DOM && copy.STATE === STATE,
        extra: sources.extra,
        threw: threw instanceof TypeError,
        domKept: sources.DOM === DOM,
        extraKeys: Object.keys(sources).includes('extra'),
        own: Object.getOwnPropertyDescriptor(sources, 'DOM')?.enumerable,
        proto: Object.getPrototypeOf(sources) === Object.prototype || Object.getPrototypeOf(sources) === null,
      }
      return { CLICK: DOM.click('.c') }
    }
    Child.model = { CLICK: (s) => s }
    function Parent() { return h('div', null, h(Child, null)) }
    Parent.initialState = {}
    t = renderComponent(Parent)
    await t.ready()
    expect(seen.keys).toEqual(expect.arrayContaining(['DOM', 'STATE', 'CHILD', 'dispose$', 'props$', 'children$', 'commands$']))
    expect(seen.copyKeys).toEqual(expect.arrayContaining(['DOM', 'STATE', 'CHILD', 'dispose$', 'props$']))
    expect(seen.has).toEqual([true, true, true, false])
    expect(seen.same).toBe(true)
    expect(seen.extra).toBe(42)
    // a source is read-only: the write throws where it happens (ES modules are strict)
    expect(seen.threw).toBe(true)
    expect(seen.domKept).toBe(true)
    expect(seen.extraKeys).toBe(true)
    expect(seen.own).toBe(true)
  })
})

describe('context read-tracking', () => {
  it('a read after the view returned (a Collection filter) is tracked; a spread re-renders on any key', async () => {
    let renders = 0
    function Row({ state }) { return h('li', null, state.label) }
    function Spread({ context }) { renders++; const all = { ...context }; return h('p', { className: 'sp' }, String(all.min)) }
    function List({ state, context }) {
      return h('div', null,
        h('ul', null, h(Collection, { of: Row, from: 'rows', filter: (r) => r.n >= context.min })),
        h(Spread, null), h('i', null, String(state.other)))
    }
    function Root({ state }) { return h('div', null, h(List, { state: 'list' })) }
    Root.initialState = { min: 2, other: 0, list: { rows: [{ id: 1, n: 1, label: 'a' }, { id: 2, n: 2, label: 'b' }, { id: 3, n: 3, label: 'c' }], other: 0 } }
    Root.context = { min: (s) => s.min, other: (s) => s.other }
    Root.model = { MIN: (s, d) => ({ ...s, min: d }), OTHER: (s) => ({ ...s, other: s.other + 1 }) }
    t = renderComponent(Root)
    await t.ready()
    expect(t.queryAll('li').map(e => e.textContent)).toEqual(['b', 'c'])
    t.simulateAction('MIN', 3)
    await t.settle()
    expect(t.queryAll('li').map(e => e.textContent)).toEqual(['c'])
    const r = renders
    t.simulateAction('OTHER')
    await t.settle()
    // Spread read every key: a change of `other` (which nothing else reads) re-renders it
    expect(renders).toBe(r + 1)
  })
})

describe('Collection index', () => {
  it('one [array, key -> index] pair per array identity', () => {
    let a = [{ id: 'x' }, { id: 'y' }]
    const ix = indexer({ get: () => a, set: (v) => { a = v } })
    const p = ix()
    expect(ix()).toBe(p)
    expect(p[1].get('y')).toBe(1)
    a = [{ id: 'y' }]
    const q = ix()
    expect(q).not.toBe(p)
    expect(q[1].get('y')).toBe(0)
  })

  it('a new array with every key in place (a drag, an edit) keeps the map: no rebuild per change', () => {
    let a = [{ id: 'x', v: 1 }, { id: 'y', v: 1 }, 'p']
    const ix = indexer({ get: () => a, set: (v) => { a = v } })
    const p = ix()
    // element y replaced with the same id, the primitive with another (index keys stay)
    a = [a[0], { id: 'y', v: 2 }, 'q']
    const q = ix()
    expect(q).not.toBe(p)
    expect(q[0]).toBe(a)
    expect(q[1]).toBe(p[1])
    // a key moved: a new map
    a = [a[1], a[0], 'q']
    const r = ix()
    expect(r[1]).not.toBe(q[1])
    expect([...r[1]]).toEqual([['y', 0], ['x', 1], ['\u00002', 2]])
    // another id in a slot, the same length: a new map
    a = [a[0], { id: 'z' }, 'q']
    expect([...ix()[1]]).toEqual([['y', 0], ['z', 1], ['\u00002', 2]])
    // shorter, then empty
    a = [a[0]]
    expect([...ix()[1]]).toEqual([['y', 0]])
    a = []
    expect(ix()[1].size).toBe(0)
  })
})

describe('enriched event streams', () => {
  it('the helpers are shared methods of the stream they are called on', () => {
    const a = enrichEventStream(xs.create()), b = enrichEventStream(xs.create())
    expect(a.value).toBe(b.value)
    const out = []
    a.data('taskId', Number).addListener({ next: (v) => out.push(v) })
    a.value().addListener({ next: (v) => out.push(v) })
    a.shamefullySendNext({ target: { value: 'v', closest: () => null, dataset: { taskId: '7' } } })
    expect(out).toEqual([7, 'v'])
  })
})
