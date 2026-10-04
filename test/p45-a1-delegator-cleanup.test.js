// @vitest-environment jsdom
// PLAN-4.5 P45-A item 1 (audit finding 4, rec 3): the EventDelegator forgets a listener when its
// stream stops. Before, `DOM.select(x).events(type)` put a destination (with its ScopeChecker) in
// the delegator's per-scope priority queue and nothing ever took it out, so every unmounted
// component left its listeners behind (5,000 ScopeCheckers after 5×1k mount/unmount cycles).
// Streams on the same scope, selector and type are independent (each has its own destination;
// xstream counts a stream's own listeners), and the non-bubbling listeners (G-204 list), which
// several streams share, are counted: stopping one never detaches another.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { controls } from '../src/extra/controls.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; _resetDiagnostics(); document.body.innerHTML = '' })

// xstream stops a stream on a timer after its last listener leaves; Sygnal disposes on the next tick
const stopped = () => new Promise(r => setTimeout(r, 30))

// what the delegator holds: its scope tree (nodes), the destinations in it and their distinct
// ScopeCheckers, and the non-bubbling bookkeeping
function held(del) {
  const checkers = new Set()
  let nodes = 0, queues = 0, dests = 0
  const walk = ([payload, kids]) => {
    nodes++
    if (payload) payload.forEach(q => { queues++; q.forEach(d => { dests++; checkers.add(d.scopeChecker) }) })
    for (const k in kids) walk(kids[k])
  }
  walk(del.virtualListeners.tree)
  let nbElements = 0
  del.nonBubblingListeners.forEach(m => { nbElements += m.size })
  return { nodes, queues, dests, checkers: checkers.size, nbRecords: del.nonBubblingListenersToAdd.size, nbElements }
}

// the isolate module's scope tree (the root elements of each scope)
function scopes(iso) {
  let nodes = 0
  const walk = ([, kids]) => { nodes++; for (const k in kids) walk(kids[k]) }
  walk(iso.namespaceTree.tree)
  return nodes
}

let DOMsrc
function Row({ state }) {
  return h('li', { className: 'row' },
    h('button', { className: 'pick' }, state.label),
    h('input', { className: 'inp', value: state.label }),
    h('img', { className: 'pic', alt: '' }))
}
Row.intent = ({ DOM }) => ({
  PICK: DOM.click('.pick'),
  TYPE: DOM.input('.inp').value(),
  FOCUS: DOM.select('.inp').events('focus'), // non-bubbling: listened for on the element
  BROKEN: DOM.select('.pic').events('error'),
})
Row.model = {
  PICK: (s) => ({ ...s, picks: s.picks + 1 }),
  TYPE: (s, label) => ({ ...s, label }),
  FOCUS: (s) => ({ ...s, focused: true }),
  BROKEN: (s) => s,
}

function List({ state }) {
  return h('div', null,
    h('button', { className: 'fill' }, 'fill'),
    h('ul', null, h(Collection, { of: Row, from: 'rows' })),
    h('p', { className: 'count' }, String(state.rows.length)))
}
List.initialState = { rows: [] }
List.intent = ({ DOM }) => { DOMsrc = DOM; return { FILL: DOM.click('.fill') } }
List.model = {
  FILL: (s) => ({ rows: Array.from({ length: 20 }, (_, i) => ({ id: i, label: 'r' + i, picks: 0 })) }),
  CLEAR: () => ({ rows: [] }),
}

describe('P45-A: the delegator forgets listeners of stopped streams', () => {
  it('mount/unmount cycles of a Collection leave nothing behind (bubbling and non-bubbling)', async () => {
    t = renderComponent(List, { dom: 'real' }); await t.ready(); await t.settle()
    const del = DOMsrc._eventDelegator, iso = DOMsrc._isolateModule
    await stopped()
    const empty = held(del), emptyScopes = scopes(iso)

    for (let cycle = 0; cycle < 3; cycle++) {
      t.simulateAction('FILL'); await t.settle()
      expect(t.queryAll('.row').length).toBe(20)
      // 20 rows × 4 streams are live
      expect(held(del).checkers).toBeGreaterThanOrEqual(empty.checkers + 80)
      // events still arrive while the rows live
      t.query('.pick').click(); await t.settle()
      expect(t.state.rows[0].picks).toBe(1)
      t.query('.inp').dispatchEvent(new Event('focus')); await t.settle()
      expect(t.state.rows[0].focused).toBe(true)

      t.simulateAction('CLEAR'); await t.settle(); await stopped()
      expect(t.queryAll('.row').length).toBe(0)
      expect(held(del)).toEqual(empty)
      expect(scopes(iso)).toBe(emptyScopes)
    }
  })

  it('two streams on the same selector and type: stopping one leaves the other', async () => {
    t = renderComponent(List, { dom: 'real' }); await t.ready()
    const dom = DOMsrc, del = dom._eventDelegator
    const a = [], b = []
    const sa = dom.select('.count').events('click'), sb = dom.select('.count').events('click')
    const la = { next: e => a.push(e.type) }, lb = { next: e => b.push(e.type) }
    sa.addListener(la); sb.addListener(lb)
    t.query('.count').click()
    expect([a.length, b.length]).toEqual([1, 1])

    const before = held(del)
    sa.removeListener(la); await stopped()
    expect(held(del).dests).toBeLessThan(before.dests)
    t.query('.count').click()
    expect([a.length, b.length]).toEqual([1, 2])
    sb.removeListener(lb); await t.settle()
  })

  it('a stream re-subscribed after it stopped (an HMR swap) hears events again', async () => {
    t = renderComponent(List, { dom: 'real' }); await t.ready()
    const got = []
    const s = DOMsrc.select('.count').events('click')
    const l = { next: e => got.push(e.type) }
    s.addListener(l); t.query('.count').click()
    s.removeListener(l); await stopped()
    t.query('.count').click()
    expect(got.length).toBe(1)
    s.addListener(l); t.query('.count').click()
    expect(got.length).toBe(2)
    s.removeListener(l)
  })

  it('shared non-bubbling listeners are counted: stopping one stream leaves the others', async () => {
    t = renderComponent(List, { dom: 'real' }); await t.ready()
    t.simulateAction('FILL'); await t.settle()
    const del = DOMsrc._eventDelegator
    const recordsBefore = held(del).nbRecords
    const s1 = DOMsrc.select('.count').events('scroll'), s2 = DOMsrc.select('.count').events('scroll')
    const a = [], b = []
    const la = { next: e => a.push(e.type) }, lb = { next: e => b.push(e.type) }
    s1.addListener(la); s2.addListener(lb)
    t.query('.count').dispatchEvent(new Event('scroll'))
    expect([a.length, b.length]).toEqual([1, 1])
    s1.removeListener(la); await stopped()
    t.query('.count').dispatchEvent(new Event('scroll'))
    expect([a.length, b.length]).toEqual([1, 2])
    s2.removeListener(lb); await stopped()
    expect(held(del).nbRecords).toBe(recordsBefore)
    // re-subscribing listens on the element again
    s2.addListener(lb)
    t.query('.count').dispatchEvent(new Event('scroll'))
    expect(b.length).toBe(3)
    s2.removeListener(lb)
  })

  it('a control and a plain selector on the same element are independent', async () => {
    const { Go } = controls({ Go: 'button' })
    let dom
    function C({ state }) { return h('div', null, h(Go, null, 'go'), h('p', { className: 'n' }, String(state.n))) }
    C.initialState = { n: 0 }
    C.intent = ({ DOM }) => { dom = DOM; return { GO: DOM.click(Go) } }
    C.model = { GO: (s) => ({ n: s.n + 1 }) }
    t = renderComponent(C, { dom: 'real' }); await t.ready()
    const extra = dom.select(Go).events('click'), got = []
    const l = { next: () => got.push(1) }
    extra.addListener(l)
    t.query('button').click(); await t.settle()
    extra.removeListener(l); await stopped()
    t.query('button').click(); await t.settle()
    expect(got.length).toBe(1)
    expect(t.state.n).toBe(2)
  })
})
