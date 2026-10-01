import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, button, typeInto, queryByText, bodyText } from './dom.js'

const titleInput = () => document.querySelector('input')

describe('06 fix: Add button does nothing (seeded view/intent selector mismatch)', () => {
  it('adds the typed todo when Add is clicked', async () => {
    await mountApp()
    await typeInto(titleInput(), 'Call mom')
    await click(button(/^add$/i))
    await waitFor(() => expect(queryByText('li', 'Call mom')).not.toBeNull())
    expect(bodyText()).toMatch(/\b3 items/)
  })

  it('clears the input after adding, and can add again', async () => {
    await mountApp()
    await typeInto(titleInput(), 'Call mom')
    await click(button(/^add$/i))
    await waitFor(() => expect(queryByText('li', 'Call mom')).not.toBeNull())
    await waitFor(() => expect(titleInput().value).toBe(''))
    await typeInto(titleInput(), 'Pay rent')
    await click(button(/^add$/i))
    await waitFor(() => expect(queryByText('li', 'Pay rent')).not.toBeNull())
    expect(bodyText()).toMatch(/\b4 items/)
  })

  it('ignores blank todos', async () => {
    await mountApp()
    await typeInto(titleInput(), '   ')
    await click(button(/^add$/i))
    await typeInto(titleInput(), 'Real one')
    await click(button(/^add$/i))
    await waitFor(() => expect(queryByText('li', 'Real one')).not.toBeNull())
    expect(document.querySelectorAll('li').length).toBe(3)
  })
})
