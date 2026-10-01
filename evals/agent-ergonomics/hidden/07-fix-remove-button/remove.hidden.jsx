import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, within, queryByText, bodyText, setChecked } from './dom.js'

const removeBtn = (title) => within(title, 'button', '×')

describe('07 fix: × does not delete (seeded isolation-boundary bug)', () => {
  it('removes the clicked todo and only that todo', async () => {
    await mountApp()
    await click(removeBtn('Walk the dog'))
    await waitFor(() => expect(queryByText('*', 'Walk the dog')).toBeNull())
    expect(queryByText('*', 'Buy milk')).not.toBeNull()
    expect(queryByText('*', 'Write report')).not.toBeNull()
    expect(bodyText()).toMatch(/1 left of 2/)
  })

  it('can remove several todos in a row', async () => {
    await mountApp()
    await click(removeBtn('Buy milk'))
    await waitFor(() => expect(queryByText('*', 'Buy milk')).toBeNull())
    await click(removeBtn('Write report'))
    await waitFor(() => expect(queryByText('*', 'Write report')).toBeNull())
    expect(queryByText('*', 'Walk the dog')).not.toBeNull()
    expect(bodyText()).toMatch(/1 left of 1/)
  })

  it('toggling still works after a removal', async () => {
    await mountApp()
    await click(removeBtn('Buy milk'))
    await waitFor(() => expect(queryByText('*', 'Buy milk')).toBeNull())
    await setChecked(within('Walk the dog', 'input[type="checkbox"]'), true)
    await waitFor(() => expect(bodyText()).toMatch(/0 left of 2/))
  })
})
