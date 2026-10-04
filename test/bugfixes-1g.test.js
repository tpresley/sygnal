// Regression tests for PLAN-1 workstream 1G (rendering/state bug fixes).
import { describe, it, expect, afterEach } from 'vitest'
import xs from 'xstream'
import { readFileSync } from 'node:fs'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { pickCombine } from '../src/cycle/state/pickCombine.js'
import { createElement as h } from '../src/pragma/index.js'
import { renderComponent } from '../src/extra/testing.js'
import { Collection } from '../src/collection.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

const settle = (ms = 40) => new Promise(r => setTimeout(r, ms))
const last = t => t.states[t.states.length - 1]

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
})

// ─── B-010: pickCombine re-emits on a pure reorder ───────────────────────────

describe('B-010: pickCombine follows a permutation of the instances', () => {
  const item = (key) => ({ _key: key, DOM: xs.of(key).remember() })
  const inst = (items) => ({ dict: new Map(items.map(i => [i._key, i])), arr: items })

  it('emits the new order for swap, reverse and move without any item emission', () => {
    const a = item('a'), b = item('b'), c = item('c')
    const inst$ = xs.create()
    const out = []
    inst$.compose(pickCombine('DOM')).addListener({ next: v => out.push(v.join('')) })
    inst$.shamefullySendNext(inst([a, b, c]))
    inst$.shamefullySendNext(inst([b, a, c]))   // swap
    inst$.shamefullySendNext(inst([c, a, b]))   // reverse
    inst$.shamefullySendNext(inst([a, b, c]))   // move c to the end
    expect(out[out.length - 1]).toBe('abc')
    expect(out).toContain('bac')
    expect(out).toContain('cab')
  })

  it('does not re-emit when the order is unchanged', () => {
    const a = item('a'), b = item('b')
    const inst$ = xs.create()
    const out = []
    inst$.compose(pickCombine('DOM')).addListener({ next: v => out.push(v.join('')) })
    inst$.shamefullySendNext(inst([a, b]))
    const n = out.length
    inst$.shamefullySendNext(inst([a, b]))
    expect(out.length).toBe(n)
  })

  it('reorders the survivors after a removal in the same update', async () => {
    const a = item('a'), b = item('b'), c = item('c')
    const inst$ = xs.create()
    const out = []
    inst$.compose(pickCombine('DOM')).addListener({ next: v => out.push(v.join('')) })
    inst$.shamefullySendNext(inst([a, b, c]))
    inst$.shamefullySendNext(inst([c, a]))
    // G-213: a removal is emitted a task later
    await new Promise(r => setTimeout(r, 5))
    expect(out[out.length - 1]).toBe('ca')
  })
})

// ─── B-011: JSX vnodes are always snabbdom-valid ─────────────────────────────

describe('B-011: an element with a single text child', () => {
  it('has text and no children (like snabbdom h)', () => {
    const v = h('p', null, 'Select a task.')
    expect(v.text).toBe('Select a task.')
    expect(v.children).toBeUndefined()
  })

  it('with several children has a children array and no text', () => {
    const v = h('p', null, 'Status: ', 'Open')
    expect(v.text).toBeUndefined()
    expect(Array.isArray(v.children)).toBe(true)
    expect(v.children.map(c => c.text)).toEqual(['Status: ', 'Open'])
  })

  it('passed to a component keeps the text as a children array', () => {
    function Box({ children }) { return h('div', null, children) }
    const v = h(Box, null, 'hello')
    expect(Array.isArray(v.children)).toBe(true)
    expect(v.children[0].text).toBe('hello')
  })

  it('inside a preventInstantiation component (Suspense/Portal/...) is a children array', () => {
    function Marker() {}
    Marker.preventInstantiation = true
    const v = h(Marker, null, 'hi')
    expect(Array.isArray(v.children)).toBe(true)
    expect(v.children[0].text).toBe('hi')
  })
})

// ─── G-028: renderComponent renders a stateless, model-less component ────────

describe('G-028: renderComponent with no initialState and no model', () => {
  it('renders and resolves ready(), as run() would', async () => {
    function Hello() { return h('h1', { className: 'title' }, 'Hello') }
    t = renderComponent(Hello)
    const winner = await Promise.race([t.ready().then(() => 'ready'), settle(500).then(() => 'timeout')])
    expect(winner).toBe('ready')
    expect(t.html()).toContain('Hello')
  })

  it('renders static children too', async () => {
    function Child() { return h('p', { className: 'c' }, 'child') }
    function Page() { return h('main', null, h(Child)) }
    t = renderComponent(Page)
    const winner = await Promise.race([t.ready().then(() => 'ready'), settle(500).then(() => 'timeout')])
    expect(winner).toBe('ready')
    expect(t.html()).toContain('child')
  })
})

// ─── B-013: same-tick actions inside a Collection item compose ───────────────

describe('B-013: Collection item reducers see the state of earlier same-tick actions', () => {
  function Editor({ state }) {
    return h('li', null,
      h('input', { className: 'draft', value: state.draft }),
      h('button', { className: 'save' }, 'Save'),
      h('span', { className: 'len' }, String(state.len)))
  }
  Editor.intent = ({ DOM }) => ({ EDIT: DOM.input('.draft').value(), SAVE: DOM.click('.save') })
  Editor.calculated = { len: s => s.draft.length }
  Editor.model = {
    EDIT: (s, draft) => ({ ...s, draft }),
    SAVE: {
      STATE: s => ({ ...s, saved: s.draft, savedLen: s.len }),
      EVENTS: s => ({ type: 'SAVED', data: s.draft }),
    },
  }

  function App() { return h('ul', null, h(Collection, { of: Editor, from: 'items' })) }
  App.initialState = { items: [{ id: 1, draft: '', saved: '' }] }

  it('EDIT then SAVE in one tick: SAVE starts from the edited draft', async () => {
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'hello' })
    t.simulateEvent('.save', 'click')
    await settle(80)
    const item = last(t).items[0]
    expect(item.draft).toBe('hello')
    expect(item.saved).toBe('hello')
  })

  it('the item calculated field is computed from the fresh state', async () => {
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'abc' })
    t.simulateEvent('.save', 'click')
    await settle(80)
    expect(last(t).items[0].savedLen).toBe(3)
  })

  it('non-STATE sinks of the item see the same snapshot (B-003 for items)', async () => {
    t = renderComponent(App)
    await t.ready()
    t.simulateEvent('.draft', 'input', { value: 'hey' })
    t.simulateEvent('.save', 'click')
    await settle(80)
    expect(t.emitted).toEqual([{ type: 'SAVED', data: 'hey' }])
  })

  it('three same-tick increments in one item all land', async () => {
    function Counter({ state }) { return h('li', null, h('button', { className: 'inc' }, String(state.n))) }
    Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
    Counter.model = { INC: s => ({ ...s, n: s.n + 1 }) }
    function Counters() { return h('ul', null, h(Collection, { of: Counter, from: 'items' })) }
    Counters.initialState = { items: [{ id: 'a', n: 0 }, { id: 'b', n: 0 }] }
    t = renderComponent(Counters)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.inc', 'click')
    await settle(80)
    expect(last(t).items).toEqual([{ id: 'a', n: 3 }, { id: 'b', n: 0 }])
  })

  it('a Collection over a parent calculated field still hands items their state', async () => {
    const seen = []
    function Row({ state }) { return h('li', null, h('button', { className: 'look' }, state.label)) }
    Row.intent = ({ DOM }) => ({ LOOK: DOM.click('.look') })
    Row.model = { LOOK: s => { seen.push(s && s.label); return s } }
    function List() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    List.initialState = { names: ['x'] }
    List.calculated = { rows: s => s.names.map((n, i) => ({ id: i + 1, label: n.toUpperCase() })) }
    t = renderComponent(List)
    await t.ready()
    t.simulateEvent('.look', 'click')
    await settle(80)
    expect(seen).toEqual(['X'])
  })
})

// ─── G-018: extracting markup into a child component doesn't change the DOM ──

describe('G-018: data-sygnal-ready only marks children that are not ready', () => {
  it('a ready child (no READY entries) renders without the attribute', async () => {
    function Stars({ state }) { return h('span', { className: 'stars' }, String(state.n)) }
    function App() { return h('div', null, h(Stars)) }
    App.initialState = { n: 3 }
    t = renderComponent(App)
    await t.ready()
    await settle()
    expect(t.html()).toContain('<span class="stars">3</span>')
    expect(t.html()).not.toContain('data-sygnal-ready')
  })

  it('a child with an explicit READY entry is marked not ready until it signals', async () => {
    function Loader({ state }) { return h('span', { className: 'loader' }, state.done ? 'done' : 'wait') }
    Loader.model = { LOADED: { STATE: s => ({ ...s, done: true }), READY: () => true } }
    function App() { return h('div', null, h(Loader)) }
    App.initialState = { done: false }
    t = renderComponent(App)
    await t.ready()
    await settle()
    expect(t.html()).toContain('data-sygnal-ready="false"')
  })
})

// ─── 1F leftover: SYG104 wording is the same in renderComponent and the runtime check ─

describe('SYG104 wording', () => {
  // The runtime check (needs a real DOM) and renderComponent's mock-DOM version must
  // show users the same message and fix. Compare the two template literals.
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')
  const texts = (code, at) => {
    const i = code.indexOf(at)
    const lits = code.slice(i, i + 1200).match(/`[^`]*`/g).slice(0, 2)
    return lits.map(l => l.replace(/\$\{t\.name\}/g, '${name}').replace(/\$\{childName\}/g, '${child}'))
  }
  it('message and fix match', () => {
    const fromTesting = texts(src('extra/testing.ts'), "raise('SYG104'")
    const fromCheck = texts(src('extra/diagnostics/checks/dom.ts'), "reportSafely('SYG104'")
    expect(fromTesting).toHaveLength(2)
    expect(fromTesting).toEqual(fromCheck)
  })
})
