// Regression tests for PLAN-1 workstream 1F (framework bug fixes).
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { controlledInputModule } from '../src/cycle/dom/controlledInputModule.js'

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const last = t => t.states[t.states.length - 1]

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
})

// ─── B-003: every sink of one action sees the same state snapshot ───────────

describe('B-003: non-STATE sinks see the state as of their action', () => {
  function Editor({ state }) {
    return h('div', null,
      h('input', { className: 'draft', value: state.draft }),
      h('button', { className: 'save' }, 'Save'),
    )
  }
  Editor.initialState = { draft: '', saved: '' }
  Editor.intent = ({ DOM }) => ({
    EDIT: DOM.input('.draft').value(),
    SAVE: DOM.click('.save'),
  })
  Editor.model = {
    EDIT: (s, draft) => ({ ...s, draft }),
    SAVE: {
      STATE: s => ({ ...s, saved: s.draft }),
      EVENTS: s => ({ type: 'SAVED', data: s.draft.length }),
      SPY: s => s.draft,
    },
  }

  it('EDIT and SAVE in the same tick: STATE, EVENTS and a custom sink all see the edited draft', async () => {
    t = renderComponent(Editor)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'hello' })
    t.simulateEvent('.save', 'click')
    await t.waitForState(s => s.saved === 'hello')
    await settle()
    expect(last(t).saved).toBe('hello')
    expect(t.emitted).toEqual([{ type: 'SAVED', data: 5 }])
    expect(t.sinkValues('SPY')).toEqual(['hello'])
  })

  it('same for a sub-component without initialState (state from the parent, no delay)', async () => {
    const saved = []
    function Child({ state }) {
      return h('div', null,
        h('input', { className: 'draft', value: state.draft }),
        h('button', { className: 'save' }, 'Save'))
    }
    Child.intent = Editor.intent
    Child.model = {
      EDIT: (s, draft) => ({ ...s, draft }),
      SAVE: { STATE: s => ({ ...s, saved: s.draft }), EVENTS: s => ({ type: 'SAVED', data: s.draft.length }) },
    }
    function App() { return h('div', null, h(Child)) }
    App.initialState = { draft: '', saved: '' }
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'hey' })
    t.simulateEvent('.save', 'click')
    await t.waitForState(s => s.saved === 'hey')
    await settle()
    expect(t.emitted).toEqual([{ type: 'SAVED', data: 3 }])
  })

  it('EFFECT handlers see the same snapshot', async () => {
    const seen = []
    function C() { return h('div', null) }
    C.initialState = { n: 0 }
    C.model = {
      INC: s => ({ ...s, n: s.n + 1 }),
      LOOK: { EFFECT: s => { seen.push(s.n) } },
    }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('INC')
    t.simulateAction('INC')
    t.simulateAction('LOOK')
    await t.waitForState(s => s.n === 2)
    await settle()
    expect(seen).toEqual([2])
  })

  it('a non-STATE sink sees the state before its own STATE reducer (unchanged semantics)', async () => {
    function C() { return h('div', null) }
    C.initialState = { n: 0 }
    C.model = {
      BUMP: { STATE: s => ({ ...s, n: s.n + 1 }), SPY: s => s.n },
    }
    t = renderComponent(C)
    await t.ready()
    t.simulateAction('BUMP')
    t.simulateAction('BUMP')
    await t.waitForState(s => s.n === 2)
    await settle()
    expect(t.sinkValues('SPY')).toEqual([0, 1])
  })
})

// ─── B-005: driverFromAsync error channel + null/undefined resolutions ───────

import { driverFromAsync } from '../src/extra/driverFactories.js'
import { vi } from 'vitest'

describe('B-005: driverFromAsync', () => {
  const manual = () => {
    let l = null
    const stream = xs.create({ start(x) { l = x }, stop() { l = null } })
    return { stream, emit: v => l?.next(v) }
  }
  const collect = s => { const out = []; s.addListener({ next: v => out.push(v), error() {}, complete() {} }); return out }

  it('delivers rejections on source.errors(category) and not on select()', async () => {
    const err = new Error('HTTP 500')
    const fetchQuote = async sym => { if (sym === 'BAD') throw err; return 42 }
    const input = manual()
    const source = driverFromAsync(fetchQuote, { args: 'symbol' })(input.stream)
    const ok = collect(source.select('quote'))
    const errs = collect(source.errors('quote'))
    const otherErrs = collect(source.errors('other'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    input.emit({ category: 'quote', symbol: 'BAD' })
    input.emit({ category: 'quote', symbol: 'OK' })
    await settle(10)
    spy.mockRestore()
    expect(ok).toEqual([{ value: 42, category: 'quote' }])
    expect(errs).toEqual([{ error: err, category: 'quote', request: { category: 'quote', symbol: 'BAD' } }])
    expect(otherErrs).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('errors() with no selector or a predicate; a rejecting post() also reports', async () => {
    const input = manual()
    const source = driverFromAsync(async () => 1, { post: async () => { throw new Error('post failed') } })(input.stream)
    const all = collect(source.errors())
    const pred = collect(source.errors(e => e.error.message === 'post failed'))
    input.emit({ category: 'x' })
    await settle(10)
    expect(all.map(e => e.error.message)).toEqual(['post failed'])
    expect(pred.length).toBe(1)
  })

  it('still logs rejections to console.error when nothing listens to errors()', async () => {
    const input = manual()
    const source = driverFromAsync(async () => { throw new Error('nope') })(input.stream)
    collect(source.select())
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    input.emit({ category: 'x' })
    await settle(10)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('driverFromAsync')
    spy.mockRestore()
  })

  it('a promise resolving to null or undefined is delivered, not thrown', async () => {
    const input = manual()
    const vals = [null, undefined]
    const source = driverFromAsync(async () => vals.shift())(input.stream)
    const out = collect(source.select('q'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    input.emit({ category: 'q' })
    input.emit({ category: 'q' })
    await settle(10)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    expect(out).toEqual([{ value: null, category: 'q' }, { value: undefined, category: 'q' }])
  })

  it('a post() returning null is delivered too', async () => {
    const input = manual()
    const source = driverFromAsync(async () => 5, { post: () => null })(input.stream)
    const out = collect(source.select('q'))
    input.emit({ category: 'q' })
    await settle(10)
    expect(out).toEqual([{ value: null, category: 'q' }])
  })
})

// ─── B-008: isolatedState sub-component without a state prop ────────────────

describe('B-008: an isolatedState child without a state prop keeps its own state', () => {
  function Counter({ state }) {
    return h('div', { className: 'counter' },
      h('span', { className: 'n' }, String(state.n)),
      h('button', { className: 'inc' }, '+'))
  }
  Counter.initialState = { n: 5 }
  Counter.isolatedState = true
  Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
  Counter.model = { INC: s => ({ ...s, n: s.n + 1 }) }

  function Parent({ state }) {
    return h('div', null,
      h('span', { className: 'count' }, String(state.count)),
      h(Counter),
      h('button', { className: 'bump' }, 'bump'))
  }
  Parent.initialState = { count: 0 }
  Parent.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
  Parent.model = { BUMP: s => ({ ...s, count: s.count + 1 }) }

  it("does not replace the parent's state with its initialState", async () => {
    t = renderComponent(Parent)
    await t.ready()
    await settle()
    for (const s of t.states) expect(s).toEqual({ count: 0 })
    expect(t.html()).toContain('<span class="n">5</span>')
  })

  it('child and parent update independently', async () => {
    t = renderComponent(Parent)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.inc', 'click')
    await settle(60)
    t.simulateEvent('.bump', 'click')
    await t.waitForState(s => s.count === 1)
    await settle()
    expect(last(t)).toEqual({ count: 1 })
    expect(t.html()).toContain('<span class="n">7</span>')
    expect(t.html()).toContain('<span class="count">1</span>')
  })

  it('two isolated children without a state prop do not share state', async () => {
    function Two() { return h('div', null, h('section', { className: 'a' }, h(Counter)), h('section', { className: 'b' }, h(Counter))) }
    Two.initialState = { x: 1 }
    t = renderComponent(Two)
    await t.ready()
    t.simulateEvent('.b .inc', 'click')
    await settle(80)
    expect(t.html()).toMatch(/class="a">.*<span class="n">5<\/span>.*class="b">.*<span class="n">6<\/span>/)
    expect(last(t)).toEqual({ x: 1 })
  })
})

// ─── B-004: controlled value/checked follow the vnode after coalesced renders ─

describe('B-004: controlledInputModule', () => {
  const vn = (props, elm) => ({ data: { props }, elm })
  it('rewrites value/checked when the prop is unchanged but the live element differs', () => {
    const elm = { value: 'typed', checked: true }
    controlledInputModule.update(vn({ value: '', checked: false }), vn({ value: '', checked: false }, elm))
    expect(elm).toEqual({ value: '', checked: false })
  })
  it('leaves matching elements, null props and changed props (propsModule handles those) alone', () => {
    const elm = { value: '5', checked: false }
    let writes = 0
    const spy = new Proxy(elm, { set: (o, k, v) => { writes++; o[k] = v; return true } })
    controlledInputModule.update(vn({ value: 5 }), vn({ value: 5 }, spy))
    controlledInputModule.update(vn({ value: undefined }), vn({ value: undefined }, spy))
    controlledInputModule.update(vn({ value: 'a' }), vn({ value: 'b' }, spy))
    expect(writes).toBe(0)
  })
})
