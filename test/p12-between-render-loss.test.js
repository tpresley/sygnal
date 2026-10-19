// @vitest-environment jsdom
// M10/F7: a real known-target disappearance between renders must end ownership.
// Exact production-source reproducer; desired-contract assertions deliberately fail
// until action-time lifetime invalidation is implemented.
import {afterEach, describe, expect, it} from 'vitest'
import {byId, Collection, createElement as h, renderComponent} from '../src/index.ts'

let t
afterEach(() => { t?.dispose(); t = undefined })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const board = () => ({id: 1, lanes: [{id: 11, cards: [{id: 111, n: 0, reply: ''}]}]})
const card = () => t.state.boards.find(b => b.id === 1).lanes[0].cards[0]

function app() {
  let renders = 0
  function Card({state}) {
    return h('div', null,
      h('button', {className: 'schedule'}, 'schedule'),
      h('button', {className: 'request'}, 'request'),
      h('span', {className: 'count'}, String(state.n)))
  }
  Card.intent = ({DOM}) => ({SCHEDULE: DOM.click('.schedule'), REQUEST: DOM.click('.request')})
  Card.model = {
    SCHEDULE: {EFFECT: (s, d, next) => next('LATER', 10, 150)},
    LATER: (s, n) => ({...s, n: s.n + n}),
    REQUEST: {HTTP: s => ({url: '/card/' + s.id, ok: 'REPLIED'})},
    REPLIED: (s, response) => ({...s, reply: response.reply}),
  }
  function Lane() { return h(Collection, {of: Card, from: 'cards'}) }
  function Board() { return h(Collection, {of: Lane, from: 'lanes'}) }
  function Harness() {
    renders++
    return h('div', null,
      h('button', {className: 'drop'}, 'drop'),
      h('button', {className: 'restore'}, 'restore'),
      h(Board, {state: byId('boards', 1)}))
  }
  Harness.initialState = {boards: [board(), {id: 2, lanes: []}]}
  Harness.intent = ({DOM}) => ({DROP: DOM.click('.drop'), RESTORE: DOM.click('.restore')})
  Harness.model = {
    DROP: s => ({...s, boards: s.boards.filter(b => b.id !== 1)}),
    RESTORE: s => ({...s, boards: [board(), ...s.boards.filter(b => b.id !== 1)]}),
  }
  return {Harness, renders: () => renders}
}

function deleteAndRestore(mode, getRenders) {
  const before = getRenders()
  if (mode === 'real') {
    // Native synchronous clicks bypass the testing helper's intentional quiet window.
    t.query('.drop').click()
    t.query('.restore').click()
  } else {
    // The default mock DOM dispatches both inputs synchronously once ready.
    t.simulateAction('DROP')
    t.simulateAction('RESTORE')
  }
  expect(getRenders()).toBe(before)
}

for (const [mode, options] of [['mock', {}], ['real', {dom: 'real'}]]) describe(`between-render known-target loss (${mode})`, () => {
  it('does not let an old descendant next timer mutate the replacement with the same ID', async () => {
    const {Harness, renders} = app()
    t = renderComponent(Harness, options)
    await t.ready()
    t.simulateEvent('.schedule', 'click')
    await t.settle()
    deleteAndRestore(mode, renders)
    await t.settle()
    expect(card().n).toBe(0)
    await sleep(180)
    await t.settle()
    expect(card().n).toBe(0)
  })

  it('does not let an old descendant HTTP reply mutate the replacement with the same ID', async () => {
    const {Harness, renders} = app()
    t = renderComponent(Harness, options)
    await t.ready()
    t.simulateEvent('.request', 'click')
    await t.settle()
    const request = t.requests('HTTP')[0]
    expect(request).toBeTruthy()
    deleteAndRestore(mode, renders)
    await t.settle()
    expect(card().reply).toBe('')
    try {
      await t.respond('HTTP', {reply: 'OLD LIFETIME'}, request)
    } catch (error) {
      // Correct cancellation may reject scripting an already-aborted request.
      if (!/pending|aborted|superseded/.test(String(error))) throw error
    }
    await t.settle()
    expect(card().reply).toBe('')
  })

  it('control: a completed deletion render cancels old descendant timers before same-ID reinsertion', async () => {
    const {Harness} = app()
    t = renderComponent(Harness, options)
    await t.ready()
    t.simulateEvent('.schedule', 'click')
    await t.settle()
    t.simulateAction('DROP')
    await t.settle()
    t.simulateAction('RESTORE')
    await t.settle()
    await sleep(180)
    await t.settle()
    expect(card().n).toBe(0)
  })
})
