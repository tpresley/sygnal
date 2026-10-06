import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mountApp, waitFor, pressKey, setChecked, textOf, sleep } from './dom.js'

// jsdom has no layout. Each song's `li` gets a 300 x 40 px box at its place in the list
// (everything inside a song shares its box; the list's box holds them all), and there is a
// no-op scrollIntoView and a ResizeObserver that never reports.
const TOP = 100
const H = 40
beforeAll(() => {
  const rect = Element.prototype.getBoundingClientRect
  const box = (top, height) => ({ x: 0, y: top, top, left: 0, width: 300, height, right: 300, bottom: top + height, toJSON() {} })
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const list = this.closest?.('ul.playlist')
    if (!list) return rect.call(this)
    // (a Sygnal Collection puts its items in a wrapper div: ul > div > li)
    const songs = [...list.querySelectorAll('li')]
    if (this === list) return box(TOP, songs.length * H)
    const li = songs.find((s) => s === this || s.contains(this))
    return li ? box(TOP + songs.indexOf(li) * H, H) : rect.call(this)
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = function scrollIntoView() {}
  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

beforeEach(async () => {
  await mountApp()
})

const SONGS = ['Yesterday', 'Blackbird', 'Something', 'Penny Lane', 'Help!']
const CODES = { ' ': 'Space', Enter: 'Enter', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown' }

/** The accessible name: aria-labelledby, else aria-label, else the associated <label>s, else (buttons) the text. */
function accessibleName(el) {
  const by = el.getAttribute('aria-labelledby')
  if (by) return by.trim().split(/\s+/).map((id) => textOf(document.getElementById(id) ?? document.createElement('i'))).join(' ').trim()
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  const labels = [...(el.labels ?? [])].map((l) => textOf(l)).join(' ').trim()
  return labels || (el.tagName === 'BUTTON' ? textOf(el) : '')
}

const songs = () => [...document.querySelectorAll('ul.playlist li')]
const order = () => songs().map((li) => SONGS.find((t) => textOf(li).includes(t)))
function handle(title) {
  const found = [...document.querySelectorAll('ul.playlist button, ul.playlist [role="button"]')].filter((b) => accessibleName(b) === `Reorder ${title}`)
  expect(found.length, `one handle named "Reorder ${title}"`).toBe(1)
  return found[0]
}
function favorite(title) {
  const found = [...document.querySelectorAll('ul.playlist input[type="checkbox"]')].filter((b) => accessibleName(b) === `Favorite ${title}`)
  expect(found.length).toBe(1)
  return found[0]
}
const liveTexts = () => [...document.querySelectorAll('[aria-live]')].map(textOf)

/** Press a key on the focused element, with `key` and `code` like a browser. */
const press = (key) => pressKey(key, document.activeElement || document.body, { code: CODES[key] })

async function keys(title, ...sequence) {
  handle(title).focus()
  for (const key of sequence) await press(key)
}

async function expectAnnounced(text) {
  await waitFor(() => expect(liveTexts().some((t) => t.includes(text)), `a live region says "${text}" (live: ${JSON.stringify(liveTexts())})`).toBe(true))
}

describe('34 sortable playlist: keyboard moves, announcements, focus', () => {
  it('gives every song a named handle described by keyboard instructions, and a live region', async () => {
    expect(order()).toEqual(SONGS)
    for (const title of SONGS) {
      // checked once the handle has focus, when a screen reader reads the description
      handle(title).focus()
      await sleep(60)
      const h = handle(title)
      const ids = (h.getAttribute('aria-describedby') || '').trim().split(/\s+/).filter(Boolean)
      expect(ids.length, `"Reorder ${title}" has aria-describedby`).toBeGreaterThan(0)
      const text = ids.map((id) => textOf(document.getElementById(id) ?? document.createElement('i'))).join(' ')
      expect(text).toContain('Space')
    }
    expect(document.querySelectorAll('[aria-live]').length).toBeGreaterThan(0)
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })

  it('Space picks a song up, the arrows move it, Space drops it, and focus stays on its handle', async () => {
    await keys('Yesterday', ' ', 'ArrowDown', 'ArrowDown', ' ')
    await waitFor(() => expect(order()).toEqual(['Blackbird', 'Something', 'Yesterday', 'Penny Lane', 'Help!']))
    await expectAnnounced('Dropped Yesterday at position 3 of 5.')
    await waitFor(() => expect(document.activeElement).toBe(handle('Yesterday')))
  })

  it('Enter works too, and ArrowUp moves a song up', async () => {
    await keys('Penny Lane', 'Enter', 'ArrowUp', 'ArrowUp', 'Enter')
    await waitFor(() => expect(order()).toEqual(['Yesterday', 'Penny Lane', 'Blackbird', 'Something', 'Help!']))
    await expectAnnounced('Dropped Penny Lane at position 2 of 5.')
    await waitFor(() => expect(document.activeElement).toBe(handle('Penny Lane')))

    await keys('Something', ' ', 'ArrowUp', ' ')
    await waitFor(() => expect(order()).toEqual(['Yesterday', 'Penny Lane', 'Something', 'Blackbird', 'Help!']))
    await expectAnnounced('Dropped Something at position 3 of 5.')
  })

  it('Escape puts the song back where it was picked up', async () => {
    await keys('Something', ' ', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'Escape')
    await expectAnnounced('Cancelled. Something is back at position 3 of 5.')
    await waitFor(() => expect(order()).toEqual(SONGS))
    await waitFor(() => expect(document.activeElement).toBe(handle('Something')))

    await keys('Blackbird', ' ', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Escape')
    await expectAnnounced('Cancelled. Blackbird is back at position 2 of 5.')
    await waitFor(() => expect(order()).toEqual(SONGS))
  })

  it('a song stays put at either end of the list', async () => {
    await keys('Help!', ' ', 'ArrowDown', 'ArrowDown', ' ')
    await expectAnnounced('Dropped Help! at position 5 of 5.')
    expect(order()).toEqual(SONGS)
    await keys('Yesterday', ' ', 'ArrowUp', ' ')
    await expectAnnounced('Dropped Yesterday at position 1 of 5.')
    expect(order()).toEqual(SONGS)
  })

  it('a song keeps its Favorite state when it moves, over several moves', async () => {
    await setChecked(favorite('Blackbird'), true)
    await keys('Blackbird', ' ', 'ArrowDown', 'ArrowDown', 'ArrowDown', ' ')
    await waitFor(() => expect(order()).toEqual(['Yesterday', 'Something', 'Penny Lane', 'Help!', 'Blackbird']))
    expect(favorite('Blackbird').checked).toBe(true)
    for (const t of ['Yesterday', 'Something', 'Penny Lane', 'Help!']) expect(favorite(t).checked).toBe(false)

    await keys('Help!', 'Enter', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'Enter')
    await waitFor(() => expect(order()).toEqual(['Help!', 'Yesterday', 'Something', 'Penny Lane', 'Blackbird']))
    await expectAnnounced('Dropped Help! at position 1 of 5.')
    expect(favorite('Blackbird').checked).toBe(true)
    expect(favorite('Help!').checked).toBe(false)
  })
})
