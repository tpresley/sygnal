import { describe, it, expect } from 'vitest'
import { mountApp, waitFor, bodyText, textOf, click, sleep, rowOf, queryByText, getByText } from './dom.js'

const card = (subject) => rowOf(subject, 'button')
const cardText = (subject) => textOf(card(subject))
const cardButton = (subject, label) => getByText('button', label, card(subject))
const hasButton = (subject, label) => queryByText('button', label, card(subject)) !== null
const counts = () => textOf(document.querySelector('.counts'))
const activity = () => [...document.querySelectorAll('.activity li')].map((li) => textOf(li))
const releaseButton = () => getByText('button', 'Release my tickets')

describe('14 fix: activity entries for closed tickets, and "Assign to me"', () => {
  it('starts as before', async () => {
    await mountApp()
    expect(counts()).toBe('3 open · 0 assigned to me')
    expect(bodyText()).toContain('No activity yet.')
    expect(cardText('Cannot reset password')).toContain('Assignee: —')
    expect(hasButton('Cannot reset password', 'Assign to me')).toBe(true)
    expect(hasButton('App crashes on upload', 'Reopen')).toBe(true)
  })

  it('closing a ticket adds an activity entry at the top', async () => {
    await mountApp()
    await click(cardButton('Cannot reset password', 'Close'))
    await waitFor(() => expect(activity()).toEqual(['Closed #101: Cannot reset password']))
    expect(cardText('Cannot reset password')).toMatch(/#101 · Jo · Closed/)
    await waitFor(() => expect(counts()).toBe('2 open · 0 assigned to me'))
    expect(bodyText()).not.toContain('No activity yet.')

    await click(cardButton('Export to CSV is empty', 'Close'))
    await waitFor(() =>
      expect(activity()).toEqual(['Closed #104: Export to CSV is empty', 'Closed #101: Cannot reset password'])
    )
  })

  it('closing and reopening are both logged, newest first', async () => {
    await mountApp()
    await click(cardButton('Invoice shows wrong VAT', 'Close'))
    await waitFor(() => expect(activity()).toHaveLength(1))
    await click(cardButton('Invoice shows wrong VAT', 'Reopen'))
    await waitFor(() => expect(activity()).toHaveLength(2))
    await click(cardButton('App crashes on upload', 'Reopen'))
    await waitFor(() =>
      expect(activity()).toEqual([
        'Reopened #103: App crashes on upload',
        'Reopened #102: Invoice shows wrong VAT',
        'Closed #102: Invoice shows wrong VAT',
      ])
    )
    await waitFor(() => expect(counts()).toBe('4 open · 1 assigned to me'))
  })

  it('"Assign to me" assigns the ticket to Priya and updates the header', async () => {
    await mountApp()
    await click(cardButton('Cannot reset password', 'Assign to me'))
    await waitFor(() => expect(cardText('Cannot reset password')).toContain('Assignee: Priya'))
    expect(hasButton('Cannot reset password', 'Assign to me')).toBe(false)
    await waitFor(() => expect(counts()).toBe('3 open · 1 assigned to me'))
    // Other tickets are untouched.
    expect(cardText('Export to CSV is empty')).toContain('Assignee: —')
    expect(cardText('Invoice shows wrong VAT')).toContain('Assignee: Sam')

    // Taking over someone else's ticket works too.
    await click(cardButton('Invoice shows wrong VAT', 'Assign to me'))
    await waitFor(() => expect(cardText('Invoice shows wrong VAT')).toContain('Assignee: Priya'))
    await waitFor(() => expect(counts()).toBe('3 open · 2 assigned to me'))
    expect(cardText('Export to CSV is empty')).toContain('Assignee: —')
  })

  it('assigning, then closing and reopening, keeps the assignee and the counts right', async () => {
    await mountApp()
    await click(cardButton('Export to CSV is empty', 'Assign to me'))
    await waitFor(() => expect(counts()).toBe('3 open · 1 assigned to me'))
    await click(cardButton('Export to CSV is empty', 'Close'))
    await waitFor(() => expect(counts()).toBe('2 open · 0 assigned to me'))
    await waitFor(() => expect(activity()).toEqual(['Closed #104: Export to CSV is empty']))
    expect(cardText('Export to CSV is empty')).toContain('Assignee: Priya')
    await click(cardButton('Export to CSV is empty', 'Reopen'))
    await waitFor(() => expect(counts()).toBe('3 open · 1 assigned to me'))
    expect(hasButton('Export to CSV is empty', 'Assign to me')).toBe(false)
    expect(activity()).toHaveLength(2)
  })

  it('"Release my tickets" still unassigns the open tickets assigned to me, including newly assigned ones', async () => {
    await mountApp()
    expect(releaseButton().disabled).toBe(true)
    await click(cardButton('Cannot reset password', 'Assign to me'))
    await click(cardButton('Invoice shows wrong VAT', 'Assign to me'))
    await waitFor(() => expect(counts()).toBe('3 open · 2 assigned to me'))
    expect(releaseButton().disabled).toBe(false)

    await click(releaseButton())
    await waitFor(() => expect(counts()).toBe('3 open · 0 assigned to me'))
    expect(cardText('Cannot reset password')).toContain('Assignee: —')
    expect(cardText('Invoice shows wrong VAT')).toContain('Assignee: —')
    expect(hasButton('Cannot reset password', 'Assign to me')).toBe(true)
    // The closed ticket keeps its assignee.
    expect(cardText('App crashes on upload')).toContain('Assignee: Priya')
    expect(releaseButton().disabled).toBe(true)

    // Assigning again after a release works.
    await click(cardButton('Cannot reset password', 'Assign to me'))
    await waitFor(() => expect(cardText('Cannot reset password')).toContain('Assignee: Priya'))
    await waitFor(() => expect(counts()).toBe('3 open · 1 assigned to me'))
    await sleep(50)
    expect(activity()).toEqual([])
  })
})
