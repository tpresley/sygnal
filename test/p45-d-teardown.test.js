// @vitest-environment jsdom
// PLAN-4.5 P45-D item 2: synchronous teardown. A disposed component completes its streams at once
// (it was a setTimeout); the streams left without listeners stop at the macrotask xstream would
// stop them at, but with one setTimeout per level of the stream graph instead of one per stream:
// unmounting a Collection of 100 counters took ~7,000 setTimeout calls, now a few dozen.
// xstream's guard is kept: a stream listened to again before its stop is not restarted.
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'
import { run, Collection, Switchable } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let apps = []
afterEach(() => { apps.forEach(a => a.dispose()); apps = []; document.body.innerHTML = '' })

function mount(App) {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(App, {}, { mountPoint: '#root' })
  apps.push(app)
  return app
}

/** counts setTimeout calls while fn's promise runs */
async function countTimeouts(fn) {
  const st = globalThis.setTimeout
  let n = 0
  globalThis.setTimeout = function (...a) { n++; return st.apply(this, a) }
  try { await fn() } finally { globalThis.setTimeout = st }
  return n
}

function Counter({ state }) {
  return h('div', { className: 'counter' }, h('span', { className: 'val' }, String(state.n)), h('button', { className: 'inc' }, '+'))
}
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

function Counters() {
  return h('div', null, h('button', { id: 'create' }, 'c'), h('button', { id: 'destroy' }, 'd'), h(Collection, { of: Counter, from: 'counters' }))
}
Counters.initialState = { counters: [] }
Counters.intent = ({ DOM }) => ({ CREATE: DOM.click('#create'), DESTROY: DOM.click('#destroy') })
Counters.model = {
  CREATE: (s) => ({ ...s, counters: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, n: 0 })) }),
  DESTROY: (s) => ({ ...s, counters: [] }),
}

describe('P45-D: synchronous teardown', () => {
  it('unmounting 100 Collection items calls a few dozen setTimeouts (was ~70 per item)', async () => {
    mount(Counters)
    await sleep(20)
    document.querySelector('#create').click()
    await sleep(50)
    expect(document.querySelectorAll('.counter').length).toBe(100)
    const n = await countTimeouts(async () => {
      document.querySelector('#destroy').click()
      await sleep(50)
    })
    expect(document.querySelectorAll('.counter').length).toBe(0)
    expect(n).toBeLessThan(60)
  })

  it("an item's intent stream stops in a later macrotask, not in the dispose itself", async () => {
    const log = []
    function Item({ state }) { return h('li', null, state.id) }
    Item.intent = () => ({ TICK: xs.create({ start: () => log.push('start'), stop: () => log.push('stop') }) })
    Item.model = { TICK: (s) => s }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 'a' }] }
    List.model = { CLEAR: { STATE: (s) => ({ ...s, items: [] }) } }
    List.intent = ({ DOM }) => ({ CLEAR: DOM.click('ul') })
    mount(List)
    await sleep(30)
    expect(log).toEqual(['start'])
    document.querySelector('ul').click()
    // the dispose ran in this click's flush; the stop waits for the timers
    for (let i = 0; i < 40; i++) await Promise.resolve()
    expect(document.querySelectorAll('li').length).toBe(0)
    expect(log).toEqual(['start'])
    await sleep(60)
    expect(log).toEqual(['start', 'stop'])
  })

  it('a shared stream that a new item listens to in the same update is not restarted', async () => {
    let starts = 0, stops = 0
    const shared$ = xs.create({ start: (l) => { starts++; l.next(1) }, stop: () => { stops++ } }).remember()
    function Item({ state }) { return h('li', null, state.id) }
    Item.intent = () => ({ SEEN: shared$ })
    Item.model = { SEEN: (s) => s }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 'a' }] }
    // replace item a with item b: a is disposed and b created in the same update
    List.model = { SWAP: (s) => ({ ...s, items: [{ id: 'b' }] }) }
    List.intent = ({ DOM }) => ({ SWAP: DOM.click('ul') })
    mount(List)
    await sleep(30)
    expect(starts).toBe(1)
    document.querySelector('ul').click()
    await sleep(30)
    expect(document.querySelector('li').textContent).toBe('b')
    expect(starts).toBe(1)
    expect(stops).toBe(0)
  })

  it('DISPOSE: its EFFECT and its EVENTS run in the dispose, before the parent patches', async () => {
    const seen = []
    function Item({ state }) { return h('li', null, state.id) }
    Item.model = {
      DISPOSE: { EFFECT: (s) => { seen.push('effect ' + s.id + ' ' + document.querySelectorAll('li').length) }, EVENTS: (s) => ({ type: 'GONE', data: s.id }) },
    }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 'a' }, { id: 'b' }] }
    List.model = { DROP: (s) => ({ ...s, items: s.items.slice(1) }), GONE: (s, id) => (seen.push('gone ' + id), s) }
    List.intent = ({ DOM, EVENTS }) => ({ DROP: DOM.click('ul'), GONE: EVENTS.select('GONE') })
    mount(List)
    await sleep(30)
    document.querySelector('ul').click()
    await sleep(30)
    expect(seen).toEqual(['effect a 2', 'gone a'])
    expect(document.querySelectorAll('li').length).toBe(1)
  })

  it('a disposed component handles no action sent after its dispose (a next() from before)', async () => {
    const seen = []
    function Item({ state }) { return h('li', null, state.id) }
    Item.intent = ({ DOM }) => ({ GO: DOM.click('li') })
    Item.model = {
      GO: { EFFECT: (s, d, next) => { next('LATER', null, 0); seen.push('go') }, PARENT: (s) => s.id },
      LATER: { EFFECT: () => { seen.push('later') } },
    }
    function List() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
    List.initialState = { items: [{ id: 'a' }] }
    List.model = { GO: (s) => ({ ...s, items: [] }) }
    List.intent = ({ CHILD }) => ({ GO: CHILD.select(Item) })
    mount(List)
    await sleep(30)
    document.querySelector('li').click()
    await sleep(30)
    expect(document.querySelectorAll('li').length).toBe(0)
    expect(seen).toEqual(['go'])
  })

  it('Switchable: a page re-created by `instance` keeps a shared stream running', async () => {
    let starts = 0
    const shared$ = xs.create({ start: (l) => { starts++; l.next(1) }, stop: () => {} }).remember()
    function Page({ state }) { return h('p', { className: 'page' }, String(state.k)) }
    Page.intent = () => ({ SEEN: shared$ })
    Page.model = { SEEN: (s) => s }
    function App({ state }) { return h('div', null, h('button', null, 'next'), h(Switchable, { of: { Page }, current: 'Page', instance: state.k })) }
    App.initialState = { k: 1 }
    App.intent = ({ DOM }) => ({ NEXT: DOM.click('button') })
    App.model = { NEXT: (s) => ({ ...s, k: s.k + 1 }) }
    mount(App)
    await sleep(30)
    document.querySelector('button').click()
    await sleep(30)
    expect(document.querySelector('.page').textContent).toBe('2')
    expect(starts).toBe(1)
  })
})
