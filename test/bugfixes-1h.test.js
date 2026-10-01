// Regression tests for PLAN-1 workstream 1H (Phase 1 close-review fixes).
import { describe, it, expect, afterEach, vi } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const last = t => t.states[t.states.length - 1]

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
  vi.restoreAllMocks()
})

// ─── 1H-1: non-STATE sinks are synchronous when no STATE reducer is pending ──

describe('1H-1: non-STATE sinks run synchronously when nothing is pending', () => {
  const manual = () => {
    const p = { l: null }
    p.$ = xs.create({ start(l) { p.l = l }, stop() { p.l = null } })
    return p
  }

  for (const asChild of [false, true]) {
    it(`EFFECT and EVENTS run before the emitting call returns (${asChild ? 'sub-component without initialState' : 'root with initialState'})`, async () => {
      const log = []
      const src = manual()
      function C() { return h('div', null, 'x') }
      C.intent = () => ({ GO: src.$ })
      C.model = { GO: { EFFECT: (_s, e) => { log.push('effect:' + e) }, EVENTS: (_s, e) => ({ type: 'GOT', data: e }) } }
      let Root = C
      if (asChild) {
        Root = function Parent() { return h('div', null, h(C)) }
        Root.initialState = { n: 0 }
      } else {
        C.initialState = { n: 0 }
      }
      t = renderComponent(Root)
      await t.ready()
      await settle(20)
      src.l.next('evt')
      log.push('after-next')
      expect(log).toEqual(['effect:evt', 'after-next'])
      expect(t.emitted).toEqual([{ type: 'GOT', data: 'evt' }])
    })
  }

  it('a sink is deferred behind a same-tick STATE reducer and then sees its result (B-003)', async () => {
    const seen = []
    const src = manual()
    function C() { return h('div', null) }
    C.initialState = { n: 0 }
    C.intent = () => ({ INC: src.$.filter(e => e === 'inc'), LOOK: src.$.filter(e => e === 'look') })
    C.model = { INC: s => ({ ...s, n: s.n + 1 }), LOOK: { EFFECT: s => { seen.push(s.n) } } }
    t = renderComponent(C)
    await t.ready()
    await settle(20)
    src.l.next('inc')
    src.l.next('look')
    expect(seen).toEqual([])
    await settle(20)
    expect(seen).toEqual([1])
    // and synchronous again once nothing is pending
    src.l.next('look')
    expect(seen).toEqual([1, 1])
  })
})

// ─── 1H-2: renderComponent ('collect') still prints error-severity messages ───

describe("1H-2: exceptions are visible under renderComponent's default 'collect' mode", () => {
  it('a throwing reducer prints SYG216 with the error and is also collected; warnings stay silent', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    function C({ state }) { return h('div', null, String(state.n)) }
    C.initialState = { n: 0 }
    C.model = { BOOM: () => { throw new Error('kaboom') }, NOTHING: { SPY: () => undefined } }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('BOOM')
    t.simulateAction('NOTHING') // SYG217 (warn)
    await settle(30)
    const printed = err.mock.calls.filter(c => String(c[0]).includes('SYG216'))
    expect(printed.length).toBe(1)
    expect(printed[0][1].message).toBe('kaboom')
    expect(t.diagnostics.map(d => d.code)).toEqual(['SYG216', 'SYG217'])
    expect(warn).not.toHaveBeenCalled()
  })
})

// ─── 1H-3: B-013 one level deeper (a sub-component inside a Collection item) ──

import { Collection } from '../src/collection.js'

describe('1H-3: a sub-component below a Collection item reduces from fresh state', () => {
  function Editor({ state }) {
    return h('div', null,
      h('input', { className: 'draft', value: state.draft }),
      h('button', { className: 'save' }, 'Save'))
  }
  Editor.intent = ({ DOM }) => ({ EDIT: DOM.input('.draft').value(), SAVE: DOM.click('.save') })
  Editor.model = {
    EDIT: (s, draft) => ({ ...s, draft }),
    SAVE: { STATE: s => ({ ...s, saved: s.draft, savedTag: s.tag }), EVENTS: s => ({ type: 'SAVED', data: s.draft }) },
  }
  function Item() { return h('li', null, h(Editor)) }
  Item.calculated = { tag: s => `#${s.id}` }

  function App() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
  App.initialState = { items: [{ id: 1, draft: '', saved: '' }] }

  it('EDIT then SAVE in one tick inside Collection → Item → Editor (base lens)', async () => {
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'hello' })
    t.simulateEvent('.save', 'click')
    await settle(100)
    const item = last(t).items[0]
    expect(item.draft).toBe('hello')
    expect(item.saved).toBe('hello')
    expect(t.emitted).toEqual([{ type: 'SAVED', data: 'hello' }])
  })

  it("the nested reducer still sees its parent's calculated fields", async () => {
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'x' })
    t.simulateEvent('.save', 'click')
    await settle(100)
    expect(last(t).items[0].savedTag).toBe('#1')
  })

  it('same with a string state lens two levels below the Collection', async () => {
    function Box() { return h('div', null, h(Editor, { state: 'ed' })) }
    function Row() { return h('li', null, h(Box)) }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { rows: [{ id: 1, ed: { draft: '', saved: '' } }] }
    t = renderComponent(List)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'deep' })
    t.simulateEvent('.save', 'click')
    await settle(100)
    expect(last(t).rows[0].ed).toMatchObject({ draft: 'deep', saved: 'deep' })
  })

  it("a top-level base-lens child sees the parent's calculated fields in its reducer (unchanged)", async () => {
    const seen = []
    function Child() { return h('button', { className: 'go' }, 'go') }
    Child.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
    Child.model = { GO: s => { seen.push(s.double); return { ...s, n: s.n + 1 } } }
    function Parent() { return h('div', null, h(Child)) }
    Parent.initialState = { n: 1 }
    Parent.calculated = { double: s => s.n * 2 }
    t = renderComponent(Parent)
    await t.ready()
    t.simulateEvent('.go', 'click')
    t.simulateEvent('.go', 'click')
    await settle(80)
    expect(seen).toEqual([2, 4])
    expect(last(t).n).toBe(3)
  })
})
