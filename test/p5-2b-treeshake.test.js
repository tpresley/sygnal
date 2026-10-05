// PLAN-5 B-3/B-4 gate: an app that doesn't use the browser driver ships none of it (0 B core);
// makeBrowserDriverWith(source) ships only that source; lazy() without when still has none of
// the browser sources, and an app without lazy() has none of B-4. Bundles small apps against the
// build (dist/index.esm.js) with Rollup (tree-shaking; dependencies external).
import { describe, it, expect } from 'vitest'
import { rollup } from 'rollup'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = path.join(root, 'dist/index.esm.js')

const bundle = async (contents) => {
  const b = await rollup({
    input: 'app',
    external: (id) => id !== 'app' && id !== entry,
    plugins: [{ name: 'app', resolveId: (id) => (id === 'app' ? id : null), load: (id) => (id === 'app' ? contents : null) }],
    onwarn: () => {},
  })
  const { output } = await b.generate({ format: 'esm' })
  await b.close()
  return output[0].code
}

// strings only one source has
const SOURCES = {
  intersectionSource: 'IntersectionObserver',
  resizeSource: 'ResizeObserver',
  mediaSource: 'matchMedia',
  storageSource: 'StorageEvent',
  visibilitySource: 'visibilitychange',
  onlineSource: "'offline'",
  geolocationSource: 'watchPosition',
  clipboardSource: 'writeText',
}
const DRIVER = ['geolocation', "'browser'", '__sygnalStatic: \'browser\'']
const WHEN = ['data-sygnal-when', 'requestIdleCallback']
const APP = `
  function App({ state }) { return h('p', null, String(state.n)) }
  App.initialState = { n: 0 }
  App.model = { X: (s) => ({ ...s, n: s.n + 1 }) }
`
const imp = (names) => `import { run, createElement as h${names ? ', ' + names : ''} } from ${JSON.stringify(entry)}\n`

describe('browser sources tree-shaking', () => {
  it('an app without the browser driver or lazy() contains none of B-3 / B-4', async () => {
    const code = await bundle(imp() + APP + 'run(App)')
    for (const m of [...Object.values(SOURCES), ...DRIVER, ...WHEN]) expect(code.includes(m), m).toBe(false)
  }, 30000)

  it('makeBrowserDriverWith(mediaSource) has only that source', async () => {
    const code = await bundle(imp('makeBrowserDriverWith, mediaSource') + APP + "App.browser = () => ({ m: { media: '(x)', action: 'X' } })\nrun(App, { BROWSER: makeBrowserDriverWith(mediaSource) })")
    expect(code.includes(SOURCES.mediaSource)).toBe(true)
    for (const [k, m] of Object.entries(SOURCES)) if (k != 'mediaSource') expect(code.includes(m), m).toBe(false)
  }, 30000)

  it('makeBrowserDriver() has every source', async () => {
    const code = await bundle(imp('makeBrowserDriver') + APP + 'run(App, { BROWSER: makeBrowserDriver() })')
    for (const m of Object.values(SOURCES)) expect(code.includes(m), m).toBe(true)
  }, 30000)

  it('lazy() brings the when code but no browser source', async () => {
    const code = await bundle(imp('lazy') + APP + "globalThis.C = lazy(() => Promise.resolve({ default: App }))\nrun(App)")
    for (const m of WHEN) expect(code.includes(m), m).toBe(true)
    for (const m of Object.values(SOURCES).filter(m => m != 'IntersectionObserver')) expect(code.includes(m), m).toBe(false)
  }, 30000)
})
