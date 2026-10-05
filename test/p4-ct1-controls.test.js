// @vitest-environment jsdom
// PLAN-4 CT-1: controls(spec), element tokens that link a view to its intent by identifier.
// A control renders its element with data-control="<Key>" and is accepted wherever a selector
// is (DOM.select, DOM.<event>, simulateEvent, query, queryAll), in the mock and the real DOM.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { jsx } from '../src/jsx-runtime.js'
import { Collection } from '../src/collection.js'
import { ABORT } from '../src/shared.js'
import { controls } from '../src/extra/controls.js'
import { renderToString } from '../src/extra/ssr.js'
import run from '../src/extra/run.js'
import { mockDOMSource } from '../src/cycle/dom/mockDOMSource.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  if (t) t.dispose()
  t = null
  _resetDiagnostics()
  vi.unstubAllGlobals()
})
const settle = (ms = 30) => new Promise(r => setTimeout(r, ms))

// ─── controls() itself ──────────────────────────────────────────────────────

describe('controls()', () => {
  const { Add, Draft } = controls({ Add: 'button', Draft: 'input' })

  it('returns one control per key; a control stringifies to its selector', () => {
    expect(String(Add)).toBe('[data-control="Add"]')
    expect(`li ${Draft}`).toBe('li [data-control="Draft"]')
    expect(typeof Add).toBe('function')
  })

  it('keeps its kind and spec', () => {
    const spec = { kind: 'test', vnode: (p, c, hh) => hh('span', p, ...c) }
    const { Fancy } = controls({ Fancy: spec })
    expect(Add.kind).toBe('element')
    expect(Add.spec).toBe('button')
    expect(Fancy.kind).toBe('test')
    expect(Fancy.spec).toBe(spec)
  })

  it('renders the intrinsic element with every prop plus data-control merged into attrs', () => {
    const attrs = { title: 'Add it' }
    const v = h(Add, { className: 'primary', attrs, key: 'k' }, 'Add')
    expect(v.sel).toBe('button')
    expect(v.key).toBe('k')
    expect(v.text).toBe('Add')
    expect(v.data.props.className).toBe('primary')
    expect(v.data.attrs).toEqual({ title: 'Add it', 'data-control': 'Add' })
    expect(attrs).toEqual({ title: 'Add it' })            // the caller's object is not changed
  })

  it('is not a component: no instantiation options, no isolation, no wrapper', () => {
    const v = h(Add, null, 'x')
    expect(v.sel).toBe('button')
    expect(v.data.c).toBeUndefined()
  })

  it('works through the automatic JSX runtime (key and children)', () => {
    const v = jsx(Draft, { className: 'field', value: 'x' }, 'k1')
    expect(v.sel).toBe('input')
    expect(v.key).toBe('k1')
    expect(v.data.attrs['data-control']).toBe('Draft')
    const b = jsx(Add, { children: ['A', 'dd'] })
    expect(b.children.map(c => c.text)).toEqual(['A', 'dd'])
  })

  it('a spec object renders through vnode(props, children, h), gets the stamp, keeps key and hooks', () => {
    let got
    const insert = () => {}
    const spec = {
      kind: 'test',
      vnode(props, children, hh) {
        got = { props, children, hh }
        const { key, ...rest } = props
        return hh('span', { ...rest, className: 'fancy', attrs: { role: 'button' }, hook: { insert } }, ...children)
      },
    }
    const { Fancy } = controls({ Fancy: spec })
    const v = h(Fancy, { key: 'f1', title: 'T' }, 'x', 'y')
    expect(got.hh).toBe(h)                                  // the pragma's own createElement (D116)
    expect(got.children).toEqual(['x', 'y'])
    expect(got.props.title).toBe('T')
    expect(v.sel).toBe('span')
    expect(v.key).toBe('f1')                                // copied when the vnode has none (D116)
    expect(v.data.attrs).toEqual({ role: 'button', 'data-control': 'Fancy' })
    expect(v.data.hook.insert).toBe(insert)
    expect(v.data.props.className).toBe('fancy')
  })

  it("a spec object's own vnode key is kept", () => {
    const { Keyed } = controls({ Keyed: { kind: 'test', vnode: (p, c, hh) => hh('i', { key: 'own' }) } })
    expect(h(Keyed, { key: 'outer' }).key).toBe('own')
    const { Unkeyed } = controls({ Unkeyed: { kind: 'test', vnode: (p, c, hh) => hh('i', null) } })
    expect(h(Unkeyed, null).key).toBeUndefined()
    expect(h(Unkeyed, null).data.attrs).toEqual({ 'data-control': 'Unkeyed' })
  })
})

// ─── X5: the todo scenario, with no `.sel` workaround ───────────────────────

const { Draft, Add } = controls({ Draft: 'input', Add: 'button' })
const { Done, Remove } = controls({ Done: 'button', Remove: 'button' })

function Item({ state }) {
  return h('li', { className: state.done ? 'item done' : 'item', 'data-id': String(state.id) },
    state.text, ' ', h(Done, null, '✓'), ' ', h(Remove, { className: 'danger' }, 'x'))
}
Item.intent = ({ DOM }) => ({ DONE: DOM.click(Done), REMOVE: DOM.click(Remove) })
Item.model = { DONE: (s) => ({ ...s, done: true }), REMOVE: () => undefined }

function Todos({ state }) {
  return h('div', { className: 'todos' },
    h(Draft, { className: 'field', value: state.draft, placeholder: 'New task' }),
    h(Add, null, 'Add'),
    h('ul', null, h(Collection, { of: Item, from: 'todos' })))
}
Todos.initialState = { draft: '', nextId: 1, todos: [] }
Todos.intent = ({ DOM }) => ({ DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add) })
Todos.model = {
  DRAFT: (s, draft) => ({ ...s, draft }),
  ADD: (s) => (s.draft.trim() ? { ...s, draft: '', nextId: s.nextId + 1, todos: [...s.todos, { id: s.nextId, text: s.draft, done: false }] } : ABORT),
}

for (const dom of ['mock', 'real']) {
  describe(`X5 scenario (${dom} DOM)`, () => {
    const opts = dom === 'real' ? { dom: 'real' } : {}

    it('controls as JSX tags: intent, simulateEvent, query, queryAll, template strings', async () => {
      t = renderComponent(Todos, opts)
      await t.ready()
      t.simulateEvent(Draft, 'input', { value: 'Milk' }); await t.next(s => s.draft === 'Milk')
      expect(t.query(Draft).value).toBe('Milk')
      t.simulateEvent(Add, 'click'); await t.next(s => s.todos.length === 1)
      t.simulateEvent(Draft, 'input', { value: 'Eggs' }); await t.next(s => s.draft === 'Eggs')
      t.simulateEvent(Add, 'click'); await t.next(s => s.todos.length === 2)
      expect(t.queryAll(Done)).toHaveLength(2)
      t.simulateEvent(`li:nth-child(2) ${Done}`, 'click'); await t.next(s => s.todos[1].done)
      expect(t.state.todos[0].done).toBe(false)
      t.simulateEvent(`li:first-child ${Remove}`, 'click'); await t.next(s => s.todos.length === 1)
      expect(t.state.todos[0].text).toBe('Eggs')
      expect(t.html()).toContain('data-control="Remove"')
      t.expectNoDiagnostics()
    })

    it('simulateEvent { within } scopes to one Collection item (selector or control), and is not copied onto the event', async () => {
      t = renderComponent(Todos, { ...opts, initialState: { draft: '', nextId: 4, todos: [1, 2, 3].map(id => ({ id, text: 't' + id, done: false })) } })
      await t.ready()
      t.simulateEvent(Done, 'click', { within: '[data-id="2"]' }); await t.next(s => s.todos[1].done)
      expect(t.state.todos.map(x => x.done)).toEqual([false, true, false])
      t.simulateEvent(Remove, 'click', { within: '[data-id="3"]' }); await t.next(s => s.todos.length === 2)
      expect(t.state.todos.map(x => x.id)).toEqual([1, 2])
    })

    it('within is not copied onto the event; other init props are', async () => {
      const { Hit } = controls({ Hit: 'button' })
      function Box() { return h('div', null, h('p', { className: 'a' }, h(Hit, null, 'a')), h('p', { className: 'b' }, h(Hit, null, 'b'))) }
      Box.initialState = { seen: null }
      Box.intent = ({ DOM }) => ({ HIT: DOM.click(Hit).map(e => ({ within: 'within' in e, text: e.target.textContent ?? null, extra: e.extra })) })
      Box.model = { HIT: (s, seen) => ({ ...s, seen }) }
      t = renderComponent(Box, opts)
      await t.ready()
      t.simulateEvent(Hit, 'click', { within: '.b', extra: 1 }); await t.next(s => s.seen)
      expect(t.state.seen.within).toBe(false)
      expect(t.state.seen.extra).toBe(1)
      if (dom === 'real') expect(t.state.seen.text).toBe('b')
    })

    it('a Collection item control matches only that item (isolation is unchanged)', async () => {
      t = renderComponent(Todos, { ...opts, initialState: { draft: '', nextId: 3, todos: [1, 2].map(id => ({ id, text: 't' + id, done: false })) } })
      await t.ready()
      t.simulateEvent(Done, 'click'); await t.next(s => s.todos[0].done)
      await settle()
      expect(t.state.todos.map(x => x.done)).toEqual([true, false])
    })
  })
}

// ─── A nested child using the same key names ───────────────────────────────

const Inner = controls({ Add: 'button' })
function Child({ state }) {
  return h('div', { className: 'child' }, h(Inner.Add, null, 'child add'), h('span', null, String(state.n)))
}
Child.intent = ({ DOM }) => ({ ADD: DOM.click(Inner.Add) })
Child.model = { ADD: (s) => ({ ...s, n: s.n + 1 }) }
function Parent({ state }) {
  return h('div', null, h(Add, null, 'parent add'), h(Child, { state: 'child' }))
}
Parent.initialState = { parentN: 0, child: { n: 0 } }
Parent.intent = ({ DOM }) => ({ ADD: DOM.click(Add) })
Parent.model = { ADD: (s) => ({ ...s, parentN: s.parentN + 1 }) }

for (const dom of ['mock', 'real']) {
  it(`a nested child with the same control keys: each hears only its own (${dom} DOM)`, async () => {
    t = renderComponent(Parent, dom === 'real' ? { dom: 'real' } : {})
    await t.ready()
    t.simulateEvent(Add, 'click'); await t.next(s => s.parentN === 1)
    await settle()
    expect(t.state.child.n).toBe(0)
    t.simulateEvent(Inner.Add, 'click', { within: '.child' }); await t.next(s => s.child.n === 1)
    await settle()
    expect(t.state.parentN).toBe(1)
  })
}

// ─── Test-only spec object through the whole pipeline ───────────────────────

let inserted = 0
const fancySpec = {
  kind: 'test',
  vnode: ({ key, ...props }, children, hh) => hh('span', { ...props, className: 'fancy', hook: { insert: () => inserted++ } }, ...children),
}
const { Fancy } = controls({ Fancy: fancySpec })
function WithFancy({ state }) { return h('div', null, h(Fancy, { key: 'f' }, 'fancy ' + state.n)) }
WithFancy.initialState = { n: 0, sel: 0 }
WithFancy.intent = ({ DOM }) => ({ HIT: DOM.click(Fancy), SEL: DOM.select(Fancy).events('click') })
WithFancy.model = { HIT: (s) => ({ ...s, n: s.n + 1 }), SEL: (s) => ({ ...s, sel: s.sel + 1 }) }

for (const dom of ['mock', 'real']) {
  it(`a spec-object control is accepted by DOM.*, simulateEvent and query (${dom} DOM)`, async () => {
    inserted = 0
    t = renderComponent(WithFancy, dom === 'real' ? { dom: 'real' } : {})
    await t.ready()
    t.simulateEvent(Fancy, 'click'); await t.next(s => s.n === 1 && s.sel === 1)
    expect(t.html()).toContain('data-control="Fancy"')
    expect(t.query(Fancy)).toBeTruthy()
    expect(t.queryAll(Fancy)).toHaveLength(1)
    if (dom === 'real') {
      expect(inserted).toBe(1)
      expect(t.query(Fancy).className).toBe('fancy')
    }
  })
}

// ─── DOM source acceptance (real DOM) ───────────────────────────────────────

describe('DOM source acceptance', () => {
  it("DOM.select('.x').select(control) and DOM.select('document').select(control)", async () => {
    const { Go } = controls({ Go: 'button' })
    function Page({ state }) { return h('div', { className: 'bar' }, h(Go, null, 'go'), h('i', null, `${state.a} ${state.b}`)) }
    Page.initialState = { a: 0, b: 0 }
    Page.intent = ({ DOM }) => ({
      A: DOM.select('.bar').select(Go).events('click'),
      B: DOM.select('document').select(Go).events('click'),
    })
    Page.model = { A: (s) => ({ ...s, a: s.a + 1 }), B: (s) => ({ ...s, b: s.b + 1 }) }
    t = renderComponent(Page, { dom: 'real' })
    await t.ready()
    t.query(Go).click()
    await t.next(s => s.a === 1 && s.b === 1)
  })

  it("MainDOMSource.select still rejects what is neither a string nor a control", async () => {
    const { Go } = controls({ Go: 'button' })
    let err, ok
    function Page() { return h('div', null, h(Go, null, 'go')) }
    Page.initialState = {}
    Page.intent = ({ DOM }) => {
      ok = DOM.select(Go)
      try { DOM.select(Page) } catch (e) { err = e }
      return {}
    }
    t = renderComponent(Page, { dom: 'real' })
    await t.ready()
    expect(ok).toBeTruthy()
    expect(err?.message).toMatch(/expects the argument to be a string/)
  })

  it('the mock DOM source selects a control by its selector, and rejects a component', () => {
    const { Go } = controls({ Go: 'button' })
    const src = mockDOMSource({ '[data-control="Go"]': { click: 'mocked' } })
    expect(src.select(Go)._path).toEqual(['[data-control="Go"]'])
    function Comp() { return h('div') }
    expect(() => src.select(Comp)).toThrow(/expects the argument to be a string/)
  })
})

// ─── SSR + hydration ────────────────────────────────────────────────────────

describe('SSR and hydration', () => {
  it('renderToString and the client render produce the same data-control markup', async () => {
    const state = { draft: 'x', nextId: 3, todos: [1, 2].map(id => ({ id, text: 't' + id, done: false })) }
    const html = renderToString(Todos, { state })
    const markers = (s) => [...s.matchAll(/data-control="(\w+)"/g)].map(m => m[1])
    expect(markers(html)).toEqual(['Draft', 'Add', 'Done', 'Remove', 'Done', 'Remove'])
    t = renderComponent(Todos, { dom: 'real', initialState: state })
    await t.ready()
    expect(markers(t.container.innerHTML)).toEqual(markers(html))
  })

  it('an app run over server markup (hydration) listens to its controls', async () => {
    const state = { draft: '', nextId: 2, todos: [{ id: 1, text: 'a', done: false }] }
    document.body.innerHTML = `<div id="ssr-root">${renderToString(Todos, { state })}</div>`
    const Hydrated = (a) => Todos(a)
    Object.assign(Hydrated, { intent: Todos.intent, model: Todos.model, initialState: state })
    const app = run(Hydrated, {}, { mountPoint: '#ssr-root' })
    try {
      await settle(60)
      document.querySelector(`#ssr-root ${Done}`).click()
      await settle(60)
      expect(document.querySelector('#ssr-root li').className).toContain('done')
    } finally {
      app.dispose()
      document.body.innerHTML = ''
    }
  })
})

// ─── HMR ────────────────────────────────────────────────────────────────────

it('HMR: a hot-swapped module (a new controls() call, same keys) keeps working, state kept', async () => {
  const make = (label) => {
    const { Inc } = controls({ Inc: 'button' })
    function Counter({ state }) { return h('div', null, h(Inc, null, label), h('span', { className: 'n' }, String(state.n))) }
    Counter.initialState = { n: 0 }
    Counter.intent = ({ DOM }) => ({ INC: DOM.click(Inc) })
    Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }
    return { Counter, Inc }
  }
  const v1 = make('v1'), v2 = make('v2')
  document.body.innerHTML = '<div id="hmr-root"></div>'
  const app = run(v1.Counter, {}, { mountPoint: '#hmr-root' })
  try {
    await settle(50)
    document.querySelector(String(v1.Inc)).click()
    await settle(50)
    expect(document.querySelector('.n').textContent).toBe('1')
    app.hmr(v2.Counter)
    await settle(120)
    expect(document.querySelector(String(v2.Inc)).textContent).toBe('v2')
    expect(document.querySelector('.n').textContent).toBe('1')
    document.querySelector(String(v2.Inc)).click()
    await settle(50)
    expect(document.querySelector('.n').textContent).toBe('2')
  } finally {
    app.dispose()
    document.body.innerHTML = ''
    delete window.__SYGNAL_HMR_UPDATING
  }
})
