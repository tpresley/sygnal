import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, waitFor, bodyText, textOf, click, typeInto, setChecked, sleep, rowOf, getByText } from './dom.js'

const SEED_ORDER = ['Beloved', 'Kindred', 'Middlemarch', 'The Remains of the Day']

const row = (title) => rowOf(title, 'input[type="checkbox"]')
const box = (title) => row(title).querySelector('input[type="checkbox"]')
const removeButton = (title) => getByText('button', 'Remove', row(title))
const titleInput = () => document.querySelector('input:not([type="checkbox"])')
const summary = () => textOf(document.querySelector('.summary'))

/** Every book row in display order: its title and whether its box is ticked. */
function listed() {
  return [...document.querySelectorAll('input[type="checkbox"]')].map((cb) => {
    const li = cb.closest('li')
    return { title: textOf(li).replace(/Finished|Remove/g, '').trim(), finished: cb.checked }
  })
}
const titles = () => listed().map((b) => b.title)

async function addBook(title) {
  await typeInto(titleInput(), title)
  await click(getByText('button', 'Add'))
}

/** Wait past the save window, then load the page again from scratch. */
async function reload() {
  await sleep(1100)
  await mountApp()
  await waitFor(() => expect(listed().length).toBeGreaterThan(0))
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(async () => {
  // Let any save still scheduled by this test's app finish before the next test clears storage.
  await sleep(700)
  localStorage.clear()
})

describe('15 fix: finishing/removing the right book, and saving every change', () => {
  it('starts with the seed books sorted by title', async () => {
    await mountApp()
    expect(titles()).toEqual(SEED_ORDER)
    expect(summary()).toBe('3 to read · 1 finished')
    expect(box('Beloved').checked).toBe(true)
  })

  it('ticking and unticking "Finished" changes only that book', async () => {
    await mountApp()
    await setChecked(box('Middlemarch'), true)
    await waitFor(() => expect(summary()).toBe('2 to read · 2 finished'))
    await sleep(100)
    expect(listed()).toEqual([
      { title: 'Beloved', finished: true },
      { title: 'Kindred', finished: false },
      { title: 'Middlemarch', finished: true },
      { title: 'The Remains of the Day', finished: false },
    ])

    await setChecked(box('Beloved'), false)
    await waitFor(() => expect(summary()).toBe('3 to read · 1 finished'))
    await sleep(100)
    expect(box('Beloved').checked).toBe(false)
    expect(box('Middlemarch').checked).toBe(true)
    expect(box('Kindred').checked).toBe(false)
  })

  it('"Remove" removes only that book', async () => {
    await mountApp()
    await click(removeButton('Kindred'))
    await waitFor(() => expect(titles()).toEqual(['Beloved', 'Middlemarch', 'The Remains of the Day']))
    await waitFor(() => expect(summary()).toBe('2 to read · 1 finished'))

    await click(removeButton('The Remains of the Day'))
    await waitFor(() => expect(titles()).toEqual(['Beloved', 'Middlemarch']))
    expect(summary()).toBe('1 to read · 1 finished')
    expect(box('Beloved').checked).toBe(true)
  })

  it('added books are sorted in and can be finished and removed', async () => {
    await mountApp()
    await addBook('Anna Karenina')
    await waitFor(() => expect(titles()).toEqual(['Anna Karenina', ...SEED_ORDER]))
    expect(titleInput().value).toBe('')
    await setChecked(box('Anna Karenina'), true)
    await waitFor(() => expect(summary()).toBe('3 to read · 2 finished'))
    await sleep(100)
    expect(box('Beloved').checked).toBe(true)
    expect(box('Kindred').checked).toBe(false)
    await click(removeButton('Anna Karenina'))
    await waitFor(() => expect(titles()).toEqual(SEED_ORDER))
    expect(summary()).toBe('3 to read · 1 finished')
  })

  it('a single change survives a reload', async () => {
    await mountApp()
    await setChecked(box('Kindred'), true)
    await waitFor(() => expect(summary()).toBe('2 to read · 2 finished'))
    const before = listed()
    await reload()
    expect(listed()).toEqual(before)
    expect(summary()).toBe('2 to read · 2 finished')
  })

  it('changes made in quick succession all survive a reload', async () => {
    await mountApp()
    await addBook('Anna Karenina')
    await addBook('Zami')
    await waitFor(() => expect(titles()).toContain('Zami'))
    const before = listed()
    expect(before.map((b) => b.title)).toEqual(['Anna Karenina', ...SEED_ORDER, 'Zami'])
    await reload()
    expect(listed()).toEqual(before)
  })

  it('a burst of finishing and removing is saved completely, and so is a later change', async () => {
    await mountApp()
    await setChecked(box('Kindred'), true)
    await click(removeButton('Beloved'))
    await setChecked(box('Middlemarch'), true)
    await waitFor(() => expect(summary()).toBe('1 to read · 2 finished'))
    const before = listed()
    expect(before).toEqual([
      { title: 'Kindred', finished: true },
      { title: 'Middlemarch', finished: true },
      { title: 'The Remains of the Day', finished: false },
    ])
    await reload()
    expect(listed()).toEqual(before)

    await setChecked(box('The Remains of the Day'), true)
    await waitFor(() => expect(summary()).toBe('0 to read · 3 finished'))
    await reload()
    expect(summary()).toBe('0 to read · 3 finished')
    expect(listed().every((b) => b.finished)).toBe(true)
    expect(bodyText()).not.toContain('Beloved')
  })
})
