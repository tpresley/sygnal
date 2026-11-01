// The tracker in a terminal: createTerminal() runs the app with no TTY; keys, pastes and mouse
// clicks go in, frames (plain text) come out. runTerminal is tested on fake TTY streams.
import { describe, it, expect, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { run, makeFetchDriver, makeTimerDriver } from 'sygnal'
import { createTerminal, runTerminal } from 'sygnal/terminal'
import Tracker, { Query } from './app.jsx'
import { fakeApi } from './api.js'
import { terminalStyles } from './styles.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
/** wait until the frame (or a function of it) passes */
async function until(term, test, ms = 1000) {
  const ok = () => (typeof test == 'function' ? test(term.frame()) : term.frame().includes(test))
  for (const end = Date.now() + ms; Date.now() < end; await tick(5)) if (ok()) return
  throw new Error('timed out; the frame:\n' + term.frame())
}
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))

function tracker({ width = 80, height = 24, latency = 5 } = {}) {
  const term = createTerminal({ styles: terminalStyles, width, height })
  const api = fakeApi({ latency })
  apps.push(run(Tracker, { DOM: term.driver, HTTP: makeFetchDriver({ fetch: api }), TERMINAL: term.control, TIMER: makeTimerDriver() }))
  return { term, api }
}
const lines = (term) => term.frame().split('\n')

describe('the issue list', () => {
  it('shows a loading state, then the list and the detail side by side, the status bar on the last row', async () => {
    const { term } = tracker()
    await tick()
    expect(term.frame()).toContain('Loading issues…')
    expect(lines(term).at(-1)).toMatch(/^Syncing…/)
    await until(term, 'Synced')
    const l = lines(term)
    expect(l).toHaveLength(24)
    expect(l[3]).toMatch(/^╭─ Issues ─+╮ ╭─+╮$/)
    expect(l[4]).toMatch(/^│• #1 L Crash when the config +█│ │ Select an issue \(j \/ k\)\. +│$/)
    expect(l.at(-1)).toBe('Synced 32 shown / 40 ↑↓ issues · → detail · 3 help')
  })

  it('j / k move the selection; the list scrolls to keep it in view; the detail follows', async () => {
    const { term } = tracker()
    await until(term, 'Synced')
    for (let i = 0; i < 20; i++) term.press('j')
    await until(term, '#24 Search ignores accents (3)')
    const l = lines(term)
    const row = l.findIndex((x) => x.includes('▸#24'))
    expect(row).toBeGreaterThan(3)
    expect(row).toBeLessThan(23)
    // scrolled: the first issue is out of view, the scrollbar's thumb moved down
    expect(term.frame()).not.toContain('#1 L Crash')
    expect(l[4]).toMatch(/│ │ #24/)
    expect(l[4]).not.toMatch(/█│ │/)
    expect(l[4]).toMatch(/│ │ #24 Search ignores accents \(3\)/)
  })

  it('the list is one Tab stop: ↑ / ↓ move in it, → or Tab go to the detail pane, ← comes back', async () => {
    const { term } = tracker()
    await until(term, 'Synced')
    expect(term.focusables().filter((e) => e.classList.contains('issue')).map((e) => e.dataset.id)).toEqual(['1'])
    term.focus('.issue')
    term.press('ArrowDown')
    term.press('ArrowDown')
    await until(term, '│ #3 Typo in the README')
    expect(term.doc.activeElement.dataset.id).toBe('3')
    term.press('ArrowRight')
    await until(term, '▸[Show description]')
    term.press('ArrowLeft')
    await tick(40)
    expect(term.doc.activeElement.dataset.id).toBe('3')
    term.press('Tab') // past the other rows: the detail's first button
    expect(term.doc.activeElement.className).toBe('more-toggle')
    term.press('Tab', { shiftKey: true })
    expect(term.doc.activeElement.dataset.id).toBe('3')
  })

  it('/ focuses the filter; typing narrows the list; the status bar counts', async () => {
    const { term } = tracker()
    await until(term, 'Synced')
    term.press('/')
    await tick()
    expect(term.doc.activeElement).toBe(term.doc.querySelector(String(Query)))
    expect(term.keyHint()).toBe('type · Tab next · Ctrl+C quit')
    // shortcuts don't fire while typing: 'n' and 'j' are letters here
    term.type('dark mode')
    await until(term, 'Synced 4 shown / 40')
    expect(term.frame()).toContain('Filter ▸[dark mode_]')
    term.press('Backspace')
    term.press('Backspace')
    term.press('Backspace')
    term.press('Backspace')
    term.press('Backspace')
    term.press('Home')
    term.type('x')
    expect(term.doc.activeElement.value).toBe('xdark')
    term.press('c', { ctrlKey: true }) // not a readline key: nothing
    term.press('k', { ctrlKey: true }) // readline: delete to the end
    expect(term.doc.activeElement.value).toBe('x')
  })

  it('the Show dropdown: Enter opens it, ↑ ↓ highlight, Enter chooses, Escape closes without a change', async () => {
    const { term } = tracker()
    await until(term, 'Synced')
    term.focus('select')
    expect(term.keyHint()).toBe('Enter open list · ←/→ change · Ctrl+C quit')
    term.press('Enter')
    await tick()
    expect(term.keyHint()).toBe('↑↓ highlight · Enter choose · Esc close · Ctrl+C quit')
    let l = lines(term)
    // the list opens under the select, over what is there
    const at = l[2].indexOf('▸[open ▴]')
    expect(l[3].slice(at)).toMatch(/^┌─+┐/)
    expect(l[4].slice(at)).toMatch(/^│▸open +✓│/)
    expect(l[5].slice(at)).toMatch(/^│ closed +│/)
    term.press('ArrowDown')
    await tick()
    expect(lines(term)[5].slice(at)).toMatch(/^│▸closed +│/)
    term.press('Escape')
    await tick()
    expect(term.frame()).toContain('Show ▸[open ▾]')
    expect(term.frame()).not.toContain('│▸closed')
    term.press(' ')
    term.press('End')
    term.press('Enter')
    await until(term, 'Synced 40 shown / 40')
    expect(term.frame()).toContain('Show ▸[all ▾]')
    // closed: ← / → and a letter change it at once
    term.press('ArrowLeft')
    await until(term, 'Synced 8 shown / 40')
    term.press('o')
    await until(term, 'Synced 32 shown / 40')
  })

  it('d asks in a modal dialog: the focus stays in it, Escape cancels, Delete deletes', async () => {
    const { term, api } = tracker()
    await until(term, 'Synced')
    term.press('j')
    term.press('j')
    term.press('d')
    await until(term, 'Delete #2?')
    // centered over the page
    const l = lines(term), y = l.findIndex((x) => x.includes('╭─ Confirm ─'))
    const x = l[y].indexOf('╭')
    expect(l[y + 1].slice(x)).toBe("│ Delete #2? This can't be undone. │                     │")
    expect(l[y + 2].slice(x)).toMatch(/^│ ▸\[Delete\] \[Cancel\] +│/)
    expect(l[y + 3].slice(x)).toMatch(/^╰─+╯/)
    expect(term.focusables().map((e) => e.className)).toEqual(['confirm-ok', 'confirm-cancel'])
    term.press('Tab')
    term.press('Tab')
    expect(term.doc.activeElement.className).toBe('confirm-ok')
    term.press('Escape')
    await until(term, (f) => !f.includes('Delete #2?'))
    // the focus is back on the row that opened it
    expect(term.doc.activeElement.dataset.id).toBe('2')
    term.press('d')
    await until(term, 'Delete #2?')
    term.press('Enter')
    await until(term, '#2 deleted')
    expect(term.frame()).not.toContain('#2 M Dark mode')
    expect(api.db.some((x) => x.id === 2)).toBe(false)
  })

  it('a mouse click selects an issue; the wheel scrolls the list', async () => {
    const { term } = tracker()
    await until(term, 'Synced')
    const l = lines(term)
    const y = l.findIndex((x) => x.includes('#3 H Typo'))
    term.click(y, l[y].indexOf('Typo'))
    await until(term, '│ #3 Typo in the README')
    expect(term.doc.activeElement.dataset.id).toBe('3')
    expect(term.wheel(10, 5, 3)).toBe(true)
    expect(term.frame()).not.toContain('#1 L Crash')
  })

  it('q quits through the TERMINAL sink', async () => {
    const { term } = tracker()
    await until(term, 'Synced')
    term.press('q')
    await tick()
    expect(term.commands).toEqual(['exit'])
  })
})

describe('the new-issue form', () => {
  it('validates, edits text with a caret, checks boxes and radios, picks from a <select>, creates', async () => {
    const { term, api } = tracker({ height: 26 })
    await until(term, 'Synced')
    term.press('2')
    await until(term, 'Title [What')
    term.focus('[name="title"]')
    term.press('Enter') // an empty submit: every error, the first invalid field focused
    await until(term, 'At least 3 characters')
    expect(term.frame()).toContain('Pick at least one label')
    expect(term.frame()).toContain('Choose someone')
    expect(term.doc.activeElement.name).toBe('title')

    term.type('Crash on save')
    term.press('ArrowLeft', { altKey: true }) // a word back
    term.press('ArrowLeft', { altKey: true })
    term.type('badly ')
    await until(term, 'Crash badly on save')
    term.press('Tab')
    term.type('Steps:\n1. open\n2. save')
    term.press('ArrowUp')
    term.press('End')
    term.type(' a file')
    await until(term, '┃1. open a file')
    expect(lines(term).filter((x) => /^┏━+┓$/.test(x))).toHaveLength(1) // the focused textarea's border
    term.press('Tab')
    term.press(' ') // bug
    term.press('Tab')
    term.press('Tab')
    term.press('Tab') // the priority radios: one stop, the checked one
    expect(term.doc.activeElement.value).toBe('medium')
    term.press('ArrowRight')
    await until(term, '( ) low ( ) medium ▸(•) high')
    term.press('Tab')
    term.press('Enter') // open the assignee list
    term.press('c') // type-ahead: chen
    term.press('Enter')
    await until(term, 'Assignee ▸[chen ▾]')
    term.press('Tab')
    term.press('Enter') // Create issue
    await until(term, '#41 created')
    expect(api.db.at(-1)).toEqual({ id: 41, title: 'Crash badly on save', body: 'Steps:\n1. open a file\n2. save', labels: ['bug'], priority: 'high', assignee: 'chen', closed: false })
    expect(term.frame()).toContain('│ #41 Crash badly on save')
  })

  it("shows the server's 422 on its field", async () => {
    const { term } = tracker({ height: 26 })
    await until(term, 'Synced')
    term.press('2')
    await until(term, 'Title [What')
    term.focus('[name="title"]')
    term.paste('Typo in the README')
    term.focus('[name="docs"]')
    term.press(' ')
    term.focus('[name="assignee"]')
    term.press('ArrowRight')
    term.press('Enter') // closed select: Enter opens it…
    term.press('Escape') // …and Escape closes it
    term.focus('button[type="submit"]')
    term.press('Enter')
    await until(term, 'An issue with this title exists')
  })
})

describe('runTerminal', () => {
  function tty() {
    const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} })
    const out = []
    const stdout = Object.assign(new EventEmitter(), { isTTY: true, columns: 60, rows: 16, write: (s) => out.push(s) })
    return { stdin, stdout, out }
  }
  it('draws in place with the key hint, buffers console output, restores the terminal on q', async () => {
    const { stdin, stdout, out } = tty()
    let exited = null
    const { terminal } = runTerminal(Tracker, {
      styles: terminalStyles, stdin, stdout, color: false,
      drivers: { HTTP: makeFetchDriver({ fetch: fakeApi({ latency: 5 }) }), TIMER: makeTimerDriver() },
      onExit: (code) => { exited = code },
    })
    expect(out[0]).toBe('\x1b[?1049h\x1b[?25l\x1b[?2004h')
    await until(terminal, 'Synced')
    await tick()
    const screen = out.at(-1)
    expect(screen.startsWith('\x1b[?2026h\x1b[H')).toBe(true)
    expect(screen.split('\r\n')).toHaveLength(16)
    expect(screen).toContain('Tab move · Ctrl+C quit\x1b[K\x1b[J\x1b[?2026l')
    console.log('from the app')
    await tick()
    expect(out.at(-1)).toContain('1 console message (shown on exit)')
    stdin.emit('data', 'q')
    await tick()
    expect(exited).toBe(0)
    expect(out.at(-1)).toBe('\x1b[?2004l\x1b[?25h\x1b[?1049l')
  })
})
