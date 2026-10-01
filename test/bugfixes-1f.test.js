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

// ─── B-009: two Collections whose items share ids ───────────────────────────

import { Collection } from '../src/collection.js'

describe('B-009: Collections with overlapping item ids keep separate isolation scopes', () => {
  function Item({ state }) { return h('li', null, h('button', { className: 'hit' }, `${state.id}:${state.n}`)) }
  Item.intent = ({ DOM }) => ({ HIT: DOM.click('.hit') })
  Item.model = { HIT: s => ({ ...s, n: s.n + 1 }) }

  function Lists() {
    return h('div', null,
      h(Collection, { of: Item, from: 'a', className: 'list-a' }),
      h(Collection, { of: Item, from: 'b', className: 'list-b' }))
  }
  Lists.initialState = { a: [{ id: 1, n: 0 }], b: [{ id: 1, n: 0 }] }

  it('an event in one collection item does not reach the same-id item of the other collection', async () => {
    t = renderComponent(Lists)
    await t.ready()
    t.simulateEvent('.list-b .hit', 'click')
    await t.waitForState(s => s.b[0].n === 1)
    await settle(60)
    expect(last(t)).toEqual({ a: [{ id: 1, n: 0 }], b: [{ id: 1, n: 1 }] })
  })

  it('a single collection still works (regression guard)', async () => {
    function One() { return h('div', null, h(Collection, { of: Item, from: 'a', className: 'list-a' })) }
    One.initialState = { a: [{ id: 1, n: 0 }, { id: 2, n: 0 }] }
    t = renderComponent(One)
    await t.ready()
    t.simulateEvent('.hit', 'click')
    await t.waitForState(s => s.a[0].n === 1)
    await settle(40)
    expect(last(t).a).toEqual([{ id: 1, n: 1 }, { id: 2, n: 0 }])
  })
})

// ─── G-020: EVENTS devtools stamps are non-enumerable ───────────────────────

describe('G-020: EVENTS sink values compare equal to what the model returned', () => {
  it('raw EVENTS sink output toEqual the reducer output; stamps still readable', async () => {
    function C() { return h('div', null) }
    C.initialState = {}
    C.model = { PING: { EVENTS: () => ({ type: 'PONG', data: 1 }) } }
    t = renderComponent(C)
    const raw = []
    t.sinks.EVENTS.addListener({ next: v => raw.push(v) })
    await t.ready()
    t.simulateAction('PING')
    await settle()
    expect(raw).toEqual([{ type: 'PONG', data: 1 }])
    expect(Object.keys(raw[0])).toEqual(['type', 'data'])
    expect(raw[0].__emitterName).toBe('C')
    expect(typeof raw[0].__emitterId).toBe('number')
  })
})

// ─── G-025: renderComponent passes hmrActions and components through ────────

import component from '../src/component.js'

describe('G-025: renderComponent honors .components and .hmrActions', () => {
  it('.components: a registered name renders that component', async () => {
    const Badge = component({ name: 'Badge', view: () => h('b', { className: 'badge' }, 'ok') })
    function Page() { return h('div', null, h('Badge')) }
    Page.components = { Badge }
    Page.initialState = {}
    t = renderComponent(Page)
    await t.ready()
    await settle()
    expect(t.html()).toMatch(/<b class="badge"[^>]*>ok<\/b>/)
  })

  it('.hmrActions is validated (SYG604) like under run()', () => {
    function C() { return h('div', null) }
    C.initialState = {}
    C.model = { X: s => s }
    C.hmrActions = 5
    expect(() => { t = renderComponent(C) }).toThrow(/SYG604/)
  })

  it('.hmrActions fire during an HMR update', async () => {
    const prevWindow = globalThis.window
    globalThis.window = { __SYGNAL_HMR_UPDATING: true }
    try {
      function C() { return h('div', null) }
      C.initialState = { refreshed: false }
      C.hmrActions = 'REFRESH'
      C.model = { REFRESH: s => ({ ...s, refreshed: true }) }
      t = renderComponent(C)
      await t.waitForState(s => s.refreshed === true, 500)
    } finally {
      globalThis.window = prevWindow
    }
  })
})

// ─── G-026: invalid Collection 'from' reports SYG412 once, with the name ────

describe("G-026: an invalid Collection 'from' reports SYG412 once", () => {
  function Item() { return h('li', null, 'x') }
  for (const [label, from] of [['a number', 5], ['an object without get()', { set: () => {} }]]) {
    it(`from = ${label}`, async () => {
      function Lists() { return h('ul', null, h(Collection, { of: Item, from })) }
      Lists.initialState = { items: [] }
      t = renderComponent(Lists)
      await t.ready()
      await settle()
      const d = t.diagnostics.filter(x => x.code === 'SYG412')
      expect(d.length).toBe(1)
      expect(d[0].component).toBe('Lists')
      expect(d[0].data).toEqual(from)
    })
  }
  it("from = null no longer crashes the render", async () => {
    function Lists() { return h('ul', null, h(Collection, { of: Item, from: null })) }
    Lists.initialState = { items: [] }
    t = renderComponent(Lists)
    await t.ready()
    await settle()
    expect(t.diagnostics.filter(x => x.code === 'SYG412').length).toBe(1)
  })
})

// ─── G-024: renderComponent reports SYG104 / SYG103 itself ──────────────────

describe('G-024: renderComponent reports isolation-boundary (SYG104) and typo (SYG103) selectors', () => {
  // eval task 07: the parent listens for '.remove', which only exists inside Collection items
  function TodoItem({ state }) {
    return h('div', { className: state.done ? 'todo done' : 'todo' },
      h('input', { className: 'toggle', attrs: { type: 'checkbox' }, checked: state.done }),
      h('span', { className: 'title' }, state.title),
      h('button', { className: 'remove', data: { id: String(state.id) } }, '×'))
  }
  TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.toggle') })
  TodoItem.model = { TOGGLE: s => ({ ...s, done: !s.done }) }

  const todos = () => [
    { id: 1, title: 'Buy milk', done: false },
    { id: 2, title: 'Walk the dog', done: false },
  ]

  function App({ state }) {
    return h('div', { className: 'app' },
      h(Collection, { of: TodoItem, from: 'todos', className: 'todo-list' }),
      h('p', { className: 'count' }, `${state.todos.length}`))
  }
  App.initialState = { todos: todos() }
  App.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove').data('id', Number) })
  App.model = { REMOVE: (s, id) => ({ ...s, todos: s.todos.filter(td => td.id !== id) }) }

  const only = (t, code) => t.diagnostics.filter(d => d.code === code)

  it('task-07 pattern: SYG104 names TodoItem after the first render, and expectNoDiagnostics throws with it', async () => {
    t = renderComponent(App)
    await t.ready()
    const d = only(t, 'SYG104')
    expect(d.length).toBe(1)
    expect(d[0].component).toBe('App')
    expect(d[0].data).toEqual({ selector: '.remove', child: 'TodoItem' })
    expect(d[0].text).toContain("DOM.select('.remove') in App matches elements inside TodoItem (isolated)")
    expect(d[0].text).toContain('Handle the event in TodoItem and send it up with PARENT (read it here with CHILD.select(TodoItem)), or use EVENTS')
    expect(() => t.expectNoDiagnostics()).toThrow(/SYG104.*TodoItem/)
    // clicking the child element does not duplicate it (and does nothing, as in the browser)
    t.simulateEvent('.remove', 'click')
    await settle()
    expect(only(t, 'SYG104').length).toBe(1)
    expect(last(t).todos.length).toBe(2)
  })

  it('SYG104 for a plain (non-Collection) child component that only renders after a state change', async () => {
    function Stepper({ state }) { return h('div', null, h('button', { className: 'inc' }, '+'), h('span', null, String(state.n))) }
    Stepper.isolatedState = true
    Stepper.initialState = { n: 0 }
    Stepper.model = { NOOP: s => s }
    function Page({ state }) { return h('div', null, h('h1', null, String(state.clicks)), state.show ? h(Stepper) : null) }
    Page.initialState = { clicks: 0, show: false }
    Page.intent = ({ DOM }) => ({ CLICK: DOM.select('.inc').events('click'), SHOW: DOM.click('h1') })
    Page.model = { CLICK: s => ({ ...s, clicks: s.clicks + 1 }), SHOW: s => ({ ...s, show: true }) }
    t = renderComponent(Page)
    await t.ready()
    expect(only(t, 'SYG104').length).toBe(0)
    t.simulateEvent('h1', 'click')
    await t.waitForState(s => s.show)
    t.simulateEvent('.inc', 'click')
    await settle()
    const d = only(t, 'SYG104')
    expect(d.length).toBe(1)
    expect(d[0].data).toEqual({ selector: '.inc', child: 'Stepper' })
  })

  it('no diagnostics for the correct version (child handles the click, parent reads CHILD)', async () => {
    function GoodItem({ state }) { return h('div', null, h('button', { className: 'remove' }, '×'), h('span', null, state.title)) }
    GoodItem.intent = ({ DOM }) => ({ REMOVE: DOM.click('.remove') })
    GoodItem.model = { REMOVE: { PARENT: s => s.id } }
    function GoodApp({ state }) { return h('div', null, h(Collection, { of: GoodItem, from: 'todos' })) }
    GoodApp.initialState = { todos: todos() }
    GoodApp.intent = ({ CHILD }) => ({ REMOVE: CHILD.select(GoodItem) })
    GoodApp.model = { REMOVE: (s, id) => ({ ...s, todos: s.todos.filter(td => td.id !== id) }) }
    t = renderComponent(GoodApp)
    await t.ready()
    t.simulateEvent('.remove', 'click')
    await t.waitForState(s => s.todos.length === 1)
    await settle()
    expect(t.diagnostics).toEqual([])
    t.expectNoDiagnostics()
  })

  it('SYG103 (info) when simulateEvent names a selector nothing renders (the event is dropped)', async () => {
    function Btn({ state }) { return h('div', null, h('button', { className: 'save' }, String(state.n))) }
    Btn.initialState = { n: 0 }
    Btn.intent = ({ DOM }) => ({ SAVE: DOM.click('.save'), LATER: DOM.click('.not-rendered-yet') })
    Btn.model = { SAVE: s => ({ ...s, n: s.n + 1 }), LATER: s => s }
    t = renderComponent(Btn)
    await t.ready()
    t.simulateEvent('.svae', 'click', { allowMissing: true }) // typo (G-070: without allowMissing this fails the test)
    // listened to but never rendered: 2E-2 (G-049) waits for it, then drops it with SYG103
    // instead of sending it to every listener with that selector string
    t.simulateEvent('.not-rendered-yet', 'click', { allowMissing: true })
    t.simulateEvent('.save', 'click')             // fine (delivered after the two above)
    await t.waitForState(s => s.n === 1)
    const d = only(t, 'SYG103')
    expect(d.length).toBe(2)
    expect(d.map(x => x.severity)).toEqual(['info', 'info'])
    expect(d.map(x => x.data)).toEqual([{ selector: '.svae', type: 'click' }, { selector: '.not-rendered-yet', type: 'click' }])
    expect(d[0].text).toContain(".svae")
    t.expectNoDiagnostics() // info only
  })

  it("nothing is reported with diagnostics: 'off'", async () => {
    t = renderComponent(App, { diagnostics: 'off' })
    await t.ready()
    t.simulateEvent('.nope', 'click', { allowMissing: true })
    await settle()
    expect(t.diagnostics).toEqual([])
  })
})

// ─── B-004: controlled value/checked follow the vnode after coalesced renders ─

describe('B-004: controlledInputModule', () => {
  const vn = (props, elm) => ({ data: { props }, elm })
  it('rewrites value/checked when the prop is unchanged but the live element differs', () => {
    const elm = { tagName: 'INPUT', value: 'typed', checked: true }
    controlledInputModule.update(vn({ value: '', checked: false }), vn({ value: '', checked: false }, elm))
    expect(elm).toEqual({ tagName: 'INPUT', value: '', checked: false })
  })
  it('leaves matching elements, absent props and changed props (propsModule handles those) alone', () => {
    const elm = { tagName: 'INPUT', value: '5', checked: false }
    let writes = 0
    const spy = new Proxy(elm, { set: (o, k, v) => { writes++; o[k] = v; return true } })
    controlledInputModule.update(vn({ value: 5 }), vn({ value: 5 }, spy))
    controlledInputModule.update(vn({}), vn({}, spy))
    controlledInputModule.update(vn({ value: 'a' }), vn({ value: 'b' }, spy))
    expect(writes).toBe(0)
  })

  it('D49: a present-but-nullish value keeps an input at "" (and nullish checked at false)', () => {
    const elm = { tagName: 'INPUT', value: 'typed', checked: true }
    controlledInputModule.update(vn({ value: null, checked: null }), vn({ value: null, checked: null }, elm))
    expect(elm.value).toBe('')
    expect(elm.checked).toBe(false)
    let writes = 0
    const spy = new Proxy(elm, { set: (o, k, v) => { writes++; o[k] = v; return true } })
    controlledInputModule.update(vn({ value: undefined }), vn({ value: undefined }, spy))
    expect(writes).toBe(0)
  })
})
