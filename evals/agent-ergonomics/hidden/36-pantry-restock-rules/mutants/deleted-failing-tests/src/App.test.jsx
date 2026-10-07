import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import App from './App.jsx'

let t
afterEach(() => t?.dispose())

const names = () => t.queryAll('li.item .name').map((el) => el.textContent)
const row = (id) => `li.item[data-id="${id}"]`
const isLowRow = (id) => t.query(row(id)).classList.contains('low')

describe('pantry', () => {
  it('minus is disabled at zero', async () => {
    t = renderComponent(App, { strict: true })
    await t.ready()
    expect(t.query(`${row(3)} .dec`).disabled).toBe(true)
    expect(t.query(`${row(1)} .dec`).disabled).toBe(false)
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

})
