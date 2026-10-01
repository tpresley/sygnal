// SYG401 — Collection `from` field missing or not an array
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupChecks, diagnostics, settle } from './helpers.js'
import { renderComponent } from '../../src/extra/testing.js'
import { createElement } from '../../src/pragma/index.js'
import { Collection } from '../../src/collection.js'

let t
beforeEach(() => setupChecks())
afterEach(() => { if (t) t.dispose(); t = null; vi.restoreAllMocks() })

function Item({ state }) { return createElement('li', null, String(state.title)) }

function listOf(from, initialState) {
  function List() { return createElement('ul', null, createElement(Collection, { of: Item, from })) }
  List.initialState = initialState
  return List
}

describe('SYG401 — Collection from field', () => {
  it('reports a from field that does not exist in state, listing the array fields', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // existing console output
    t = renderComponent(listOf('todo', { todos: [{ id: 1, title: 'a' }] }))
    await settle(120)
    // Reported once, by the core (1E retrofit), with the available array fields
    const found = diagnostics('SYG401')
    expect(found).toHaveLength(1)
    expect(found[0].severity).toBe('error')
    expect(found[0].component).toBe('List')
    expect(found[0].message).toContain(`from="todo"`)
    expect(found[0].message).toContain(`'todos'`)
  })

  it('reports a from field that is not an array', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}) // existing console output
    t = renderComponent(listOf('todos', { todos: { 1: { title: 'a' } } }))
    await settle(120)
    const found = diagnostics('SYG401')
    expect(found).toHaveLength(1)
    expect(found[0].message).toContain("'todos' is not an array")
  })

  it('does not report an array field (including an empty one) or a lens returning an array', async () => {
    t = renderComponent(listOf('todos', { todos: [{ id: 1, title: 'a' }] }))
    await settle(80)
    t.dispose()
    t = renderComponent(listOf('todos', { todos: [] }))
    await settle(80)
    t.dispose()
    t = renderComponent(listOf({ get: s => s.items, set: (s, items) => ({ ...s, items }) }, { items: [] }))
    await settle(80)
    expect(diagnostics('SYG401')).toEqual([])
  })
})
