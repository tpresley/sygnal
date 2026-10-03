// @vitest-environment jsdom
// PLAN-4 3-E (GS-10): the extension panel's action log view and "Copy as test" button
// (devtools/panel.html + panel.js), loaded into jsdom with a stub of the chrome extension API.
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'devtools')
const PAGE = '__SYGNAL_DEVTOOLS_PAGE__'

let panel, deliver
const sent = []
const copied = []

beforeAll(() => {
  const html = fs.readFileSync(path.join(DIR, 'panel.html'), 'utf8')
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'))
  globalThis.chrome = {
    runtime: {
      connect: () => ({
        postMessage: (m) => sent.push(m),
        onMessage: { addListener: (fn) => { deliver = (type, payload) => fn({ source: PAGE, type, payload }) } },
        onDisconnect: { addListener() {} },
      }),
    },
    devtools: { inspectedWindow: { tabId: 1 } },
  }
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t) } }, configurable: true })
  ;(0, eval)(fs.readFileSync(path.join(DIR, 'panel.js'), 'utf8') + '\n;globalThis.__sygnalPanel = panel')
  panel = globalThis.__sygnalPanel
})

const act = (seq, type, extra = {}) => ({ seq, type, component: 'App', instance: '1', parent: null, sinks: [], cause: 'intent', at: seq * 10, ...extra })
const rows = () => [...document.querySelectorAll('#actions-list .action-entry')]
const text = (el) => el.querySelector('.event-type').textContent

describe('DevTools panel: Actions view (PLAN-4 3-E)', () => {
  it('lists the actions newest first, hides built-in ones, and filters by component and type', () => {
    deliver('ACTIONS_RESET', { actions: [
      act(1, 'INITIALIZE', { cause: 'built-in', sinks: ['STATE'] }),
      act(2, 'ADD', { data: { type: 'click' }, sinks: ['STATE'], before: { n: 0 }, after: { n: 1 } }),
      act(3, 'TOGGLE', { component: 'Item', instance: '2', parent: '1' }),
    ] })
    document.getElementById('view-actions-btn').click()
    expect(document.getElementById('actions-container').style.display).toBe('')
    expect(document.getElementById('history-container').style.display).toBe('none')
    expect(rows().map(text)).toEqual(['TOGGLE', 'ADD'])
    expect(document.getElementById('actions-count').textContent).toBe('2/3')
    expect(rows()[1].querySelector('.action-cause').textContent).toBe('intent')
    expect(rows()[1].querySelector('.history-component').textContent).toBe('App#1')

    const builtin = document.getElementById('actions-show-builtin')
    builtin.checked = true
    builtin.dispatchEvent(new Event('change'))
    expect(rows().map(text)).toEqual(['TOGGLE', 'ADD', 'INITIALIZE'])

    const select = document.getElementById('actions-component')
    expect([...select.options].map(o => o.value)).toEqual(['', 'App', 'Item'])
    select.value = 'Item'
    select.dispatchEvent(new Event('change'))
    expect(rows().map(text)).toEqual(['TOGGLE'])
    select.value = ''
    select.dispatchEvent(new Event('change'))

    const filter = document.getElementById('actions-type-filter')
    filter.value = 'ad'
    filter.dispatchEvent(new Event('input'))
    expect(rows().map(text)).toEqual(['ADD'])
    filter.value = ''
    filter.dispatchEvent(new Event('input'))
  })

  it('updates a known action (sinks fill in later) and appends new ones', () => {
    deliver('ACTIONS', { actions: [act(3, 'TOGGLE', { component: 'Item', instance: '2', sinks: ['STATE'], before: { done: false }, after: { done: true } }), act(4, 'SAVED', { cause: 'reply' })] })
    expect(panel.actions.map(a => a.seq)).toEqual([1, 2, 3, 4])
    expect(rows().map(text)).toEqual(['SAVED', 'TOGGLE', 'ADD', 'INITIALIZE'])
    expect(rows()[1].querySelector('.action-sinks').textContent).toBe('→ STATE')
  })

  it('shows the state before/after an action, or the action when it changed no state', () => {
    rows().find(r => text(r) === 'TOGGLE').click()
    expect(document.getElementById('inspector-title').textContent).toBe('TOGGLE on Item#2 (state before → after)')
    expect(document.getElementById('inspector-content').textContent).toMatch(/done/)
    expect(rows().find(r => text(r) === 'TOGGLE').classList.contains('clicked')).toBe(true)
    rows().find(r => text(r) === 'SAVED').click()
    expect(document.getElementById('inspector-title').textContent).toBe('SAVED on App#1 (reply; no state change)')
  })

  it('"Copy as test" asks the page for the session, shows and copies the code', async () => {
    sent.length = 0
    panel.selectedId = null
    document.getElementById('copy-test-btn').click()
    expect(sent).toEqual([{ type: 'COPY_AS_TEST', payload: { instance: undefined } }])
    deliver('COPY_AS_TEST_RESULT', { code: "it('x', async () => {})\n", complete: false, warnings: ['no final-state assertion: because'], replayed: 1 })
    await Promise.resolve()
    expect(document.getElementById('copy-test-dialog').style.display).toBe('')
    expect(document.getElementById('copy-test-code').value).toBe("it('x', async () => {})\n")
    expect(document.getElementById('copy-test-title').textContent).toBe('Copy as test (no final-state assertion)')
    expect(document.getElementById('copy-test-warnings').textContent).toBe('no final-state assertion: because')
    expect(copied).toEqual(["it('x', async () => {})\n"])
    document.getElementById('copy-test-close').click()
    expect(document.getElementById('copy-test-dialog').style.display).toBe('none')

    // the selected component's session
    panel.selectedId = 2
    document.getElementById('copy-test-btn').click()
    expect(sent.at(-1)).toEqual({ type: 'COPY_AS_TEST', payload: { instance: '2' } })
    deliver('COPY_AS_TEST_RESULT', { error: 'no live component instance matches' })
    expect(document.getElementById('copy-test-title').textContent).toBe('Copy as test: nothing to copy')
  })

  it('Clear in the Actions view starts a new session on the page', () => {
    sent.length = 0
    document.getElementById('clear-history-btn').click()
    expect(sent).toEqual([{ type: 'CLEAR_ACTIONS', payload: {} }])
    expect(rows()).toEqual([])
    expect(document.getElementById('actions-list').textContent).toBe('No actions yet')
  })
})
