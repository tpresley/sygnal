// @vitest-environment jsdom
// PLAN-4 3-B2 item 3: persist() on Vike pages. A Page, Layout or Wrapper rendered in Vike's
// Layout/Wrapper shell is a sub-component (the shell is the app's root), so its persist is
// ignored; SYG224 says so in Vike's terms. A Page without a Layout or Wrapper is the root, and
// its persist works (and hydrates, p4-3b2-persist-hydrate.test.js).
// Runs against the built files (npm run build) with the dev entry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// each test re-imports the Vike hook (it keeps its app), the core and the dev entry together
let persist, h, getDiagnostics, clearDiagnostics

const wait = (ms) => new Promise(r => setTimeout(r, ms))
let onRenderClient
beforeEach(async () => {
  vi.resetModules()
  ;({ persist, createElement: h, getDiagnostics, clearDiagnostics } = await import('sygnal'))
  await import('sygnal/diagnostics')
  ;({ onRenderClient } = await import('../dist/vike/onRenderClient.mjs'))
  globalThis.__SYGNAL_DEV__ = true
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  clearDiagnostics()
  document.body.innerHTML = '<div id="page-view"></div>'
})
afterEach(() => {
  // the module keeps its app: a last navigation without a shell disposes it
  onRenderClient?.({ Page: () => h('p', null, 'x'), data: {}, config: {} })
  delete globalThis.__SYGNAL_DEV__
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
})

const makePage = () => {
  function TodoPage({ state }) { return h('ul', null, ...state.todos.map(x => h('li', null, x))) }
  TodoPage.initialState = { todos: [] }
  TodoPage.persist = persist({ key: 'todos', pick: ['todos'] })
  return TodoPage
}
function Layout({ children }) { return h('main', null, ...(children || [])) }
Layout.initialState = {}

describe('SYG224 in Vike terms', () => {
  it('a Page under a Layout: persist is ignored and SYG224 names Vike', async () => {
    localStorage.setItem('todos', JSON.stringify({ version: 1, state: { todos: ['stored'] } }))
    onRenderClient({ Page: makePage(), data: {}, config: { Layout } })
    await wait(60)
    expect(document.querySelector('li')).toBeNull()
    const d = getDiagnostics().find(d => d.code == 'SYG224')
    expect(d?.severity).toBe('error')
    expect(d.message).toMatch(/TodoPage/)
    expect(d.message).toMatch(/Vike/)
    expect(d.fix).toMatch(/run\(\)/)
  })

  it('a Layout with persist: SYG224 names Vike too', async () => {
    function PLayout({ children }) { return h('main', null, ...(children || [])) }
    PLayout.initialState = { open: false }
    PLayout.persist = persist({ key: 'layout' })
    function Page() { return h('p', null, 'page') }
    Page.initialState = {}
    onRenderClient({ Page, data: {}, config: { Layout: PLayout } })
    await wait(60)
    const d = getDiagnostics().find(d => d.code == 'SYG224')
    expect(d?.message).toMatch(/PLayout/)
    expect(d.message).toMatch(/Vike/)
  })

  it('a Page without a Layout or Wrapper is the root: persist works, no SYG224', async () => {
    localStorage.setItem('todos', JSON.stringify({ version: 1, state: { todos: ['stored'] } }))
    onRenderClient({ Page: makePage(), data: {}, config: {} })
    await vi.waitFor(() => expect(document.querySelector('li')?.textContent).toBe('stored'), { timeout: 2000, interval: 10 })
    expect(getDiagnostics().some(d => d.code == 'SYG224')).toBe(false)
  })
})
