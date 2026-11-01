// @vitest-environment jsdom
// 7.2 (record/replay, maintainer decisions Q1-Q4; dev-plans/research/record-replay): the core
// hooks a recorder and a replay use: onAction returning false drops the action, onDispatch at
// enqueue with the DOM event being delivered (browser DOM driver and sygnal/host), setState seen
// by onAction as a 'setState' action, and the handlers' now() / random() / uuid().
import { describe, it, expect, afterEach } from 'vitest'
import { run, createElement as h, renderComponent, ABORT } from '../src/index.js'
import { HostDocument, makeHostDriver, activate } from '../src/host.ts'

const ticks = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve() }
let apps = []
afterEach(() => { apps.forEach((a) => a.dispose()); apps = []; document.body.innerHTML = '' })
function mount(App, drivers = {}, options = {}) {
  const el = document.createElement('div')
  el.id = 'root'
  document.body.appendChild(el)
  const app = run(App, drivers, { mountPoint: '#root', ...options })
  apps.push(app)
  return { app, el, rt: app.__runtime }
}

function Counter({ state }) { return h('div', null, h('button', { className: 'inc' }, 'inc'), h('b', null, String(state.n))) }
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc'), TICK: DOM.select('document').events('keydown') })
Counter.model = { INC: (s) => ({ n: s.n + 1 }), TICK: (s) => ({ n: s.n + 10 }) }

describe('onAction returning false drops the action (Q1)', () => {
  it('no handler runs and the next layer still sees it; other layers keep running', async () => {
    const m = mount(Counter)
    await ticks()
    const seen = []
    const off = m.rt.addHooks({ onAction: (iv, a) => (a.type == 'INC' ? false : undefined) })
    m.rt.addHooks({ onAction: (iv, a) => { seen.push(a.type) }, wrapHandler: (iv, t) => { seen.push('run ' + t) } })
    m.el.querySelector('.inc').click()
    await ticks()
    expect(m.rt.getState().n).toBe(0)
    expect(seen).toEqual(['INC'])
    off()
    m.el.querySelector('.inc').click()
    await ticks()
    expect(m.rt.getState().n).toBe(1)
  })
})

describe('onDispatch at enqueue, with the DOM event being delivered (Q2)', () => {
  it('browser DOM driver: an intent action from a click carries the click; a next() action none', async () => {
    function App({ state }) { return h('div', null, h('button', { className: 'go' }, 'go'), String(state.n)) }
    App.initialState = { n: 0 }
    App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    App.model = { GO: { EFFECT: (s, d, next) => next('LATER', 1, 0) }, LATER: (s) => ({ n: s.n + 1 }) }
    const m = mount(App)
    await ticks()
    const seen = []
    m.rt.addHooks({ onDispatch: (iv, type, data, cause, event) => seen.push([type, cause, event?.type, event?.target?.className]) })
    m.el.querySelector('.go').click()
    await new Promise((r) => setTimeout(r, 5))
    expect(seen).toEqual([['GO', 'intent', 'click', 'go'], ['LATER', 'next', undefined, undefined]])
  })

  it('document listeners (fromEvent) carry their event too; the slot is cleared after delivery', async () => {
    const m = mount(Counter)
    await ticks()
    const seen = []
    m.rt.addHooks({ onDispatch: (iv, type, data, cause, event) => seen.push([type, event?.type, event === data]) })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    m.rt.dispatch('root', 'INC')
    await ticks()
    expect(seen).toEqual([['TICK', 'keydown', true], ['INC', undefined, true]])
  })

  it('sygnal/host: the host driver records the event it delivers', async () => {
    const doc = new HostDocument()
    const app = run(Counter, { DOM: makeHostDriver(doc) })
    apps.push(app)
    await ticks()
    const seen = []
    app.__runtime.addHooks({ onDispatch: (iv, type, data, cause, event) => seen.push([type, event?.type]) })
    activate(doc.querySelector('.inc'))
    await ticks()
    expect(seen).toEqual([['INC', 'click']])
    expect(app.__runtime.getState().n).toBe(1)
  })

  it('setState and the core\'s seeds are not reported', async () => {
    const m = mount(Counter)
    await ticks()
    const seen = []
    m.rt.addHooks({ onDispatch: (iv, type) => seen.push(type) })
    m.rt.setState('root', { n: 5 })
    await ticks()
    expect(seen).toEqual([])
  })
})

describe('setState goes through onAction as a setState action (Q3)', () => {
  it('with the new state; only when it changes the state; false drops the write', async () => {
    const m = mount(Counter)
    await ticks()
    const seen = []
    const off = m.rt.addHooks({ onAction: (iv, a) => { seen.push([a.type, a.cause, a.data, iv.isRoot]); if (a.data?.n === 99) return false } })
    m.rt.setState('root', (s) => ({ n: s.n + 3 }))
    m.rt.setState('root', ABORT)
    await ticks()
    expect(seen).toEqual([['setState', 'setState', { n: 3 }, true]])
    m.rt.setState('root', { n: 99 })
    await ticks()
    expect(m.rt.getState()).toEqual({ n: 3 })
    off()
  })
})

describe('now() / random() / uuid() on the handlers\' 4th argument (Q4)', () => {
  function Tasks({ state }) { return h('ul', null, state.tasks.map((t) => h('li', null, t.id))) }
  Tasks.initialState = { tasks: [] }
  Tasks.model = {
    ADD: { STATE: (s, title, next, { now, random, uuid }) => ({ tasks: [...s.tasks, { id: uuid(), title, at: now(), r: random() }] }) },
    LOG: { EFFECT: (s, d, next, { now }) => { Tasks.seen.push(now()) } },
  }
  Tasks.seen = []

  it('default: the real clock, Math.random and crypto.randomUUID', async () => {
    const t = renderComponent(Tasks)
    await t.ready()
    const before = Date.now()
    t.simulateAction('ADD', 'a')
    await t.settle()
    const [task] = t.state.tasks
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(task.at).toBeGreaterThanOrEqual(before)
    expect(task.r).toBeGreaterThanOrEqual(0)
    t.dispose()
  })

  it('renderComponent fixes them: a fixed clock, a seeded random, ordered ids (EFFECT too)', async () => {
    const opts = { now: new Date('2026-01-02T03:04:05Z'), random: 7, uuid: true }
    const runOnce = async () => {
      const t = renderComponent(Tasks, opts)
      await t.ready()
      t.simulateAction('ADD', 'a')
      t.simulateAction('ADD', 'b')
      t.simulateAction('LOG')
      await t.settle()
      const s = t.state
      t.dispose()
      return s
    }
    Tasks.seen = []
    const a = await runOnce(), b = await runOnce()
    expect(a).toEqual(b)
    expect(a.tasks.map((x) => x.id)).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'])
    expect(a.tasks[0].at).toBe(Date.parse('2026-01-02T03:04:05Z'))
    expect(a.tasks[0].r).not.toBe(a.tasks[1].r)
    expect(Tasks.seen).toEqual([Date.parse('2026-01-02T03:04:05Z'), Date.parse('2026-01-02T03:04:05Z')])
  })

  it('functions are called each time; a component prop of the same name wins', async () => {
    let n = 0
    const t = renderComponent(Tasks, { now: () => ++n, uuid: () => 'id' + n })
    await t.ready()
    t.simulateAction('ADD', 'a')
    await t.settle()
    expect(t.state.tasks[0]).toMatchObject({ id: 'id0', at: 1 })
    t.dispose()

    function Child({ state }) { return h('i', null, String(state.at)) }
    Child.intent = ({ DOM }) => ({ SET: DOM.click('i') })
    Child.model = { SET: (s, d, next, props) => ({ at: typeof props.now == 'function' ? 'fn' : props.now }) }
    function Parent() { return h('div', null, h(Child, { state: 'kid', now: 42 })) }
    Parent.initialState = { kid: { at: 0 } }
    const p = mount(Parent)
    await ticks()
    p.el.querySelector('i').click()
    await ticks()
    expect(p.el.querySelector('i').textContent).toBe('42')
  })
})
