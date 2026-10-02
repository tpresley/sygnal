// The built 'sygnal/diagnostics' entry: importable, shares the core of the
// built 'sygnal' package, and its check code is NOT in the main bundle.
// (Runs against dist/, like the examples' tests: `npm run build` first.)
import { describe, it, expect, vi, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dist = (file) => fileURLToPath(new URL(`../../dist/${file}`, import.meta.url))

if (typeof globalThis.window === 'undefined') globalThis.window = undefined

describe("'sygnal/diagnostics' build entry", () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  afterAll(() => warn.mockRestore())

  it('is importable and registers its checks with the main bundle core', async () => {
    globalThis.__SYGNAL_DEV__ = true // dist 'sygnal' resolves the mode at load: 'warn'
    const sygnal = await import('sygnal')
    const checks = await import('sygnal/diagnostics')
    delete globalThis.__SYGNAL_DEV__

    expect(typeof checks.checkEventBus).toBe('function')
    expect(checks.listCodes().map(c => c.code)).toEqual(
      expect.arrayContaining(['SYG101', 'SYG102', 'SYG103', 'SYG104', 'SYG105', 'SYG106', 'SYG201', 'SYG202', 'SYG301', 'SYG401']))
    expect(checks.getCodeInfo('SYG104').title).toMatch(/isolation boundary/)

    function App() { return sygnal.createElement('div', null, 'x') }
    App.intent = ({ DOM }) => ({ ORPHAN: DOM.select('.x').events('click') })
    App.model = {}
    const t = sygnal.renderComponent(App)
    await new Promise(r => setTimeout(r, 30))
    t.dispose()
    const found = sygnal.getDiagnostics().filter(d => d.code === 'SYG101')
    expect(found).toHaveLength(1)
    expect(found[0].data.action).toBe('ORPHAN')
  })

  it('reports the dev-only codes (G-143) with their own severity, which the main bundle does not carry', async () => {
    const sygnal = await import('sygnal')
    const checks = await import('sygnal/diagnostics')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {}) // 'warn' mode (resolved at load) prints errors
    function App() { return sygnal.createElement('div', null, 'x') }
    App.initialState = { city: '' }
    App.intent = ({ DOM }) => ({ GO: DOM.select('.go').events('click'), KEY: DOM.key('.go') })
    App.model = { GO: sygnal.set('city'), KEY: s => s }
    const t = sygnal.renderComponent(App, { mockConfig: { '.go': { click: (await import('xstream')).default.periodic(10).take(1).mapTo('Paris') } } })
    await new Promise(r => setTimeout(r, 30))
    t.dispose()
    const found = Object.fromEntries(sygnal.getDiagnostics().map(d => [d.code, d.severity]))
    expect(found.SYG221).toBe('error')
    expect(found.SYG115).toBe('warn')
    expect(checks.getCodeInfo('SYG421').severity).toBe('error')
    err.mockRestore()
  })

  it('keeps the check code out of the main bundle', () => {
    const main = readFileSync(dist('index.esm.js'), 'utf8')
    const entry = readFileSync(dist('diagnostics.esm.js'), 'utf8')
    for (const marker of ['has not matched any element', 'is an RxJS operator', 'likely a missing ...state spread',
      'is not a DOM event', 'one per character of', "with no string 'type'", 'Unknown DOM event shorthand']) {
      expect(entry).toContain(marker)
      expect(main).not.toContain(marker)
    }
    expect(entry).toMatch(/^import 'sygnal';$/m) // shares the main bundle's diagnostics core
  })
})
