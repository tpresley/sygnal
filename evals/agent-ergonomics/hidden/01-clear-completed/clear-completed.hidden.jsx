import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, button, queryByText, rowContaining, setChecked, bodyText } from './dom.js'

describe('01 clear completed', () => {
  it('renders a "Clear completed" button', async () => {
    await mountApp()
    expect(button(/clear completed/i)).toBeTruthy()
  })

  it('removes completed tasks and keeps the rest', async () => {
    await mountApp()
    await click(button(/clear completed/i))
    await waitFor(() => {
      expect(queryByText('li', 'Buy milk')).toBeNull()
      expect(queryByText('li', 'Write report')).toBeNull()
    })
    expect(queryByText('li', 'Walk the dog')).not.toBeNull()
    expect(bodyText()).toMatch(/\b1 remaining/)
  })

  it('clears tasks that were checked by the user', async () => {
    await mountApp()
    await setChecked(rowContaining('Walk the dog').querySelector('input[type="checkbox"]'), true)
    await waitFor(() => expect(bodyText()).toMatch(/\b0 remaining/))
    await click(button(/clear completed/i))
    await waitFor(() => expect(document.querySelectorAll('li').length).toBe(0))
    expect(bodyText()).toMatch(/\b0 remaining/)
  })
})
