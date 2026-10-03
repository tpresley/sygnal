// @vitest-environment jsdom
// PLAN-4 3-A (GS-2): element commands under run() (the core path, no renderComponent), with the
// 'sygnal/diagnostics' dev entry reporting SYG640/SYG641 through the core bridge, and without it
// (production: a failed command does nothing and prints nothing).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement as h } from '../src/pragma/index.js'
import { controls } from '../src/extra/controls.js'
import run from '../src/extra/run.js'
import { getDiagnostics, clearDiagnostics, _resetDiagnostics } from '../src/extra/diagnostics/index.js'
import { installChecks } from '../src/extra/diagnostics/checks/index.js'

const settle = (ms = 60) => new Promise(r => setTimeout(r, ms))
let app
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
  clearDiagnostics()
  vi.restoreAllMocks()
})

const { Search, Go, Typo, Gone } = controls({ Search: 'input', Go: 'button', Typo: 'button', Gone: 'button' })
function App({ state }) {
  return h('div', null, h(Search, { value: state.q }), h(Go, null, 'Go'), h(Typo, null, 'T'), h(Gone, null, 'G'))
}
App.initialState = { q: '' }
App.intent = ({ DOM }) => ({ GO: DOM.click(Go), TYPO: DOM.click(Typo), GONE: DOM.click(Gone) })
App.model = {
  GO: { ELEMENT: { focus: Search } },
  TYPO: { ELEMENT: { focuss: Search } },
  GONE: { ELEMENT: { focus: '.nowhere' } },
}

const mount = () => {
  document.body.innerHTML = '<div id="root"></div>'
  app = run(App, {}, { mountPoint: '#root', diagnostics: 'collect' })
}

describe('run() with the dev entry', () => {
  it('focuses, and reports SYG641 and SYG640 through the bridge', async () => {
    mount()
    await settle()
    document.querySelector(`${Go}`).click()
    await settle(40)
    expect(document.activeElement).toBe(document.querySelector(`${Search}`))
    document.querySelector(`${Typo}`).click()
    await settle(40)
    expect(getDiagnostics().map(d => d.code)).toEqual(['SYG641'])
    document.querySelector(`${Gone}`).click()
    await settle(1100)
    expect(getDiagnostics().map(d => d.code)).toEqual(['SYG641', 'SYG640'])
    expect(getDiagnostics()[1].message).toMatch(/matched no element: nothing in App's own view matches '\.nowhere'/)
  })

  it('ELEMENT needs no driver: no SYG609', async () => {
    mount()
    await settle()
    expect(getDiagnostics().map(d => d.code)).not.toContain('SYG609')
  })
})

describe('run() without the dev entry (production)', () => {
  it('a failed command does nothing and prints nothing', async () => {
    const uninstall = installChecks()
    uninstall()
    _resetDiagnostics()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    document.body.innerHTML = '<div id="root"></div>'
    app = run(App, {}, { mountPoint: '#root' })
    await settle()
    document.querySelector(`${Typo}`).click()
    document.querySelector(`${Go}`).click()
    await settle(40)
    expect(document.activeElement).toBe(document.querySelector(`${Search}`))
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })
})
