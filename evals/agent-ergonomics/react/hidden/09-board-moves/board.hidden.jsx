import { describe, it, expect } from 'vitest'
import { click, mountApp, waitFor, getByText, textOf, bodyText, setChecked } from './dom.js'

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function listEl(name) {
  const re = new RegExp(`^${escape(name)}(\\s|$)`)
  const heading = [...document.querySelectorAll('section.list h2')].find((h) => re.test(textOf(h)))
  if (!heading) throw new Error(`No list headed "${name}" in: ${bodyText()}`)
  return heading.closest('section.list')
}
const headingOf = (name) => textOf(listEl(name).querySelector('h2'))
const titlesIn = (name) => [...listEl(name).querySelectorAll('.card')].map((c) => textOf(c.querySelector('.title')))
function cardEl(title) {
  const card = [...document.querySelectorAll('.card')].find((c) => textOf(c.querySelector('.title')) === title)
  if (!card) throw new Error(`No card "${title}" in: ${bodyText()}`)
  return card
}
const buttonOn = (title, label) => getByText('button', label, cardEl(title))
const checkboxOf = (title) => cardEl(title).querySelector('input[type="checkbox"]')

const INITIAL = {
  'To do': ['Write spec', 'Design schema', 'Set up CI'],
  Doing: ['Build API'],
  Done: ['Kickoff meeting'],
}

function expectLists(expected) {
  for (const [name, titles] of Object.entries(expected)) {
    expect(titlesIn(name)).toEqual(titles)
    expect(headingOf(name)).toMatch(new RegExp(`\\(${titles.length}\\)`))
  }
}

describe('09 nested collections: move cards between lists', () => {
  it('shows per-list counts, the total, and Previous list / Next list on every card', async () => {
    await mountApp()
    expectLists(INITIAL)
    expect(bodyText()).toMatch(/Cards: 5\b/)
    for (const title of Object.values(INITIAL).flat()) {
      for (const label of ['Previous list', 'Next list']) expect(buttonOn(title, label)).toBeTruthy()
    }
  })

  it('Next list moves a card to the bottom of the next list, keeping its checked state, and it stays usable', async () => {
    await mountApp()
    await click(buttonOn('Set up CI', 'Next list'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Build API', 'Set up CI']))
    expectLists({ 'To do': ['Write spec', 'Design schema'], Doing: ['Build API', 'Set up CI'], Done: ['Kickoff meeting'] })
    expect(checkboxOf('Set up CI').checked).toBe(true)
    expect(bodyText()).toMatch(/Cards: 5\b/)

    await setChecked(checkboxOf('Set up CI'), false)
    await waitFor(() => expect(checkboxOf('Set up CI').checked).toBe(false))
    await click(buttonOn('Set up CI', 'Previous list'))
    await waitFor(() => expect(titlesIn('To do')).toEqual(['Write spec', 'Design schema', 'Set up CI']))
    expect(checkboxOf('Set up CI').checked).toBe(false)
    expectLists({ Doing: ['Build API'], Done: ['Kickoff meeting'] })
  })

  it('Previous list in the first list and Next list in the last list do nothing', async () => {
    await mountApp()
    await click(buttonOn('Write spec', 'Previous list'))
    await click(buttonOn('Set up CI', 'Previous list'))
    await click(buttonOn('Kickoff meeting', 'Next list'))
    expectLists(INITIAL)
    expect(checkboxOf('Set up CI').checked).toBe(true)
    expect(checkboxOf('Kickoff meeting').checked).toBe(true)
    expect(bodyText()).toMatch(/Cards: 5\b/)

    // ...and the board still works afterwards.
    await click(buttonOn('Kickoff meeting', 'Previous list'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Build API', 'Kickoff meeting']))
    expectLists({ 'To do': INITIAL['To do'], Done: [] })
  })

  it('moving the only card out of a list empties it, and a list can be refilled', async () => {
    await mountApp()
    await click(buttonOn('Build API', 'Next list'))
    await waitFor(() => expect(titlesIn('Done')).toEqual(['Kickoff meeting', 'Build API']))
    expect(titlesIn('Doing')).toEqual([])
    expect(headingOf('Doing')).toMatch(/\(0\)/)
    expect(textOf(listEl('Doing'))).toMatch(/No cards/)

    await click(buttonOn('Write spec', 'Next list'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Write spec']))
    expect(textOf(listEl('Doing'))).not.toMatch(/No cards/)
    expectLists({ 'To do': ['Design schema', 'Set up CI'], Doing: ['Write spec'], Done: ['Kickoff meeting', 'Build API'] })
    expect(bodyText()).toMatch(/Cards: 5\b/)
  })

  it('deleting cards updates the list count and the total, including moved cards', async () => {
    await mountApp()
    await click(buttonOn('Design schema', 'Delete'))
    await waitFor(() => expect(titlesIn('To do')).toEqual(['Write spec', 'Set up CI']))
    expect(headingOf('To do')).toMatch(/\(2\)/)
    await waitFor(() => expect(bodyText()).toMatch(/Cards: 4\b/))

    await click(buttonOn('Write spec', 'Next list'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Build API', 'Write spec']))
    await click(buttonOn('Write spec', 'Delete'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Build API']))
    expectLists({ 'To do': ['Set up CI'], Doing: ['Build API'], Done: ['Kickoff meeting'] })
    await waitFor(() => expect(bodyText()).toMatch(/Cards: 3\b/))
  })

  it('a card can travel to the last list and back again', async () => {
    await mountApp()
    await click(buttonOn('Design schema', 'Next list'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Build API', 'Design schema']))
    await click(buttonOn('Design schema', 'Next list'))
    await waitFor(() => expect(titlesIn('Done')).toEqual(['Kickoff meeting', 'Design schema']))
    expectLists({ 'To do': ['Write spec', 'Set up CI'], Doing: ['Build API'] })
    await click(buttonOn('Design schema', 'Previous list'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Build API', 'Design schema']))
    await click(buttonOn('Design schema', 'Previous list'))
    await waitFor(() => expect(titlesIn('To do')).toEqual(['Write spec', 'Set up CI', 'Design schema']))
    expectLists({ Doing: ['Build API'], Done: ['Kickoff meeting'] })
    expect(bodyText()).toMatch(/Cards: 5\b/)
  })

  it('several moved cards each keep their own state', async () => {
    await mountApp()
    await setChecked(checkboxOf('Write spec'), true)
    await waitFor(() => expect(checkboxOf('Write spec').checked).toBe(true))
    await click(buttonOn('Write spec', 'Next list'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Build API', 'Write spec']))
    await click(buttonOn('Design schema', 'Next list'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Build API', 'Write spec', 'Design schema']))
    expect(checkboxOf('Write spec').checked).toBe(true)
    expect(checkboxOf('Design schema').checked).toBe(false)
    expect(checkboxOf('Build API').checked).toBe(false)

    await click(buttonOn('Build API', 'Delete'))
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Write spec', 'Design schema']))
    expectLists({ 'To do': ['Set up CI'], Doing: ['Write spec', 'Design schema'], Done: ['Kickoff meeting'] })
    await waitFor(() => expect(bodyText()).toMatch(/Cards: 4\b/))
  })
})
