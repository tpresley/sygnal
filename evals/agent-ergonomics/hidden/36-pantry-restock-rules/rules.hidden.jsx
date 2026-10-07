import { describe, it, expect } from 'vitest'
import { mountApp, waitFor, textOf, bodyText, click, typeInto, choose } from './dom.js'
import { runProjectTests } from './project.js'

// 36 (mod, level S, change): "low" becomes qty <= min everywhere, adding a known name restocks it
// by one instead of refusing it, and the Quantity sort becomes "Most urgent" (qty - min, then name).

const $ = (sel) => document.querySelector(sel)
const names = () => [...document.querySelectorAll('li.item .name')].map((el) => textOf(el))
const rowOf = (name) => {
  const li = [...document.querySelectorAll('li.item')].find((el) => textOf(el.querySelector('.name')) === name)
  if (!li) throw new Error(`no row "${name}" in: ${bodyText()}`)
  return li
}
const qty = (name) => textOf(rowOf(name).querySelector('.qty'))
const lowNames = () => [...document.querySelectorAll('li.item.low .name')].map((el) => textOf(el))
const summary = () => textOf($('.summary'))
const inc = (name) => click(rowOf(name).querySelector('.inc'))
const dec = (name) => click(rowOf(name).querySelector('.dec'))
async function addItem(name) {
  await typeInto($('input[name="new-item"]'), name)
  await click($('.add'))
}

describe('36 pantry restock rules', () => {
  it('an item at its minimum is low: rows, summary and the Low stock tab agree', async () => {
    await mountApp()
    await waitFor(() => expect(summary()).toBe('6 items · 4 low'))
    expect(lowNames()).toEqual(['Black beans', 'Coffee', 'Olive oil', 'Pasta'])
    await click($('.tab-low'))
    await waitFor(() => expect(names()).toEqual(['Black beans', 'Coffee', 'Olive oil', 'Pasta']))
    expect($('.tab-low').classList.contains('active')).toBe(true)
  })

  it('crossing the minimum in either direction updates every place', async () => {
    await mountApp()
    // Olive oil 1 -> 2 (min 1): above its minimum
    await inc('Olive oil')
    await waitFor(() => expect(qty('Olive oil')).toBe('2'))
    expect(rowOf('Olive oil').classList.contains('low')).toBe(false)
    expect(summary()).toBe('6 items · 3 low')
    // Rice 4 -> 3 -> 2 (min 2): low exactly at its minimum
    await dec('Rice')
    await waitFor(() => expect(qty('Rice')).toBe('3'))
    expect(rowOf('Rice').classList.contains('low')).toBe(false)
    await dec('Rice')
    await waitFor(() => expect(qty('Rice')).toBe('2'))
    expect(rowOf('Rice').classList.contains('low')).toBe(true)
    expect(summary()).toBe('6 items · 4 low')
    await click($('.tab-low'))
    await waitFor(() => expect(names()).toEqual(['Black beans', 'Coffee', 'Pasta', 'Rice']))
    // leaving the tab's rule live: Rice back above its minimum disappears from Low stock
    await inc('Rice')
    await waitFor(() => expect(names()).toEqual(['Black beans', 'Coffee', 'Pasta']))
  })

  it('adding a name already in the pantry adds one to it instead of a message', async () => {
    await mountApp()
    await addItem('  COFFEE ')
    await waitFor(() => expect(qty('Coffee')).toBe('2'))
    expect(names()).toEqual(['Black beans', 'Canned tomatoes', 'Coffee', 'Olive oil', 'Pasta', 'Rice'])
    expect($('input[name="new-item"]').value).toBe('')
    expect(bodyText()).not.toContain('Already in the pantry.')
    expect($('.error')).toBeNull()
    expect(textOf(rowOf('Coffee').querySelector('.min'))).toBe('min 2')
    // still at its minimum (2 / 2): low
    expect(rowOf('Coffee').classList.contains('low')).toBe(true)
    expect(summary()).toBe('6 items · 4 low')

    await addItem('olive oil')
    await waitFor(() => expect(qty('Olive oil')).toBe('2'))
    expect(rowOf('Olive oil').classList.contains('low')).toBe(false)
    expect(summary()).toBe('6 items · 3 low')
  })

  it('a new name still adds an item with quantity 1 and minimum 1 (low at once)', async () => {
    await mountApp()
    await addItem('Flour')
    await waitFor(() => expect(names()).toContain('Flour'))
    expect(qty('Flour')).toBe('1')
    expect(textOf(rowOf('Flour').querySelector('.min'))).toBe('min 1')
    expect(rowOf('Flour').classList.contains('low')).toBe(true)
    expect(summary()).toBe('7 items · 5 low')
    // a second "flour" restocks the new item
    await addItem('flour')
    await waitFor(() => expect(qty('Flour')).toBe('2'))
    expect(document.querySelectorAll('li.item')).toHaveLength(7)
    expect(summary()).toBe('7 items · 4 low')
  })

  it('"Most urgent" replaces "Quantity": quantity minus minimum, then name', async () => {
    await mountApp()
    const select = $('select[name="sort"]')
    const options = [...select.options].map((o) => [o.value, textOf(o)])
    expect(options).toEqual([['name', 'Name'], ['urgency', 'Most urgent']])
    expect(select.value).toBe('name')
    await choose(select, 'urgency')
    // Pasta -2, Coffee -1, Black beans 0, Olive oil 0, Rice +2, Canned tomatoes +3
    await waitFor(() => expect(names()).toEqual(['Pasta', 'Coffee', 'Black beans', 'Olive oil', 'Rice', 'Canned tomatoes']))
    // Pasta 0 -> 3 (+1 above its minimum): moves between Olive oil and Rice
    await inc('Pasta')
    await inc('Pasta')
    await inc('Pasta')
    await waitFor(() => expect(names()).toEqual(['Coffee', 'Black beans', 'Olive oil', 'Pasta', 'Rice', 'Canned tomatoes']))
    await click($('.tab-low'))
    await waitFor(() => expect(names()).toEqual(['Coffee', 'Black beans', 'Olive oil']))
    await choose(select, 'name')
    await waitFor(() => expect(names()).toEqual(['Black beans', 'Coffee', 'Olive oil']))
  })

  it('what worked before still works: minus stops at zero, blank names, removing, undo, empty tab', async () => {
    await mountApp()
    expect(rowOf('Pasta').querySelector('.dec').disabled).toBe(true)
    await addItem('   ')
    await waitFor(() => expect(document.querySelectorAll('li.item')).toHaveLength(6))
    await click(rowOf('Coffee').querySelector('.remove'))
    await waitFor(() => expect(names()).not.toContain('Coffee'))
    expect(summary()).toBe('5 items · 3 low')
    await click($('.notice .undo'))
    await waitFor(() => expect(names()).toContain('Coffee'))
    expect(summary()).toBe('6 items · 4 low')
    await click(rowOf('Coffee').querySelector('.remove'))
    await waitFor(() => expect(summary()).toBe('5 items · 3 low'))
    await click($('.tab-low'))
    await waitFor(() => expect(names()).toEqual(['Black beans', 'Olive oil', 'Pasta']))
    await inc('Black beans')
    await inc('Olive oil')
    await inc('Pasta')
    await inc('Pasta')
    await inc('Pasta')
    await waitFor(() => expect(textOf($('.empty'))).toBe('Nothing here.'))
    await click($('.tab-all'))
    await waitFor(() => expect(names()).toHaveLength(5))
  })

  // Passing own tests a legitimate solution keeps, so deleting failing tests instead of updating
  // them fails this test.
  // change: the starter suite has 11 tests (both arms); the new rules break 7 of them, which must be
  // updated, not deleted. The reference updates them and keeps 11.
  const MIN_PASSING_OWN_TESTS = 11

  it('project: the project\'s own tests pass', () => {
    const r = runProjectTests()
    expect(r.failures).toEqual([])
    expect(r.failed).toBe(0)
    expect(r.passed).toBeGreaterThanOrEqual(MIN_PASSING_OWN_TESTS)
  }, 240000)
})
