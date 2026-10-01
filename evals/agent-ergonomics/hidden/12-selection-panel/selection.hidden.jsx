import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, getByText, textOf, bodyText, setChecked, pressKey, within, sleep } from './dom.js'

const PLACEHOLDER = 'Select a task to see its details.'

function rowEl(title) {
  const row = [...document.querySelectorAll('.task-row')].find((r) => textOf(r.querySelector('.task-title')) === title)
  if (!row) throw new Error(`No row "${title}" in: ${bodyText()}`)
  return row
}
const rowExists = (title) => [...document.querySelectorAll('.task-row')].some((r) => textOf(r.querySelector('.task-title')) === title)
const titleOf = (title) => rowEl(title).querySelector('.task-title')
const checkboxOf = (title) => rowEl(title).querySelector('input[type="checkbox"]')
const deleteButtonOf = (title) => getByText('button', 'Delete', rowEl(title))
const details = () => textOf(document.querySelector('aside.details'))
const selectedTitles = () => [...document.querySelectorAll('.task-row.selected')].map((r) => textOf(r.querySelector('.task-title')))

async function select(title) {
  await click(titleOf(title))
  await waitFor(() => expect(selectedTitles()).toEqual([title]))
}

// True when some element in the panel holds exactly the placeholder text.
// (Deliberately not "the panel text doesn't contain the placeholder": a known
// Sygnal rendering bug can leave the old text node behind when a
// single-text element is patched into one with several children, and this
// suite must not measure that bug. See README "Known framework issues".)
const placeholderShown = () => [...document.querySelectorAll('aside.details *')].some((el) => textOf(el) === PLACEHOLDER)

function expectDetails({ title, project, assignee, status }) {
  const text = details()
  expect(text).toContain(title)
  expect(text).toContain(`Project: ${project}`)
  expect(text).toContain(`Assignee: ${assignee}`)
  expect(text).toContain(`Status: ${status}`)
  expect(placeholderShown()).toBe(false)
}

async function expectNoSelection() {
  await waitFor(() => expect(details()).toContain(PLACEHOLDER))
  expect(selectedTitles()).toEqual([])
  expect(details()).not.toMatch(/Status:/)
}

describe('12 selected task across a nested tree (rows -> sibling details panel)', () => {
  it('starts with nothing selected', async () => {
    await mountApp()
    await expectNoSelection()
    expect(bodyText()).toMatch(/4 open/)
  })

  it('clicking a title selects it and fills the panel; clicking another moves the selection', async () => {
    await mountApp()
    await select('Crash on startup')
    await waitFor(() => expectDetails({ title: 'Crash on startup', project: 'Mobile app', assignee: 'Sam', status: 'Open' }))

    await select('Update footer links')
    await waitFor(() => expectDetails({ title: 'Update footer links', project: 'Website', assignee: 'Sam', status: 'Done' }))
    expect(details()).not.toContain('Crash on startup')
    expect(rowEl('Crash on startup').classList.contains('selected')).toBe(false)
  })

  it('the panel follows the selected task when it is checked off or unchecked', async () => {
    await mountApp()
    await select('Fix login bug')
    await waitFor(() => expect(details()).toContain('Status: Open'))
    await setChecked(checkboxOf('Fix login bug'), true)
    await waitFor(() => expect(details()).toContain('Status: Done'))
    expect(selectedTitles()).toEqual(['Fix login bug'])
    await waitFor(() => expect(bodyText()).toMatch(/3 open/))

    // Toggling a different task doesn't touch the panel.
    await setChecked(checkboxOf('Dark mode'), true)
    await waitFor(() => expect(bodyText()).toMatch(/2 open/))
    expectDetails({ title: 'Fix login bug', project: 'Website', assignee: 'Priya', status: 'Done' })

    await setChecked(checkboxOf('Fix login bug'), false)
    await waitFor(() => expect(details()).toContain('Status: Open'))
    expect(selectedTitles()).toEqual(['Fix login bug'])
  })

  it('Escape clears the selection, other keys do not, and Escape with nothing selected is harmless', async () => {
    await mountApp()
    await pressKey('Escape')
    await expectNoSelection()

    await select('Dark mode')
    await pressKey('Enter')
    await pressKey('a')
    await sleep(100)
    expect(selectedTitles()).toEqual(['Dark mode'])
    expect(details()).toContain('Assignee: Priya')

    await pressKey('Escape')
    await expectNoSelection()
    await pressKey('Escape')
    await expectNoSelection()

    await select('Write release notes')
    await waitFor(() => expectDetails({ title: 'Write release notes', project: 'Website', assignee: 'Lee', status: 'Open' }))
  })

  it('Escape works while focus is inside a row', async () => {
    await mountApp()
    await select('Fix login bug')
    checkboxOf('Fix login bug').focus()
    await pressKey('Escape', checkboxOf('Fix login bug'))
    await expectNoSelection()
    expect(checkboxOf('Fix login bug').checked).toBe(false)
  })

  it('deleting the selected task clears the selection', async () => {
    await mountApp()
    await select('Dark mode')
    await click(deleteButtonOf('Dark mode'))
    await waitFor(() => expect(rowExists('Dark mode')).toBe(false))
    await expectNoSelection()
    await waitFor(() => expect(bodyText()).toMatch(/3 open/))

    await select('Crash on startup')
    await waitFor(() => expectDetails({ title: 'Crash on startup', project: 'Mobile app', assignee: 'Sam', status: 'Open' }))
  })

  it('deleting other tasks, in the same project or another, keeps the selection', async () => {
    await mountApp()
    await select('Write release notes')
    await click(deleteButtonOf('Fix login bug'))
    await waitFor(() => expect(rowExists('Fix login bug')).toBe(false))
    await click(deleteButtonOf('Crash on startup'))
    await waitFor(() => expect(rowExists('Crash on startup')).toBe(false))
    await sleep(100)
    expect(selectedTitles()).toEqual(['Write release notes'])
    expectDetails({ title: 'Write release notes', project: 'Website', assignee: 'Lee', status: 'Open' })
    await waitFor(() => expect(bodyText()).toMatch(/2 open/))
  })

  it('existing features keep working alongside a selection', async () => {
    await mountApp()
    await select('Crash on startup')
    await setChecked(within('Hide done', 'input[type="checkbox"]'), true)
    await waitFor(() => expect(rowExists('Update footer links')).toBe(false))
    expect(rowExists('Fix login bug')).toBe(true)
    expect(selectedTitles()).toEqual(['Crash on startup'])
    expect(textOf(document.querySelector('.project'))).toMatch(/\(2 open\)/)
    await setChecked(within('Hide done', 'input[type="checkbox"]'), false)
    await waitFor(() => expect(rowExists('Update footer links')).toBe(true))
    expectDetails({ title: 'Crash on startup', project: 'Mobile app', assignee: 'Sam', status: 'Open' })
  })
})
