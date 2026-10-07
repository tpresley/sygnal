import { describe, it, expect } from 'vitest'
import { mountApp, waitFor, textOf, bodyText, click, typeInto, choose, queryByText, sleep, pressKey } from './dom.js'
import { runProjectTests, leftovers } from './project.js'

// 37 (mod, level S, remove): the All / Low stock tabs are gone (UI, state, actions, tests);
// low marks, the summary, sorting, adding, quantities, removing and the empty message still work.

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
async function addItem(name) {
  await typeInto($('input[name="new-item"]'), name)
  await click($('.add'))
}
const ALL = ['Black beans', 'Canned tomatoes', 'Coffee', 'Olive oil', 'Pasta', 'Rice']

describe('37 pantry without tabs', () => {
  it('the tabs are gone and the list shows every item', async () => {
    await mountApp()
    await waitFor(() => expect(names()).toEqual(ALL))
    expect($('.list-tabs')).toBeNull()
    expect($('.tab-all')).toBeNull()
    expect($('.tab-low')).toBeNull()
    expect(queryByText('button', 'Low stock')).toBeNull()
    expect([...document.querySelectorAll('button')].map((b) => textOf(b)).filter((t) => /^All\b/.test(t))).toEqual([])
    expect(bodyText()).not.toMatch(/low stock/i)
  })

  it('low items are still marked and counted, live', async () => {
    await mountApp()
    await waitFor(() => expect(summary()).toBe('6 items · 2 low'))
    expect(lowNames()).toEqual(['Coffee', 'Pasta'])
    await click(rowOf('Coffee').querySelector('.inc'))
    await waitFor(() => expect(qty('Coffee')).toBe('2'))
    expect(rowOf('Coffee').classList.contains('low')).toBe(false)
    expect(summary()).toBe('6 items · 1 low')
    await click(rowOf('Olive oil').querySelector('.dec'))
    await waitFor(() => expect(qty('Olive oil')).toBe('0'))
    expect(rowOf('Olive oil').classList.contains('low')).toBe(true)
    expect(rowOf('Olive oil').querySelector('.dec').disabled).toBe(true)
    expect(summary()).toBe('6 items · 2 low')
    expect(names()).toEqual(ALL)
  })

  it('the sort select still orders the whole list', async () => {
    await mountApp()
    await choose($('select[name="sort"]'), 'qty')
    await waitFor(() => expect(names()).toEqual(['Pasta', 'Coffee', 'Olive oil', 'Black beans', 'Rice', 'Canned tomatoes']))
    await click(rowOf('Pasta').querySelector('.inc'))
    await click(rowOf('Pasta').querySelector('.inc'))
    await waitFor(() => expect(names()).toEqual(['Coffee', 'Olive oil', 'Pasta', 'Black beans', 'Rice', 'Canned tomatoes']))
    await choose($('select[name="sort"]'), 'name')
    await waitFor(() => expect(names()).toEqual(ALL))
  })

  it('adding still works (button and Enter), with the duplicate message and blank names ignored', async () => {
    await mountApp()
    await addItem('   ')
    await sleep(100)
    expect(names()).toEqual(ALL)
    await addItem(' coffee ')
    await waitFor(() => expect(textOf($('.error'))).toBe('Already in the pantry.'))
    expect(names()).toEqual(ALL)
    await typeInto($('input[name="new-item"]'), 'Honey')
    await pressKey('Enter', $('input[name="new-item"]'))
    await waitFor(() => expect(names()).toContain('Honey'))
    expect($('.error')).toBeNull()
    expect(qty('Honey')).toBe('1')
    expect(textOf(rowOf('Honey').querySelector('.min'))).toBe('min 1')
    expect($('input[name="new-item"]').value).toBe('')
    expect(summary()).toBe('7 items · 2 low')
  })

  it('removing every item leaves "Nothing here." (and Undo still works)', async () => {
    await mountApp()
    for (const name of ALL) await click(rowOf(name).querySelector('.remove'))
    await waitFor(() => expect(textOf($('.empty'))).toBe('Nothing here.'))
    expect(document.querySelectorAll('li.item')).toHaveLength(0)
    expect(summary()).toBe('0 items · 0 low')
    expect(textOf($('.notice'))).toContain('Removed Rice.')
    await click($('.notice .undo'))
    await waitFor(() => expect(names()).toEqual(['Rice']))
    expect($('.empty')).toBeNull()
    await click(rowOf('Rice').querySelector('.remove'))
    await waitFor(() => expect(textOf($('.empty'))).toBe('Nothing here.'))
    await addItem('Salt')
    await waitFor(() => expect(names()).toEqual(['Salt']))
    expect($('.empty')).toBeNull()
  })

  it('audit: no code for the tabs is left in src/ (app or tests)', () => {
    expect(leftovers([/listmode/i, /list-tabs/i, /tab-(all|low)/i, /low stock/i, /SHOW_(ALL|LOW)/])).toEqual([])
  })

  it('project: the project\'s own tests pass', () => {
    const r = runProjectTests()
    expect(r.failures).toEqual([])
    expect(r.failed).toBe(0)
    expect(r.total).toBeGreaterThanOrEqual(3)
  }, 240000)
})
