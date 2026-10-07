import { describe, it, expect } from 'vitest'
import { mountApp, waitFor, textOf, bodyText, click, typeInto, choose } from './dom.js'
import { runProjectTests } from './project.js'

// 35 (mod, level S, add): a search field over the pantry list, combined with the tabs and the sort,
// with live tab counts, a no-match message and a Clear search button.

const $ = (sel) => document.querySelector(sel)
const names = () => [...document.querySelectorAll('li.item .name')].map((el) => textOf(el))
const rowOf = (name) => {
  const li = [...document.querySelectorAll('li.item')].find((el) => textOf(el.querySelector('.name')) === name)
  if (!li) throw new Error(`no row "${name}" in: ${bodyText()}`)
  return li
}
const search = () => $('input[name="search"]')
const tabs = () => [textOf($('.tab-all')), textOf($('.tab-low'))]
const summary = () => textOf($('.summary'))
const clearButton = () => $('button.clear-search')
const empty = () => ($('.empty') ? textOf($('.empty')) : null)

async function find(text) {
  await typeInto(search(), text)
}
async function addItem(name) {
  await typeInto($('input[name="new-item"]'), name)
  await click($('.add'))
}

const ALL = ['Black beans', 'Canned tomatoes', 'Coffee', 'Olive oil', 'Pasta', 'Rice']

describe('35 pantry search', () => {
  it('filters by name as the user types, ignoring case and surrounding spaces', async () => {
    await mountApp()
    expect(search()).not.toBeNull()
    expect(search().value).toBe('')
    expect(names()).toEqual(ALL)

    await find('o')
    await waitFor(() => expect(names()).toEqual(['Canned tomatoes', 'Coffee', 'Olive oil']))
    await find('  OLIVE ')
    await waitFor(() => expect(names()).toEqual(['Olive oil']))
    await find('an')
    await waitFor(() => expect(names()).toEqual(['Black beans', 'Canned tomatoes']))
    await find('')
    await waitFor(() => expect(names()).toEqual(ALL))
  })

  it('combines with the Low stock tab and the sort order', async () => {
    await mountApp()
    await choose($('select[name="sort"]'), 'qty')
    await waitFor(() => expect(names()).toEqual(['Pasta', 'Coffee', 'Olive oil', 'Black beans', 'Rice', 'Canned tomatoes']))
    await find('o')
    await waitFor(() => expect(names()).toEqual(['Coffee', 'Olive oil', 'Canned tomatoes']))
    await click($('.tab-low'))
    await waitFor(() => expect(names()).toEqual(['Coffee']))
    expect($('.tab-low').classList.contains('active')).toBe(true)
    await find('')
    await waitFor(() => expect(names()).toEqual(['Pasta', 'Coffee']))
    await click($('.tab-all'))
    await waitFor(() => expect(names()).toHaveLength(6))
  })

  it('the tab buttons count what they would list for the current search, kept up to date', async () => {
    await mountApp()
    await waitFor(() => expect(tabs()).toEqual(['All (6)', 'Low stock (2)']))
    await find('o')
    await waitFor(() => expect(tabs()).toEqual(['All (3)', 'Low stock (1)']))

    // Coffee 1 -> 2 (min 2): no longer low
    await click(rowOf('Coffee').querySelector('.inc'))
    await waitFor(() => expect(tabs()).toEqual(['All (3)', 'Low stock (0)']))
    // Olive oil 1 -> 0 (min 1): low
    await click(rowOf('Olive oil').querySelector('.dec'))
    await waitFor(() => expect(tabs()).toEqual(['All (3)', 'Low stock (1)']))

    await addItem('Oats')
    await waitFor(() => expect(tabs()).toEqual(['All (4)', 'Low stock (1)']))
    await click(rowOf('Canned tomatoes').querySelector('.remove'))
    await waitFor(() => expect(tabs()).toEqual(['All (3)', 'Low stock (1)']))
    await find('')
    await waitFor(() => expect(tabs()).toEqual(['All (6)', 'Low stock (2)']))
  })

  it('shows a no-match message instead of "Nothing here." while searching', async () => {
    await mountApp()
    await find('  xyz ')
    await waitFor(() => expect(empty()).toBe('No items match “xyz”.'))
    expect(document.querySelectorAll('li.item')).toHaveLength(0)
    expect(bodyText()).not.toContain('Nothing here.')
    expect(tabs()).toEqual(['All (0)', 'Low stock (0)'])

    // nothing low matches "rice", on the Low stock tab
    await find('rice')
    await click($('.tab-low'))
    await waitFor(() => expect(empty()).toBe('No items match “rice”.'))
    await click($('.tab-all'))
    await waitFor(() => expect(names()).toEqual(['Rice']))
    expect(empty()).toBeNull()

    // without a search, an empty Low stock tab still says "Nothing here."
    await find('')
    await click(rowOf('Coffee').querySelector('.inc'))
    await click(rowOf('Pasta').querySelector('.inc'))
    await click(rowOf('Pasta').querySelector('.inc'))
    await click($('.tab-low'))
    await waitFor(() => expect(empty()).toBe('Nothing here.'))
  })

  it('"Clear search" shows only while the field has text and resets the list', async () => {
    await mountApp()
    expect(clearButton()).toBeNull()
    await find('co')
    await waitFor(() => expect(clearButton()).not.toBeNull())
    expect(textOf(clearButton())).toBe('Clear search')
    expect(names()).toEqual(['Coffee'])

    await click(clearButton())
    await waitFor(() => expect(names()).toEqual(ALL))
    expect(search().value).toBe('')
    expect(clearButton()).toBeNull()
    expect(tabs()).toEqual(['All (6)', 'Low stock (2)'])

    // typing it away by hand hides the button too
    await find('x')
    await waitFor(() => expect(clearButton()).not.toBeNull())
    await find('')
    await waitFor(() => expect(clearButton()).toBeNull())
  })

  it('the summary keeps counting the whole pantry', async () => {
    await mountApp()
    await find('rice')
    await waitFor(() => expect(names()).toEqual(['Rice']))
    expect(summary()).toBe('6 items · 2 low')
    await addItem('Flour')
    await waitFor(() => expect(summary()).toBe('7 items · 2 low'))
    expect(names()).toEqual(['Rice'])
    await find('flo')
    await waitFor(() => expect(names()).toEqual(['Flour']))
  })

  it('what worked before still works: quantities, low marks, adding, duplicates, removing, undo', async () => {
    await mountApp()
    await waitFor(() => expect(summary()).toBe('6 items · 2 low'))
    expect(rowOf('Pasta').classList.contains('low')).toBe(true)
    expect(rowOf('Pasta').querySelector('.dec').disabled).toBe(true)
    await click(rowOf('Coffee').querySelector('.inc'))
    await waitFor(() => expect(textOf(rowOf('Coffee').querySelector('.qty'))).toBe('2'))
    expect(rowOf('Coffee').classList.contains('low')).toBe(false)
    expect(summary()).toBe('6 items · 1 low')

    await addItem('coffee')
    await waitFor(() => expect(textOf($('.error'))).toBe('Already in the pantry.'))
    await addItem('Honey')
    await waitFor(() => expect(names()).toContain('Honey'))
    expect($('.error')).toBeNull()
    expect($('input[name="new-item"]').value).toBe('')
    await click(rowOf('Rice').querySelector('.remove'))
    await waitFor(() => expect(names()).not.toContain('Rice'))
    expect(summary()).toBe('6 items · 1 low')
    expect(textOf($('.notice'))).toContain('Removed Rice.')
    await click($('.notice .undo'))
    await waitFor(() => expect(names()).toContain('Rice'))
    expect($('.notice')).toBeNull()
  })

  it('project: the project\'s own tests pass', () => {
    const r = runProjectTests()
    expect(r.failures).toEqual([])
    expect(r.failed).toBe(0)
    expect(r.total).toBeGreaterThanOrEqual(3)
  }, 240000)
})
