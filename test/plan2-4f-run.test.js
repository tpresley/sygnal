// @vitest-environment jsdom
// PLAN-2 4-F C1: under run(), the STATE stream carries current calculated fields after a
// Collection item writes (the core recomputes them when a child's write reaches the parent).
import { it, expect, beforeEach, afterEach } from 'vitest'
import run from '../src/extra/run.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
let app
beforeEach(() => { document.body.innerHTML = '<div id="root"></div>' })
afterEach(() => {
  try { app?.dispose() } catch (_) {}
  app = null
})

function Item({ state }) {
  return h('li', { className: 'item' }, h('button', { className: 'toggle' }, state.done ? 'done' : 'open'))
}
Item.intent = ({ DOM }) => ({ TOGGLE: DOM.click('.toggle') })
Item.model = { TOGGLE: s => ({ ...s, done: !s.done }) }

function App({ state }) {
  return h('div', null,
    h('p', { className: 'summary' }, `${state.openCount} open`),
    h(Collection, { of: Item, from: 'items' }))
}
App.initialState = { items: [{ id: 1, done: false }, { id: 2, done: false }] }
App.calculated = { openCount: s => s.items.filter(i => !i.done).length }

it('the root STATE stream has the recomputed calculated field after an item writes', async () => {
  app = run(App, {}, { mountPoint: '#root' })
  const seen = []
  app.sources.STATE.stream.addListener({ next: s => seen.push(s), error: () => {}, complete: () => {} })
  const until = async (cond, what) => {
    for (const end = Date.now() + 2000; !cond(); await sleep(5)) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    }
  }
  await until(() => document.querySelector('.toggle'), 'the first render')
  document.querySelector('.toggle').click()
  await until(() => seen.some(s => s.items[0].done), 'the item write')
  expect(seen.at(-1).openCount).toBe(1)
  await until(() => document.querySelector('.summary').textContent === '1 open', 'the view')
})
