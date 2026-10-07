import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const names = () => t.queryAll('li.item .name').map((el) => el.textContent)
const row = (id) => `li.item[data-id="${id}"]`
const isLowRow = (id) => t.query(row(id)).classList.contains('low')

describe('pantry', () => {
  it('shows the summary and marks low items', async () => {
    t = renderComponent(App, { strict: true })
    await t.ready()
    expect(t.query('.summary').textContent).toBe('6 items · 2 low')
    expect(names()).toEqual(['Black beans', 'Canned tomatoes', 'Coffee', 'Olive oil', 'Pasta', 'Rice'])
    expect(isLowRow(3)).toBe(true) // Pasta 0 / 2
    expect(isLowRow(5)).toBe(true) // Coffee 1 / 2
    expect(isLowRow(2)).toBe(false) // Olive oil 1 / 1
    expect(isLowRow(6)).toBe(false) // Black beans 3 / 3
    t.expectNoDiagnostics()
  })

  it('plus and minus change a quantity and the low count', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent(`${row(5)} .inc`, 'click')
    await t.next((s) => s.items.find((i) => i.id === 5).qty === 2)
    expect(t.query(`${row(5)} .qty`).textContent).toBe('2')
    expect(isLowRow(5)).toBe(false)
    expect(t.query('.summary').textContent).toBe('6 items · 1 low')

    t.simulateEvent(`${row(2)} .dec`, 'click')
    await t.next((s) => s.items.find((i) => i.id === 2).qty === 0)
    expect(isLowRow(2)).toBe(true)
    expect(t.query('.summary').textContent).toBe('6 items · 2 low')
  })

  it('minus is disabled at zero', async () => {
    t = renderComponent(App, { strict: true })
    await t.ready()
    expect(t.query(`${row(3)} .dec`).disabled).toBe(true)
    expect(t.query(`${row(1)} .dec`).disabled).toBe(false)
  })

  it('removes an item', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent(`${row(5)} .remove`, 'click')
    await t.next((s) => s.items.length === 5)
    expect(names()).not.toContain('Coffee')
    expect(t.query('.summary').textContent).toBe('5 items · 1 low')
  })

  it('adds a new item with quantity 1 and minimum 1', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.new-item', 'input', { value: '  Flour ' })
    t.simulateEvent('.add', 'click')
    await t.next((s) => s.items.length === 7)
    expect(t.state.items.at(-1)).toMatchObject({ name: 'Flour', qty: 1, min: 1 })
    expect(names()).toContain('Flour')
    expect(t.state.draft).toBe('')
    expect(t.query('.summary').textContent).toBe('7 items · 2 low')
  })

  it('adds with the Enter key', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.new-item', 'input', { value: 'Salt' })
    t.simulateEvent('.new-item', 'keydown', { key: 'Enter' })
    await t.next((s) => s.items.length === 7)
    expect(names()).toContain('Salt')
  })

  it('undoes the last removal', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent(`${row(4)} .remove`, 'click')
    await t.next((s) => s.items.length === 5)
    expect(t.query('.notice').textContent).toContain('Removed Canned tomatoes.')
    t.simulateEvent('.undo', 'click')
    await t.next((s) => s.items.length === 6)
    expect(t.state.items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6])
    expect(t.query('.notice')).toBeNull()
  })

  it('ignores a blank name', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.new-item', 'input', { value: '   ' })
    t.simulateEvent('.add', 'click')
    await t.settle()
    expect(t.state.items).toHaveLength(6)
    expect(t.query('.error')).toBeNull()
  })

  it('refuses a name that is already in the pantry', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.new-item', 'input', { value: 'coffee' })
    t.simulateEvent('.add', 'click')
    await t.next((s) => s.error !== '')
    expect(t.query('.error').textContent).toBe('Already in the pantry.')
    expect(t.state.items).toHaveLength(6)

    t.simulateEvent('.new-item', 'input', { value: 'coffee beans' })
    await t.next((s) => s.error === '')
    expect(t.query('.error')).toBeNull()
  })

  it('Low stock shows only low items', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.tab-low', 'click')
    await t.next((s) => s.listMode === 'low')
    expect(names()).toEqual(['Coffee', 'Pasta'])
    expect(t.query('.tab-low').classList.contains('active')).toBe(true)

    t.simulateEvent(`${row(5)} .inc`, 'click')
    t.simulateEvent(`${row(3)} .inc`, 'click')
    t.simulateEvent(`${row(3)} .inc`, 'click')
    await t.next((s) => s.lowCount === 0)
    expect(t.queryAll('li.item')).toHaveLength(0)
    expect(t.query('.empty').textContent).toBe('Nothing here.')

    t.simulateEvent('.tab-all', 'click')
    await t.next((s) => s.listMode === 'all')
    expect(names()).toHaveLength(6)
  })

  it('sorts by quantity', async () => {
    t = renderComponent(App, { strict: true })
    t.simulateEvent('.sort', 'change', { value: 'qty' })
    await t.next((s) => s.sortBy === 'qty')
    expect(names()).toEqual(['Pasta', 'Coffee', 'Olive oil', 'Black beans', 'Rice', 'Canned tomatoes'])
  })
})
