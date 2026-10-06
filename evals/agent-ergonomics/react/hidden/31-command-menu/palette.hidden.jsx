import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mountApp, waitFor, click, typeInto, pressKey, textOf, bodyText } from './dom.js'

// jsdom has no layout: give it the no-op scrollIntoView and a ResizeObserver that never reports.
beforeAll(() => {
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

const ALL = ['New file', 'Open file…', 'Save', 'Save as…', 'Open settings', 'Toggle dark mode', 'Show keyboard shortcuts', 'Sign out']

/** The accessible name: aria-labelledby, else aria-label, else the associated <label>s. */
function accessibleName(el) {
  const by = el.getAttribute('aria-labelledby')
  if (by) return by.trim().split(/\s+/).map((id) => textOf(document.getElementById(id) ?? document.createElement('i'))).join(' ').trim()
  const label = el.getAttribute('aria-label')
  if (label && label.trim()) return label.trim()
  return [...(el.labels ?? [])].map((l) => textOf(l)).join(' ').trim()
}

const palette = () => document.querySelector('section.palette')
function search() {
  const found = [...palette().querySelectorAll('input')].filter((el) => accessibleName(el) === 'Search commands')
  if (found.length !== 1) throw new Error(`expected one field named "Search commands", found ${found.length}`)
  return found[0]
}

const shown = (el) => {
  for (let e = el; e; e = e.parentElement) if (e.hidden || e.style?.display === 'none') return false
  return true
}
function listbox() {
  const id = search().getAttribute('aria-controls')
  expect(id, 'the field has aria-controls').toBeTruthy()
  const el = document.getElementById(id)
  expect(el, `aria-controls="${id}" points at an element`).toBeTruthy()
  expect(el.getAttribute('role')).toBe('listbox')
  return el
}
const options = () => [...listbox().querySelectorAll('[role="option"]')].filter(shown)
const labels = () => options().map(textOf)
/** The active command: the one shown option with aria-selected="true" (null when none is). */
function active() {
  const selected = options().filter((o) => o.getAttribute('aria-selected') === 'true')
  expect(selected.length, 'at most one active option').toBeLessThanOrEqual(1)
  return selected[0] ? textOf(selected[0]) : null
}
const lastCommand = () => textOf(document.querySelector('.last-command'))

async function type(text) {
  await typeInto(search(), text)
}
const key = (k) => pressKey(k, search())

describe('31 command palette: filtering, keyboard, running commands', () => {
  it('is a combobox controlling a listbox of every command, the first one active', async () => {
    expect(search().getAttribute('role')).toBe('combobox')
    expect(labels()).toEqual(ALL)
    expect(active()).toBe('New file')
    expect(lastCommand()).toBe('No command run yet.')
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })

  it('shows the commands containing the text, ignoring case and spaces, in their own order', async () => {
    await type('save')
    expect(labels()).toEqual(['Save', 'Save as…'])
    await type('  SETTINGS ')
    expect(labels()).toEqual(['Open settings'])
    await type('sa')
    expect(labels()).toEqual(['Save', 'Save as…'])
    await type('e')
    expect(labels()).toEqual(['New file', 'Open file…', 'Save', 'Save as…', 'Open settings', 'Toggle dark mode', 'Show keyboard shortcuts'])
    await type('open')
    expect(labels()).toEqual(['Open file…', 'Open settings'])
    await type('   ')
    expect(labels()).toEqual(ALL)
  })

  it('moves the active command with the arrow keys, wrapping, while focus stays in the field', async () => {
    await type('o')
    expect(labels()).toEqual(['Open file…', 'Open settings', 'Toggle dark mode', 'Show keyboard shortcuts', 'Sign out'])
    expect(active()).toBe('Open file…')
    await key('ArrowDown')
    await key('ArrowDown')
    expect(active()).toBe('Toggle dark mode')
    await key('ArrowUp')
    expect(active()).toBe('Open settings')
    await key('ArrowUp')
    await key('ArrowUp')
    expect(active()).toBe('Sign out')
    await key('ArrowDown')
    expect(active()).toBe('Open file…')
    expect(document.activeElement).toBe(search())
  })

  it('makes the first match active again whenever the text changes', async () => {
    await type('s')
    expect(active()).toBe('Save')
    await key('ArrowDown')
    await key('ArrowDown')
    expect(active()).toBe('Open settings')
    await type('sh')
    expect(labels()).toEqual(['Show keyboard shortcuts'])
    expect(active()).toBe('Show keyboard shortcuts')
    await type('s')
    expect(active()).toBe('Save')

    await type('o')
    await key('ArrowDown')
    await key('ArrowDown')
    expect(active()).toBe('Toggle dark mode')
    await type('op')
    expect(labels()).toEqual(['Open file…', 'Open settings'])
    expect(active()).toBe('Open file…')
  })

  it('Enter runs the active command, clears the field and keeps focus there', async () => {
    await type('set')
    await key('Enter')
    await waitFor(() => expect(lastCommand()).toBe('Ran: Open settings'))
    expect(search().value).toBe('')
    expect(labels()).toEqual(ALL)
    expect(active()).toBe('New file')
    expect(document.activeElement).toBe(search())

    await key('ArrowUp')
    await key('Enter')
    await waitFor(() => expect(lastCommand()).toBe('Ran: Sign out'))
  })

  it('clicking a command runs it', async () => {
    await type('dark')
    const option = options().find((o) => textOf(o) === 'Toggle dark mode')
    await click(option)
    await waitFor(() => expect(lastCommand()).toBe('Ran: Toggle dark mode'))
    expect(search().value).toBe('')
    expect(labels()).toEqual(ALL)

    await click(options()[3])
    await waitFor(() => expect(lastCommand()).toBe('Ran: Save as…'))
  })

  it('shows "No commands found." when nothing matches, and Enter then does nothing', async () => {
    await type('zzz')
    expect(labels()).toEqual([])
    expect(bodyText()).toContain('No commands found.')
    await key('Enter')
    expect(lastCommand()).toBe('No command run yet.')
    expect(search().value).toBe('zzz')

    await type('sign')
    expect(labels()).toEqual(['Sign out'])
    expect(bodyText()).not.toContain('No commands found.')
    expect(active()).toBe('Sign out')
  })

  it('Escape clears the field without running anything', async () => {
    await type('sav')
    await key('ArrowDown')
    expect(active()).toBe('Save as…')
    await key('Escape')
    expect(search().value).toBe('')
    expect(labels()).toEqual(ALL)
    expect(active()).toBe('New file')
    expect(lastCommand()).toBe('No command run yet.')
    expect(document.activeElement).toBe(search())
  })
})
