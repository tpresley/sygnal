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
  it('minus is disabled at zero', () => {
    mount()
    expect(q(`${row(3)} .dec`).disabled).toBe(true)
    expect(q(`${row(1)} .dec`).disabled).toBe(false)
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

})
