// @vitest-environment jsdom
// PLAN-4 2-B GS-6: STATE.watch(selector, { immediate = false }) is a stream of selector(state),
// emitted only when the selected value changes structurally (objIsEqual). In a Collection item
// `state` is the item's slice. Used from an intent, it stops with the component (dispose).
import { describe, it, expect, afterEach } from 'vitest'

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'
import { debounce } from '../src/extra/xstreamExtras.js'
import { StateSource } from '../src/cycle/state/index.js'
import xs from '../src/extra/xstreamCompat.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  _resetDiagnostics()
})

const collect = (s$) => {
  const out = []
  s$.addListener({ next: v => out.push(v), complete: () => out.push('END') })
  return out
}

describe('GS-6: STATE.watch on a StateSource', () => {
  it('emits only changes (no current value by default); { immediate: true } emits the current value first', () => {
    const state$ = xs.create()
    const src = new StateSource(state$, 'STATE')
    src.stream.addListener({})
    state$.shamefullySendNext({ a: 1, b: 1 })
    const later = collect(src.watch(s => s.a))
    const now = collect(src.watch(s => s.a, { immediate: true }))
    state$.shamefullySendNext({ a: 1, b: 2 })
    state$.shamefullySendNext({ a: 2, b: 2 })
    state$.shamefullySendNext({ a: 2, b: 3 })
    state$.shamefullySendNext({ a: 3, b: 3 })
    expect(later).toEqual([2, 3])
    expect(now).toEqual([1, 2, 3])
  })

  it('object selectors do not re-emit on equal content (structural, not identity)', () => {
    const state$ = xs.create()
    const src = new StateSource(state$, 'STATE')
    src.stream.addListener({})
    state$.shamefullySendNext({ user: { name: 'a', tags: ['x'] }, n: 0 })
    const out = collect(src.watch(s => ({ name: s.user.name, tags: s.user.tags })))
    state$.shamefullySendNext({ user: { name: 'a', tags: ['x'] }, n: 1 })   // new objects, equal content
    state$.shamefullySendNext({ user: { name: 'a', tags: ['x'] }, n: 2 })
    state$.shamefullySendNext({ user: { name: 'b', tags: ['x'] }, n: 3 })
    expect(out).toEqual([{ name: 'b', tags: ['x'] }])
  })

  it('ends when the state stream ends', () => {
    const state$ = xs.create()
    const src = new StateSource(state$, 'STATE')
    src.stream.addListener({})
    state$.shamefullySendNext({ a: 1 })
    const out = collect(src.watch(s => s.a))
    state$.shamefullySendNext({ a: 2 })
    state$.shamefullySendComplete()
    expect(out).toEqual([2, 'END'])
  })
})

describe('GS-6: STATE.watch in components', () => {
  it('autosave recipe: watch + debounce + reply actions against the HTTP fake', async () => {
    function Editor({ state }) {
      return h('div', null, h('textarea', { className: 'body', value: state.draft }), h('span', { className: 'status' }, state.status))
    }
    Editor.initialState = { draft: '', status: 'idle' }
    Editor.intent = ({ DOM, STATE }) => ({
      EDIT: DOM.input('.body').value(),
      SAVE: STATE.watch(s => s.draft).compose(debounce(20)),
    })
    Editor.model = {
      EDIT: (s, draft) => ({ ...s, draft }),
      SAVE: {
        STATE: s => ({ ...s, status: 'saving' }),
        HTTP: (s, draft) => ({ url: '/api/draft', method: 'PUT', body: { draft }, ok: 'SAVED', error: 'SAVE_FAILED' }),
      },
      SAVED: s => ({ ...s, status: 'saved' }),
      SAVE_FAILED: s => ({ ...s, status: 'error' }),
    }
    t = renderComponent(Editor)
    await t.ready()
    expect(t.requests('HTTP')).toEqual([])   // the initial state is not a change
    t.simulateEvent('.body', 'input', { value: 'h' })
    t.simulateEvent('.body', 'input', { value: 'he' })
    t.simulateEvent('.body', 'input', { value: 'hey' })
    await t.waitForState(s => s.status === 'saving')
    expect(t.requests('HTTP')).toEqual([{ url: '/api/draft', method: 'PUT', body: { draft: 'hey' }, ok: 'SAVED', error: 'SAVE_FAILED' }])
    await t.respond('HTTP', {}, 'SAVED')
    expect(t.state.status).toBe('saved')
    expect(t.html()).toContain('saved')
    // the status changes did not re-trigger a save (the watched value did not change)
    await new Promise(r => setTimeout(r, 40))
    expect(t.requests('HTTP')).toHaveLength(1)
    t.simulateEvent('.body', 'input', { value: 'hey!' })
    await t.next(s => s.status === 'saving')
    expect(t.requests('HTTP')[1].body).toEqual({ draft: 'hey!' })
    await t.fail('HTTP', 500)
    expect(t.state.status).toBe('error')
  })

  it('immediate: true fires once for the initial state', async () => {
    function C({ state }) { return h('div', null, String(state.seen)) }
    C.initialState = { n: 5, seen: [] }
    C.intent = ({ STATE }) => ({ SEEN: STATE.watch(s => s.n, { immediate: true }) })
    C.model = { SEEN: (s, n) => ({ ...s, seen: [...s.seen, n] }) }
    t = renderComponent(C)
    await t.waitForState(s => s.seen.length === 1)
    await new Promise(r => setTimeout(r, 20))
    expect(t.state.seen).toEqual([5])
  })

  it('in a Collection item, state is the item slice; items watch independently; a removed item stops', async () => {
    const log = []
    function Item({ state }) { return h('li', null, h('button', { className: 'inc' }, 'inc'), String(state.n)) }
    Item.intent = ({ DOM, STATE }) => ({ INC: DOM.click('.inc'), CHANGED: STATE.watch(s => s.n) })
    Item.model = {
      INC: s => ({ ...s, n: s.n + 1 }),
      CHANGED: { EFFECT: (s, n) => { log.push([s.id, n]) } },
    }
    function List({ state }) {
      return h('div', null, h('button', { className: 'drop' }, 'drop'), h('button', { className: 'bump' }, 'bump'), h('ul', null, h(Collection, { of: Item, from: 'items' })))
    }
    List.initialState = { items: [{ id: 1, n: 0 }, { id: 2, n: 0 }] }
    List.intent = ({ DOM }) => ({ DROP: DOM.click('.drop'), BUMP: DOM.click('.bump') })
    List.model = {
      DROP: s => ({ ...s, items: s.items.slice(1) }),
      BUMP: s => ({ ...s, items: s.items.map(i => ({ ...i, n: i.n + 10 })) }),
    }
    t = renderComponent(List, { dom: 'real' })
    await t.ready()
    t.simulateEvent('li:nth-child(2) .inc', 'click')
    await t.waitForState(s => s.items[1].n === 1)
    await new Promise(r => setTimeout(r, 20))
    expect(log).toEqual([[2, 1]])
    t.simulateEvent('.drop', 'click')
    await t.waitForState(s => s.items.length === 1)
    await new Promise(r => setTimeout(r, 20))
    t.simulateEvent('.bump', 'click')
    await t.waitForState(s => s.items[0].n === 11)
    await new Promise(r => setTimeout(r, 20))
    expect(log).toEqual([[2, 1], [2, 11]])
  })

  it('ends on dispose: a removed Collection item and a disposed root complete their watch streams', async () => {
    const ev = []
    function Item({ state }) { return h('li', null, String(state.n)) }
    Item.intent = ({ STATE }) => { const w = STATE.watch(s => s.n); w.addListener({ complete: () => ev.push('item-end') }); return { X: w } }
    Item.model = { X: s => s }
    function C({ state }) { return h('div', null, h(Collection, { of: Item, from: 'items' })) }
    C.initialState = { n: 1, items: [{ id: 1, n: 1 }] }
    C.intent = ({ STATE }) => { const w = STATE.watch(s => s.n); w.addListener({ complete: () => ev.push('root-end') }); return { N: w } }
    C.model = { N: s => s, DROP: s => ({ ...s, items: [] }) }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('DROP')
    await new Promise(r => setTimeout(r, 30))
    ev.push('--')
    t.dispose()
    await new Promise(r => setTimeout(r, 30))
    expect(ev).toEqual(['item-end', '--', 'root-end'])
  })
})
