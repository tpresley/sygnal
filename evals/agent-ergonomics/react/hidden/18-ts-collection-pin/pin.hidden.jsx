import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, within, bodyText, setChecked } from './dom.js'

describe('18 (TS) pin a task (child -> parent through a Collection)', () => {
  it('starts with nothing pinned and a Pin button on every row', async () => {
    await mountApp()
    expect(bodyText()).toMatch(/Nothing pinned/)
    for (const title of ['Buy milk', 'Walk the dog', 'Write report']) {
      expect(within(title, 'button', /pin/i)).toBeTruthy()
    }
  })

  it('pinning a task shows it under the heading', async () => {
    await mountApp()
    await click(within('Walk the dog', 'button', /pin/i))
    await waitFor(() => expect(bodyText()).toMatch(/Pinned: Walk the dog/))
    expect(bodyText()).not.toMatch(/Nothing pinned/)
  })

  it('pinning another task replaces the pinned one', async () => {
    await mountApp()
    await click(within('Walk the dog', 'button', /pin/i))
    await waitFor(() => expect(bodyText()).toMatch(/Pinned: Walk the dog/))
    await click(within('Buy milk', 'button', /pin/i))
    await waitFor(() => expect(bodyText()).toMatch(/Pinned: Buy milk/))
    expect(bodyText()).not.toMatch(/Pinned: Walk the dog/)
  })

  it('checking a task off still works', async () => {
    await mountApp()
    const box = within('Buy milk', 'input[type="checkbox"]')
    await setChecked(box, true)
    await waitFor(() => expect(within('Buy milk', 'input[type="checkbox"]').checked).toBe(true))
    await click(within('Buy milk', 'button', /pin/i))
    await waitFor(() => expect(bodyText()).toMatch(/Pinned: Buy milk/))
    expect(within('Buy milk', 'input[type="checkbox"]').checked).toBe(true)
  })
})
