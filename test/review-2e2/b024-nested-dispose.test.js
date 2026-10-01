// 2E-2 regression test (PLAN-1 Phase 2 close-review fixes).
// B-024: removing a Collection item disposes its whole subtree (nested Collections,
// Switchables, plain sub-components) exactly once.
import { describe, it, expect } from 'vitest'
import xs from 'xstream'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement as h } from '../../src/pragma/index.js'
import { Collection } from '../../src/collection.js'
import { Switchable } from '../../src/switchable.js'
import { wait, track, useFreshDiagnostics } from './helpers.js'

useFreshDiagnostics()

const disposed = []
let liveTicks = 0
const tick$ = () => xs.create({ start() { liveTicks++ }, stop() { liveTicks-- } })

function Card({ state }) { return h('li', { className: 'card' }, state.title) }
Card.intent = () => ({ TICK: tick$() })
Card.model = { TICK: s => s, DISPOSE: { EFFECT: s => { disposed.push('Card ' + s.id) } } }

function Badge({ state }) { return h('span', { className: 'badge' }, String(state)) }
Badge.model = { DISPOSE: { EFFECT: () => { disposed.push('Badge') } } }

function TabA() { return h('i', null, 'a') }
TabA.model = { DISPOSE: { EFFECT: () => { disposed.push('TabA') } } }
function TabB() { return h('b', null, 'b') }
TabB.model = { DISPOSE: { EFFECT: () => { disposed.push('TabB') } } }

function Lane({ state }) {
  return h('section', { className: 'lane' },
    h(Collection, { of: Card, from: 'cards' }),
    h(Badge, { state: 'count' }),
    h(Switchable, { of: { a: TabA, b: TabB }, current: state.tab }),
  )
}
Lane.model = { DISPOSE: { EFFECT: s => { disposed.push('Lane ' + s.id) } } }

function Board({ state }) { return h('main', null, h(Collection, { of: Lane, from: 'lanes' })) }
Board.initialState = {
  lanes: [
    { id: 'l1', count: 2, tab: 'a', cards: [{ id: 'c1', title: 'one' }, { id: 'c2', title: 'two' }] },
    { id: 'l2', count: 1, tab: 'b', cards: [{ id: 'c3', title: 'three' }] },
  ],
}
Board.model = { REMOVE_LANE: (s, id) => ({ ...s, lanes: s.lanes.filter(l => l.id !== id) }) }

describe('B-024: removing a Collection item disposes its subtree', () => {
  it('fires DISPOSE / onDispose for grandchildren exactly once, and their streams stop', async () => {
    disposed.length = 0
    const live = new Map()
    track({
      onIntent(c) { live.set(c, c.name) },
      onDispose(c) { live.delete(c) },
    })
    const counts = () => [...live.values()].sort().join(',')

    const t = renderComponent(Board)
    await t.ready()
    await t.settle?.()
    await wait(40)
    expect(counts()).toBe('Badge,Badge,Board,Card,Card,Card,Lane,Lane,TabA,TabA,TabB,TabB')
    expect(liveTicks).toBe(3)

    t.simulateAction('REMOVE_LANE', 'l1')
    await t.waitForState(s => s.lanes.length === 1)
    await wait(40)

    expect([...disposed].sort()).toEqual(['Badge', 'Card c1', 'Card c2', 'Lane l1', 'TabA', 'TabB'])
    expect(counts()).toBe('Badge,Board,Card,Lane,TabA,TabB')
    expect(liveTicks).toBe(1)
    // the runtime graph has no orphans
    const g = t.inspect()
    const ids = new Set(g.components.map(c => c.id))
    expect(g.components.filter(c => c.parentId !== null && !ids.has(c.parentId))).toEqual([])

    t.dispose()
    await wait(30)
    expect([...disposed].sort()).toEqual([
      'Badge', 'Badge', 'Card c1', 'Card c2', 'Card c3', 'Lane l1', 'Lane l2', 'TabA', 'TabA', 'TabB', 'TabB',
    ])
    expect(counts()).toBe('')
    expect(liveTicks).toBe(0)
  })
})
