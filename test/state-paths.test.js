// State paths (6.5.0): state="a.b" / "a[0].b" on child components and Switchable, and Collection
// from="a.b". Reads, writes (only the levels on the path are copied), missing levels, arrays,
// calculated fields, isolatedState defaults, and SYG401 (the dev entry's) for a path.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { setupChecks } from './diagnostics/helpers.js'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { t?.dispose(); t = null })

function Rules({ state }) {
  return h('div', { className: 'rules' }, h('span', { className: 'count' }, String(state?.length ?? 'none')), h('button', { className: 'add' }, '+'))
}
Rules.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
Rules.model = { ADD: (state) => [...(state ?? []), `r${(state ?? []).length}`] }

const makeParent = (designator, initialState) => {
  function Parent({ state }) { return h('main', null, h(Rules, { state: designator })) }
  Parent.initialState = initialState
  return Parent
}

describe('reads and writes through a path', () => {
  it('state="settings.rules": the child reads the nested slice and writes it back, siblings kept', async () => {
    const theme = { dark: true }
    t = renderComponent(makeParent('settings.rules', { settings: { rules: ['a'], theme }, other: 1 }))
    await t.ready()
    expect(t.query('.count').textContent).toBe('1')
    t.simulateEvent('.add', 'click')
    await t.settle()
    expect(t.state).toEqual({ settings: { rules: ['a', 'r1'], theme: { dark: true } }, other: 1 })
    expect(t.state.settings.theme).toBe(theme) // untouched levels keep their identity
    expect(t.query('.count').textContent).toBe('2')
    t.expectNoDiagnostics()
  })

  it('a missing slice renders nothing, as with a plain key; an isolated child creates the missing levels', async () => {
    t = renderComponent(makeParent('settings.rules', { other: 1 }))
    await t.ready()
    expect(t.html()).toBe('<main></main>') // same as state="missing" today
    t.dispose()

    function Editor({ state }) { return h('p', null, h('span', { className: 'text' }, state.text), h('button', { className: 'edit' }, 'e')) }
    Editor.isolatedState = true
    Editor.initialState = { text: 'default' }
    Editor.intent = ({ DOM }) => ({ EDIT: DOM.click('.edit') })
    Editor.model = { EDIT: (state) => ({ ...state, text: 'edited' }) }
    function Parent() { return h('main', null, h(Editor, { state: 'docs.0.draft' })) }
    Parent.initialState = { other: 1 }
    t = renderComponent(Parent)
    await t.ready()
    expect(t.query('.text').textContent).toBe('default')
    t.simulateEvent('.edit', 'click')
    await t.settle()
    expect(t.state).toEqual({ other: 1, docs: { 0: { draft: { text: 'edited' } } } }) // a missing level is an object, even for '0'
  })

  it('array positions: "boards.1.rules" and "boards[1].rules" copy the array', async () => {
    for (const designator of ['boards.1.rules', 'boards[1].rules']) {
      const first = { rules: ['x'] }
      t = renderComponent(makeParent(designator, { boards: [first, { rules: [] }] }))
      await t.ready()
      t.simulateEvent('.add', 'click')
      await t.settle()
      expect(Array.isArray(t.state.boards)).toBe(true)
      expect(t.state.boards[1]).toEqual({ rules: ['r0'] })
      expect(t.state.boards[0]).toBe(first)
      t.dispose(); t = null
    }
  })

  it('a plain key is unchanged (one segment)', async () => {
    t = renderComponent(makeParent('rules', { rules: [] }))
    await t.ready()
    t.simulateEvent('.add', 'click')
    await t.settle()
    expect(t.state).toEqual({ rules: ['r0'] })
  })

  it('BEHAVIOUR CHANGE: a key that contains a dot is now a path; SYG428 says so', async () => {
    t = renderComponent(makeParent('a.b', { 'a.b': ['literal'] }))
    await t.ready()
    expect(t.html()).toBe('<main></main>') // 6.4 rendered the child with the literal key's 1 rule
    const d = t.diagnostics.find((x) => x.code === 'SYG428')
    expect(d?.severity).toBe('warn')
    expect(d.message).toMatch(/<Rules state="a\.b" is a path \(since 6\.5\.0\), read as \["a"\]\["b"\], but the state has a key named "a\.b"/)
    expect(d.fix).toMatch(/s\['a\.b'\]/)
  })

  it('no SYG428 for an ordinary path', async () => {
    t = renderComponent(makeParent('settings.rules', { settings: { rules: [] } }))
    await t.ready()
    expect(t.diagnostics.filter((x) => x.code === 'SYG428')).toEqual([])
  })
})

describe('calculated fields and isolatedState', () => {
  it('a path whose first segment is a calculated field: writes ignored (SYG409)', async () => {
    function Parent() { return h('main', null, h(Rules, { state: 'derived.rules' })) }
    Parent.initialState = { base: ['a'] }
    Parent.calculated = { derived: (s) => ({ rules: s.base }) }
    t = renderComponent(Parent)
    await t.ready()
    expect(t.query('.count').textContent).toBe('1')
    t.simulateEvent('.add', 'click')
    await t.settle()
    expect(t.state.base).toEqual(['a'])
    expect(t.diagnostics.map((d) => d.code)).toContain('SYG409')
  })

  it("an isolated child's initialState is used while the nested slice is undefined", async () => {
    function Editor({ state }) { return h('p', { className: 'text' }, state.text) }
    Editor.isolatedState = true
    Editor.initialState = { text: 'default' }
    function Parent() { return h('main', null, h(Editor, { state: 'docs.draft' })) }
    Parent.initialState = { docs: {} }
    t = renderComponent(Parent)
    await t.ready()
    expect(t.query('.text').textContent).toBe('default')
  })
})

describe('Collection from a path', () => {
  function Card({ state }) { return h('li', { className: 'card' }, h('span', null, state.title), h('button', { className: 'done' }, 'x')) }
  Card.intent = ({ DOM }) => ({ DONE: DOM.click('.done') })
  Card.model = { DONE: (state) => ({ ...state, title: state.title + '!' }) }

  it('from="board.cards" renders the nested array, item writes reach it, no SYG401', async () => {
    function Board() { return h('ul', null, h(Collection, { of: Card, from: 'board.cards' })) }
    Board.initialState = { board: { name: 'B', cards: [{ id: 1, title: 'one' }, { id: 2, title: 'two' }] } }
    t = renderComponent(Board)
    await t.ready()
    expect(t.queryAll('.card span').map((s) => s.textContent)).toEqual(['one', 'two'])
    t.simulateEvent('.card:nth-child(2) .done', 'click')
    await t.settle()
    expect(t.state.board).toEqual({ name: 'B', cards: [{ id: 1, title: 'one' }, { id: 2, title: 'two!' }] })
    expect(t.diagnostics.filter((d) => d.code === 'SYG401')).toEqual([])
  })

  it("SYG428 for a Collection from=\"a.b\" when the state has the literal key", async () => {
    function Board() { return h('ul', null, h(Collection, { of: Card, from: 'old.cards' })) }
    Board.initialState = { 'old.cards': [{ id: 1, title: 'one' }] }
    t = renderComponent(Board)
    await t.ready()
    expect(t.diagnostics.find((x) => x.code === 'SYG428')?.message).toMatch(/<Collection from="old\.cards" is a path/)
  })

  it('a Switchable state path whose first segment is a calculated field: SYG409 on write', async () => {
    const { Switchable } = await import('../src/index.js')
    function Parent() { return h('main', null, h(Switchable, { of: { r: Rules }, current: 'r', state: 'derived.rules' })) }
    Parent.initialState = { base: ['a'] }
    Parent.calculated = { derived: (s) => ({ rules: s.base }) }
    t = renderComponent(Parent)
    await t.ready()
    expect(t.query('.count').textContent).toBe('1')
    t.simulateEvent('.add', 'click')
    await t.settle()
    expect(t.state.base).toEqual(['a'])
    expect(t.diagnostics.map((d) => d.code)).toContain('SYG409')
  })

  it('SYG401 (the dev entry) for a missing plain key, as the core reported it before 6.5.0', async () => {
    function List() { return h('ul', null, h(Collection, { of: Card, from: 'rows' })) }
    List.initialState = { items: [] }
    t = renderComponent(List)
    await t.ready()
    expect(t.diagnostics.find((x) => x.code === 'SYG401')?.message).toBe(`Collection from="rows" is not in state (array fields: 'items'); it renders nothing until it exists`)
  })

  it('SYG401 names the path when its last field is missing or not an array', async () => {
    function Board() { return h('ul', null, h(Collection, { of: Card, from: 'board.crads' })) }
    Board.initialState = { board: { cards: [] } }
    t = renderComponent(Board)
    await t.ready()
    const d = t.diagnostics.find((x) => x.code === 'SYG401')
    expect(d?.message).toMatch(/from="board\.crads" is not in state \(array fields: 'cards'\)/)
  })
})
