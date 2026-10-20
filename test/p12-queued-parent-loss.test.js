// @vitest-environment jsdom
// Desired lifetime contract: queued PARENT work must not run after its known ancestor target
// disappears. Reproduces the linked stress report's Harness -> Board -> Lane -> Card path.
import {it, expect} from 'vitest'
import {h, api} from './parity/harness.js'

for (const dom of ['mock', 'real']) it(`drops queued PARENT work after its board target is removed (${dom} DOM)`, async () => {
  const late = []
  function Card({state}) { return h('button', {className: 'dismiss'}, String(state.n)) }
  Card.intent = ({DOM}) => ({DISMISS: DOM.click('.dismiss')})
  Card.model = {DISMISS: {
    STATE: s => ({...s, n: s.n + 1}),
    EVENTS: api.event('STRESS_DROP_SCOPE', s => s.owner),
    PARENT: s => ({id: s.id, owner: s.owner, n: s.n}),
  }}

  function Lane() { return h('section', null, h(api.Collection, {of: Card, from: 'cards'})) }
  Lane.intent = ({CHILD}) => ({CHILD: CHILD.select(Card)})
  // Forward the payload without touching the now-absent lane state, so the queued hop reaches
  // Board and demonstrates the ancestor lifetime gap rather than an earlier incidental throw.
  Lane.model = {CHILD: {PARENT: (_s, data) => data}}

  function Board() { return h('main', null, h(api.Collection, {of: Lane, from: 'lanes'})) }
  Board.intent = ({CHILD}) => ({CHILD: CHILD.select(Lane)})
  Board.model = {CHILD: {
    STATE: (s, data) => { late.push(['Board.CHILD.STATE', s]); return {...s, seen: [...s.seen, data]} },
    PARENT: (s, data) => { late.push(['Board.CHILD.PARENT', s]); return {board: s.id, data} },
  }}

  function Harness({state}) { return h(Board, {state: api.byId('boards', state.selected)}) }
  Harness.initialState = {selected: 1, boards: [
    {id: 1, seen: [], lanes: [{id: 10, cards: [{id: 100, owner: 1, n: 0}]}]},
    {id: 2, seen: [], lanes: [{id: 20, cards: [{id: 200, owner: 2, n: 0}]}]},
  ]}
  Harness.intent = ({EVENTS, CHILD}) => ({DROP_SCOPE: EVENTS.select('STRESS_DROP_SCOPE'), CHILD: CHILD.select(Board)})
  Harness.model = {
    DROP_SCOPE: (s, id) => ({...s, boards: s.boards.filter(board => board.id !== id)}),
    CHILD: s => s,
  }
  const t = api.renderComponent(Harness, {dom})
  try {
    await t.ready()
    t.simulateEvent('.dismiss', 'click')
    await t.settle()
    expect(t.state.boards).toEqual([Harness.initialState.boards[1]])
    const failures = t.diagnostics.filter(d => d.code === 'SYG216')
    expect(failures, `queued handlers: ${late.map(([name, state]) => name + ': ' + String(state)).join(', ')}`).toEqual([])
    t.expectNoDiagnostics()
  } finally { t.dispose() }
})
