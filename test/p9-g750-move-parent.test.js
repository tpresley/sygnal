// @vitest-environment jsdom
// PLAN-9 G-750 (D468): in the real DOM driver, a keyed component instance (its `key`, D470, or its
// `id`) that moves to another parent element in one patch keeps its state and events, and the DOM
// matches the view. The instance's cached vnode is in the old tree and the new one: snabbdom
// created it in an earlier parent first (its elm became the new element), and its old parent's
// removal then took the new element and left the old one (before the fix: the moved instance
// vanished, its old element stayed, and its scope lost the new element). The fix is in the DOM
// driver's isolate module (cycle/dom/IsolateModule.ts, with G-564's notes).
import { describe, it, expect, afterEach } from 'vitest'
import { run, makeDOMDriver } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

const sleep = (ms = 10) => new Promise((r) => setTimeout(r, ms))
let app, el, errors
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

const hooks = []
function Counter({ state, label }) {
  return h('div', { className: 'counter', data: { label }, hook: { insert: (v) => hooks.push(['insert', label, v.elm]), destroy: (v) => hooks.push(['destroy', label, v.elm]) } },
    h('span', { className: 'n' }, label + ':' + state.n), h('button', { className: 'inc' }, '+'))
}
Counter.isolatedState = true
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

const click = (e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const inc = async (label, times = 1) => { for (let i = 0; i < times; i++) { click(el.querySelector(`.counter[data-label="${label}"] .inc`)); await sleep() } }
const col = (sel) => [...el.querySelectorAll(`${sel} > .counter`)].map((e) => e.textContent.replace('+', ''))

// `layout` (state) -> the view: each column a list of labels; `by`: how the instances are keyed
const start = async (layout, view, by = 'key') => {
  const c = (k) => h(Counter, by === 'key' ? { key: k, label: k } : { id: k, label: k })
  function Host({ state }) { return h('main', null, h('button', { className: 'go' }, 'go'), view(state, c)) }
  Host.initialState = { step: 0 }
  Host.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  Host.model = { GO: (s) => ({ ...s, step: s.step + 1 }) }
  el = document.createElement('div'); el.id = 'root'; document.body.appendChild(el)
  errors = []
  hooks.length = 0
  app = run(Host, { DOM: makeDOMDriver('#root') }, { mountPoint: '#root', onError: (e) => errors.push(e.message) })
  await sleep(20)
  return async () => { click(el.querySelector('.go')); await sleep(20) }
}
// two columns, the layout per step
const columns = (steps) => (state, c) => {
  const [l, r] = steps[Math.min(state.step, steps.length - 1)]
  return h('div', { className: 'cols' }, h('div', { className: 'left' }, ...l.map(c)), h('div', { className: 'right' }, ...r.map(c)))
}
const healthy = () => {
  expect(errors).toEqual([])
  expect(el.getAttribute('data-sygnal-error')).toBe(null)
}

describe('G-750: a keyed instance moves to another parent element (real DOM)', () => {
  for (const by of ['key', 'id']) {
    it(`to an EARLIER parent: state, events and DOM follow (${by})`, async () => {
      const go = await start(null, columns([[['a', 'b'], ['c']], [['a', 'b', 'c'], []]]), by)
      await inc('c', 2)
      const oldC = el.querySelector('.right .counter')
      await go()
      healthy()
      expect(col('.left')).toEqual(['a:0', 'b:0', 'c:2'])
      expect(col('.right')).toEqual([])
      expect(oldC.isConnected).toBe(false)
      // its events reach it in the new place (its scope has the new element)
      await inc('c')
      expect(col('.left')).toEqual(['a:0', 'b:0', 'c:3'])
      await inc('a')
      expect(col('.left')).toEqual(['a:1', 'b:0', 'c:3'])
      healthy()
    })
  }

  it('to a LATER parent', async () => {
    const go = await start(null, columns([[['a', 'b'], ['c']], [['b'], ['c', 'a']]]))
    await inc('a')
    await go()
    healthy()
    expect(col('.left')).toEqual(['b:0'])
    expect(col('.right')).toEqual(['c:0', 'a:1'])
    await inc('a')
    expect(col('.right')).toEqual(['c:0', 'a:2'])
  })

  it('a swap between the columns, both ways in one patch', async () => {
    const go = await start(null, columns([[['a', 'b'], ['c', 'd']], [['d', 'b'], ['c', 'a']]]))
    await inc('a'); await inc('d', 2)
    await go()
    healthy()
    expect(col('.left')).toEqual(['d:2', 'b:0'])
    expect(col('.right')).toEqual(['c:0', 'a:1'])
    expect(el.querySelectorAll('.counter').length).toBe(4)
    await inc('d'); await inc('a')
    expect(col('.left')).toEqual(['d:3', 'b:0'])
    expect(col('.right')).toEqual(['c:0', 'a:2'])
  })

  it('moving back and forth keeps the state', async () => {
    const steps = [[['a'], ['c']], [['a', 'c'], []], [['a'], ['c']], [['c', 'a'], []], [[], ['a', 'c']]]
    const go = await start(null, columns(steps))
    await inc('c')
    for (let i = 1; i < steps.length; i++) {
      await go()
      healthy()
      await inc('c')
      const [l, r] = steps[i]
      const show = (k) => k + ':' + (k === 'c' ? i + 1 : 0)
      expect(col('.left')).toEqual(l.map(show))
      expect(col('.right')).toEqual(r.map(show))
    }
    expect(el.querySelectorAll('.counter').length).toBe(2)
  })

  it('sibling reorders in one parent', async () => {
    const go = await start(null, columns([[['a', 'b', 'c'], []], [['c', 'a', 'b'], []], [['b', 'c', 'a'], []]]))
    await inc('a'); await inc('c', 2)
    await go()
    healthy()
    expect(col('.left')).toEqual(['c:2', 'a:1', 'b:0'])
    await go()
    expect(col('.left')).toEqual(['b:0', 'c:2', 'a:1'])
    await inc('b')
    expect(col('.left')).toEqual(['b:1', 'c:2', 'a:1'])
    healthy()
  })

  // nesting: a deep container before a shallow one, and the reverse
  const nested = (steps) => (state, c) => {
    const [deep, shallow] = steps[Math.min(state.step, steps.length - 1)]
    return h('div', { className: 'cols' },
      h('section', { className: 'outer' }, h('div', { className: 'mid' }, h('div', { className: 'deep' }, ...deep.map(c)))),
      h('div', { className: 'shallow' }, ...shallow.map(c)))
  }

  it('across nesting levels: from a shallow later parent into a deep earlier one, and back', async () => {
    const go = await start(null, nested([[['a'], ['b', 'c']], [['a', 'c'], ['b']], [['a'], ['b', 'c']]]))
    await inc('c', 3)
    await go()
    healthy()
    expect(col('.deep')).toEqual(['a:0', 'c:3'])
    expect(col('.shallow')).toEqual(['b:0'])
    await inc('c')
    expect(col('.deep')).toEqual(['a:0', 'c:4'])
    await go()
    healthy()
    expect(col('.deep')).toEqual(['a:0'])
    expect(col('.shallow')).toEqual(['b:0', 'c:4'])
    await inc('c')
    expect(col('.shallow')).toEqual(['b:0', 'c:5'])
  })

  it('a move into a parent that is created in the same patch, and out of one removed in it', async () => {
    const view = (state, c) => h('div', { className: 'cols' },
      state.step === 1 ? h('div', { className: 'fresh' }, c('c')) : null,
      h('div', { className: 'left' }, c('a')),
      state.step !== 1 ? h('div', { className: 'right' }, c('c')) : null)
    const go = await start(null, view)
    await inc('c', 2)
    await go()
    healthy()
    expect(col('.fresh')).toEqual(['c:2'])
    expect(el.querySelector('.right')).toBe(null)
    await inc('c')
    expect(col('.fresh')).toEqual(['c:3'])
    await go()
    healthy()
    expect(col('.right')).toEqual(['c:3'])
    expect(el.querySelector('.fresh')).toBe(null)
    expect(el.querySelectorAll('.counter').length).toBe(2)
  })

  it("the moved root's own hooks: destroy gets the removed element, insert the new one", async () => {
    const go = await start(null, columns([[['a'], ['c']], [['c', 'a'], []]]))
    const oldC = el.querySelector('.counter[data-label="c"]')
    hooks.length = 0
    await go()
    healthy()
    const newC = el.querySelector('.counter[data-label="c"]')
    expect(newC).not.toBe(oldC)
    const c = hooks.filter(([, l]) => l === 'c')
    expect(c).toHaveLength(2)
    expect(c).toEqual(expect.arrayContaining([['insert', 'c', newC], ['destroy', 'c', oldC]]))
    expect(hooks.some(([, l]) => l === 'a')).toBe(false)
  })
})
