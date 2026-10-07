import { describe, it, expect, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import App from './App.jsx'

afterEach(() => cleanup())

let container
const q = (sel) => container.querySelector(sel)
const qa = (sel) => [...container.querySelectorAll(sel)]
const names = () => qa('li.item .name').map((el) => el.textContent)
const row = (id) => `li.item[data-id="${id}"]`
const isLowRow = (id) => q(row(id)).classList.contains('low')
const summary = () => q('.summary').textContent
const qtyOf = (id) => q(`${row(id)} .qty`).textContent
const mount = () => ({ container } = render(<App />))

describe('pantry', () => {
  it('shows the summary and marks low items', () => {
    mount()
    expect(summary()).toBe('6 items · 2 low')
    expect(names()).toEqual(['Black beans', 'Canned tomatoes', 'Coffee', 'Olive oil', 'Pasta', 'Rice'])
    expect(isLowRow(3)).toBe(true) // Pasta 0 / 2
    expect(isLowRow(5)).toBe(true) // Coffee 1 / 2
    expect(isLowRow(2)).toBe(false) // Olive oil 1 / 1
    expect(isLowRow(6)).toBe(false) // Black beans 3 / 3
  })

  it('plus and minus change a quantity and the low count', () => {
    mount()
    fireEvent.click(q(`${row(5)} .inc`))
    expect(qtyOf(5)).toBe('2')
    expect(isLowRow(5)).toBe(false)
    expect(summary()).toBe('6 items · 1 low')

    fireEvent.click(q(`${row(2)} .dec`))
    expect(qtyOf(2)).toBe('0')
    expect(isLowRow(2)).toBe(true)
    expect(summary()).toBe('6 items · 2 low')
  })

  it('minus is disabled at zero', () => {
    mount()
    expect(q(`${row(3)} .dec`).disabled).toBe(true)
    expect(q(`${row(1)} .dec`).disabled).toBe(false)
  })

  it('removes an item', () => {
    mount()
    fireEvent.click(q(`${row(5)} .remove`))
    expect(names()).not.toContain('Coffee')
    expect(summary()).toBe('5 items · 1 low')
  })

  it('adds a new item with quantity 1 and minimum 1', () => {
    mount()
    fireEvent.change(q('.new-item'), { target: { value: '  Flour ' } })
    fireEvent.click(q('.add'))
    expect(names()).toContain('Flour')
    const flour = qa('li.item').find((li) => li.querySelector('.name').textContent === 'Flour')
    expect(flour.querySelector('.qty').textContent).toBe('1')
    expect(flour.querySelector('.min').textContent).toBe('min 1')
    expect(q('.new-item').value).toBe('')
    expect(summary()).toBe('7 items · 2 low')
  })

  it('adds with the Enter key', () => {
    mount()
    fireEvent.change(q('.new-item'), { target: { value: 'Salt' } })
    fireEvent.keyDown(q('.new-item'), { key: 'Enter' })
    expect(names()).toContain('Salt')
  })

  it('undoes the last removal', () => {
    mount()
    fireEvent.click(q(`${row(4)} .remove`))
    expect(names()).not.toContain('Canned tomatoes')
    expect(q('.notice').textContent).toContain('Removed Canned tomatoes.')
    fireEvent.click(q('.undo'))
    expect(names()).toEqual(['Black beans', 'Canned tomatoes', 'Coffee', 'Olive oil', 'Pasta', 'Rice'])
    expect(q('.notice')).toBeNull()
  })

  it('ignores a blank name', () => {
    mount()
    fireEvent.change(q('.new-item'), { target: { value: '   ' } })
    fireEvent.click(q('.add'))
    expect(qa('li.item')).toHaveLength(6)
    expect(q('.error')).toBeNull()
  })

  it('refuses a name that is already in the pantry', () => {
    mount()
    fireEvent.change(q('.new-item'), { target: { value: 'coffee' } })
    fireEvent.click(q('.add'))
    expect(q('.error').textContent).toBe('Already in the pantry.')
    expect(qa('li.item')).toHaveLength(6)

    fireEvent.change(q('.new-item'), { target: { value: 'coffee beans' } })
    expect(q('.error')).toBeNull()
  })

  it('Low stock shows only low items', () => {
    mount()
    fireEvent.click(q('.tab-low'))
    expect(names()).toEqual(['Coffee', 'Pasta'])
    expect(q('.tab-low').classList.contains('active')).toBe(true)

    fireEvent.click(q(`${row(5)} .inc`))
    fireEvent.click(q(`${row(3)} .inc`))
    fireEvent.click(q(`${row(3)} .inc`))
    expect(qa('li.item')).toHaveLength(0)
    expect(q('.empty').textContent).toBe('Nothing here.')

    fireEvent.click(q('.tab-all'))
    expect(names()).toHaveLength(6)
  })

  it('sorts by quantity', () => {
    mount()
    fireEvent.change(q('.sort'), { target: { value: 'qty' } })
    expect(names()).toEqual(['Pasta', 'Coffee', 'Olive oil', 'Black beans', 'Rice', 'Canned tomatoes'])
  })
})
