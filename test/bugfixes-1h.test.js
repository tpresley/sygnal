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

  it('stays synchronous after an app is disposed with a STATE reducer still in flight', async () => {
    function A({ state }) { return h('div', null, String(state.n)) }
    A.initialState = { n: 0 }
    A.model = { INC: s => ({ ...s, n: s.n + 1 }) }
    const t1 = renderComponent(A)
    await t1.ready()
    t1.simulateAction('INC')
    t1.dispose() // the reducer above is never applied
    await settle(20)
    const log = []
    const src = manual()
    function C() { return h('div', null, 'x') }
    C.initialState = { n: 0 }
    C.intent = () => ({ GO: src.$ })
    C.model = { GO: { EFFECT: () => { log.push('effect') } } }
    t = renderComponent(C)
    await t.ready()
    await settle(20)
    src.l.next('evt')
    log.push('after-next')
    expect(log).toEqual(['effect', 'after-next'])
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

// ─── 1H-4: renderComponent becomes ready without a first render ──────────────

describe('1H-4: renderComponent with a model but no initialState', () => {
  it('buffered simulateAction calls are delivered and set the first state', async () => {
    function C({ state }) { return h('div', null, String(state && state.n)) }
    C.model = { LOAD: (_s, d) => ({ n: d }) }
    t = renderComponent(C)
    t.simulateAction('LOAD', 5)
    const s = await t.waitForState(s => s && s.n === 5, 1000)
    expect(s).toEqual({ n: 5 })
    expect(t.html()).toBe('<div>5</div>')
  })

  it('ready() resolves', async () => {
    function C() { return h('div', null, 'x') }
    C.model = { LOAD: (_s, d) => ({ n: d }) }
    t = renderComponent(C)
    const r = await Promise.race([t.ready().then(() => 'ready'), settle(500).then(() => 'hung')])
    expect(r).toBe('ready')
  })

  it('disposing before ready does not throw later', async () => {
    function C() { return h('div', null, 'x') }
    C.model = { LOAD: (_s, d) => ({ n: d }) }
    const t2 = renderComponent(C)
    t2.dispose()
    await settle(120)
  })
})

// ─── 1H-5: overlapping renderComponent instances keep the diagnostics config ─

import { getDiagnosticsMode, configureDiagnostics, report, getDiagnostics } from '../src/extra/diagnostics/index.js'

describe('1H-5: overlapping and nested renderComponent instances', () => {
  function C({ state }) { return h('div', null, String(state.n)) }
  C.initialState = { n: 0 }

  it('overlap: disposing the first keeps diagnostics on for the second; the last restores the defaults', () => {
    expect(getDiagnosticsMode()).toBe('off')
    const t1 = renderComponent(C)
    const t2 = renderComponent(C)
    t1.dispose()
    expect(getDiagnosticsMode()).toBe('collect')
    t2.dispose()
    expect(getDiagnosticsMode()).toBe('off')
    // no explicit mode left behind: the dev flag still decides
    globalThis.__SYGNAL_DEV__ = true
    try {
      configureDiagnostics({})
      expect(getDiagnosticsMode()).toBe('warn')
    } finally {
      delete globalThis.__SYGNAL_DEV__
      configureDiagnostics({})
    }
  })

  it('nesting with explicit modes: the outer config (mode and ignore list) comes back exactly', () => {
    configureDiagnostics({ mode: 'error', ignore: ['SYG213'] })
    const t1 = renderComponent(C, { diagnostics: 'collect' })
    const t2 = renderComponent(C, { diagnostics: 'warn' })
    expect(getDiagnosticsMode()).toBe('warn')
    t2.dispose()
    expect(getDiagnosticsMode()).not.toBe('off')
    t1.dispose()
    expect(getDiagnosticsMode()).toBe('error')
    expect(report('SYG213', { message: 'ignored' })).toBeUndefined()
    expect(getDiagnostics()).toEqual([])
  })

  it('overlap with an explicit outer config: the live instance keeps its mode; the last dispose restores it', () => {
    configureDiagnostics({ mode: 'error', ignore: ['SYG213'] })
    const t1 = renderComponent(C, { diagnostics: 'collect' })
    const t2 = renderComponent(C)
    t1.dispose()
    expect(getDiagnosticsMode()).toBe('collect')
    t2.dispose()
    expect(getDiagnosticsMode()).toBe('error')
    expect(report('SYG213', { message: 'ignored' })).toBeUndefined()
  })

  it('dispose order t2 then t1 also restores', () => {
    const t1 = renderComponent(C)
    const t2 = renderComponent(C)
    t2.dispose()
    expect(getDiagnosticsMode()).toBe('collect')
    t1.dispose()
    expect(getDiagnosticsMode()).toBe('off')
  })
})

// ─── 1H-6: driverFromAsync logs errors that no errors() selector matches ─────

import { driverFromAsync } from '../src/extra/driverFactories.js'

describe('1H-6: driverFromAsync errors(selector) only claims the errors it matches', () => {
  const manual = () => {
    let l = null
    const stream = xs.create({ start(x) { l = x }, stop() { l = null } })
    return { stream, emit: v => l?.next(v) }
  }
  const collect = s => { const out = []; const lis = { next: v => out.push(v), error() {}, complete() {} }; s.addListener(lis); out.stop = () => s.removeListener(lis); return out }

  it('an error for another category is still logged once errors(a) is subscribed', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const input = manual()
    const src = driverFromAsync(async v => { throw new Error('fail ' + v) }, { args: 'value' })(input.stream)
    const a = collect(src.errors('a'))
    collect(src.select())
    input.emit({ value: 1, category: 'b' })
    input.emit({ value: 2, category: 'a' })
    await settle(10)
    expect(a.map(e => e.error.message)).toEqual(['fail 2'])
    expect(err).toHaveBeenCalledTimes(1)
    expect(err.mock.calls[0][0]).toContain('fail 1')
  })

  it('several subscribers: each gets its matches; a predicate and errors() count as handling', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const input = manual()
    const src = driverFromAsync(async v => { throw new Error('e' + v) }, { args: 'value' })(input.stream)
    const a = collect(src.errors('a'))
    const big = collect(src.errors(e => e.request.value > 5))
    input.emit({ value: 1, category: 'a' })
    input.emit({ value: 9, category: 'c' })
    input.emit({ value: 2, category: 'c' })
    await settle(10)
    expect(a.map(e => e.error.message)).toEqual(['e1'])
    expect(big.map(e => e.error.message)).toEqual(['e9'])
    expect(err.mock.calls.map(c => c[0])).toEqual([expect.stringContaining('e2')])
    // unsubscribing errors('a') makes its category unhandled again
    a.stop()
    big.stop()
    await settle(5) // xstream stops a stream asynchronously after its last listener leaves
    const all = collect(src.errors())
    input.emit({ value: 3, category: 'a' })
    await settle(10)
    expect(all.map(e => e.error.message)).toEqual(['e3'])
    all.stop()
    await settle(5)
    input.emit({ value: 4, category: 'a' })
    await settle(10)
    expect(err).toHaveBeenCalledTimes(2)
  })
})

// ─── 1H-7: controlledInputModule only touches form fields ────────────────────

import { controlledInputModule } from '../src/cycle/dom/controlledInputModule.js'

describe('1H-7: controlledInputModule scope and comparison', () => {
  // P45-A: the module checks the vnode's tag (sel), as snabbdom's vnodes always carry it
  const patch = (props, elm) => controlledInputModule.update({ data: { props } }, { sel: elm.tagName.toLowerCase(), data: { props }, elm })
  const counting = (tagName, init, extra = {}) => {
    const state = { ...init }
    const sets = { value: 0, checked: 0 }
    const elm = { tagName, ...extra }
    for (const k of ['value', 'checked']) {
      Object.defineProperty(elm, k, { get: () => state[k], set: v => { sets[k]++; state[k] = v } })
    }
    return { elm, sets, state }
  }

  it('<progress value> is not touched', () => {
    const { elm, sets } = counting('PROGRESS', { value: 0.5 })
    patch({ value: 1 }, elm)
    patch({ value: 1 }, elm)
    expect(sets.value).toBe(0)
  })

  it('a custom element with an object value is not touched', () => {
    const doc = { text: 'hi' }
    const { elm, sets } = counting('MY-EDITOR', { value: doc })
    for (let i = 0; i < 5; i++) patch({ value: doc }, elm)
    expect(sets.value).toBe(0)
  })

  it('<input type=file> is skipped (setting its value would throw)', () => {
    const elm = { tagName: 'INPUT', type: 'file', get value() { return 'C:\\fakepath\\a.txt' }, set value(_) { throw new Error('InvalidStateError') } }
    expect(() => patch({ value: '' }, elm)).not.toThrow()
  })

  it('INPUT, TEXTAREA and SELECT are synced; value compares as a string, checked as a boolean', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const { elm, sets, state } = counting(tag, { value: 'typed', checked: false })
      patch({ value: '' }, elm)
      expect(state.value).toBe('')
      patch({ value: 5 }, elm) // '5' after the write below
      expect(state.value).toBe('5')
      patch({ value: 5 }, elm)  // '5' === String(5): no write
      expect(sets.value).toBe(2)
    }
    const { elm, sets, state } = counting('INPUT', { checked: true })
    patch({ checked: 1 }, elm)  // truthy, element already checked: no write
    expect(sets.checked).toBe(0)
    patch({ checked: 0 }, elm)
    expect(state.checked).toBe(false)
    expect(sets.checked).toBe(1)
  })
})

// ─── 1H-9: an isolatedState child's writes don't produce a new parent state ──

describe('1H-9: isolatedState child without a state prop keeps its state off the parent stream', () => {
  function Child({ state }) { return h('button', { className: 'c' }, String(state.k)) }
  Child.isolatedState = true
  Child.initialState = { k: 0 }
  Child.intent = ({ DOM }) => ({ INC: DOM.click('.c') })
  Child.model = { INC: s => ({ ...s, k: s.k + 1 }) }

  it('a child write emits no parent state and does not re-render the parent view', async () => {
    let renders = 0
    function App({ state }) { renders++; return h('div', null, h('span', { className: 'count' }, String(state.count)), h(Child)) }
    App.initialState = { count: 0 }
    t = renderComponent(App)
    await t.ready()
    await settle(30)
    const before = t.states.length, r0 = renders
    t.simulateEvent('.c', 'click')
    t.simulateEvent('.c', 'click')
    await settle(60)
    expect(t.states.length - before).toBe(0)
    expect(renders - r0).toBe(0)
    expect(t.html()).toContain('<button class="c">2</button>')
  })

  it("a sibling Collection's items keep their state objects (no churn)", async () => {
    const itemRenders = []
    function Row({ state }) { itemRenders.push(state.id); return h('li', null, String(state.id)) }
    function App() { return h('div', null, h(Child), h(Collection, { of: Row, from: 'rows' })) }
    App.initialState = { rows: [{ id: 1 }, { id: 2 }] }
    t = renderComponent(App)
    await t.ready()
    await settle(30)
    const n0 = itemRenders.length
    t.simulateEvent('.c', 'click')
    await settle(60)
    expect(itemRenders.length).toBe(n0)
  })

  it("grandchildren of the isolated child read and write the child's local state", async () => {
    function Leaf({ state }) { return h('i', { className: 'leaf' }, String(state.k)) }
    Leaf.intent = ({ DOM }) => ({ BUMP: DOM.click('.leaf') })
    Leaf.model = { BUMP: s => ({ ...s, k: s.k + 10 }) }
    function Mid({ state }) { return h('div', null, h('b', null, String(state.k)), h(Leaf)) }
    Mid.isolatedState = true
    Mid.initialState = { k: 1 }
    Mid.model = { NOOP: s => s } // (before B-016 a model was needed for INITIALIZE to run)
    function App({ state }) { return h('div', null, h('span', null, String(state.count)), h(Mid)) }
    App.initialState = { count: 0 }
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.leaf', 'click')
    await settle(60)
    expect(t.html()).toContain('<b>11</b>')
    expect(t.html()).toContain('<i class="leaf">11</i>')
    expect(t.states.every(s => JSON.stringify(s) === '{"count":0}')).toBe(true)
  })
})

// ─── 1H-11: renderComponent's SYG104 check doesn't walk for disposed children ─

import { _testingStats } from '../src/extra/testing.js'

describe('1H-11: SYG104 check cost', () => {
  function Item() { return h('li', null, 'i') }
  Item.intent = ({ DOM }) => ({ X: DOM.click('.never-rendered') })
  Item.model = { X: s => s }
  function App({ state }) { return h('div', null, h('span', null, String(state.n)), h(Collection, { of: Item, from: 'items' })) }
  App.initialState = { n: 0, items: Array.from({ length: 20 }, (_, i) => ({ id: i + 1 })) }
  App.model = { CLEAR: s => ({ ...s, items: [] }), BUMP: s => ({ ...s, n: s.n + 1 }) }

  it('listeners of disposed Collection items are pruned', async () => {
    t = renderComponent(App)
    await t.ready()
    await settle(30)
    t.simulateAction('CLEAR')
    await t.waitForState(s => s.items.length === 0)
    await settle(40)
    const w0 = _testingStats.walks
    for (let i = 1; i <= 5; i++) {
      t.simulateAction('BUMP')
      await t.waitForState(s => s.n === i)
    }
    expect(_testingStats.walks - w0).toBe(0)
  })

  it('a live listener is still checked (and SYG104 still reported)', async () => {
    function Child() { return h('div', null, h('button', { className: 'inner' }, 'x')) }
    function Parent({ state }) { return h('div', null, h('span', null, String(state.n)), state.show ? h(Child) : null) }
    Parent.initialState = { n: 0, show: false }
    Parent.intent = ({ DOM }) => ({ GO: DOM.click('.inner') })
    Parent.model = { GO: s => s, SHOW: s => ({ ...s, show: true }) }
    t = renderComponent(Parent)
    await t.ready()
    const w0 = _testingStats.walks
    t.simulateAction('SHOW')
    await t.waitForState(s => s.show)
    await settle(20)
    expect(_testingStats.walks).toBeGreaterThan(w0)
    expect(t.diagnostics.filter(d => d.code === 'SYG104').length).toBe(1)
  })
})

// ─── 1H-12: waitForState waits for the render of an already-recorded state ───

describe('1H-12: waitForState resolves once the matching state has been rendered', () => {
  it('a state that is recorded but not rendered yet is waited for', async () => {
    function C({ state }) { return h('div', null, String(state.n)) }
    C.initialState = { n: 0 }
    C.model = { INC: s => ({ ...s, n: s.n + 1 }) }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('INC')
    for (let i = 0; i < 5 && !t.states.some(s => s.n === 1); i++) await Promise.resolve()
    expect(t.states.some(s => s.n === 1)).toBe(true) // recorded...
    expect(t.html()).toBe('<div>0</div>')            // ...but not rendered yet
    const s = await t.waitForState(s => s.n === 1)
    expect(s.n).toBe(1)
    expect(t.html()).toBe('<div>1</div>')
  })

  it('an already-rendered state resolves without waiting for another render', async () => {
    function C({ state }) { return h('div', null, String(state.n)) }
    C.initialState = { n: 0 }
    t = renderComponent(C)
    await t.ready()
    const t0 = Date.now()
    await t.waitForState(s => s.n === 0)
    expect(Date.now() - t0).toBeLessThan(15)
  })
})
