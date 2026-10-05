// PLAN-5 W-1 gate: an app that doesn't use defineWidget ships none of it (the widget module and
// its marker handler are registered by the first defineWidget() call, not on import). Bundles two
// small apps against the build (dist/index.esm.js) with Rollup (tree-shaking; the dependencies
// external), as a production app would.
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

// what only the widget module has: the marker's sel / kind, the SSR hook, the marker data keys
const WIDGET_MARKERS = ["'widget'", '$ssr', 'ww: w', 'wp: p']

describe('defineWidget tree-shaking', () => {
  it('an app without defineWidget contains none of the widget module', async () => {
    const code = await bundle(`
      import { run, createElement as h, controls } from ${JSON.stringify(entry)}
      const { Add } = controls({ Add: 'button' })
      function App({ state }) { return h('div', null, h(Add, null, 'add'), h('p', null, String(state.n))) }
      App.initialState = { n: 0 }
      App.intent = ({ DOM }) => ({ ADD: DOM.click(Add) })
      App.model = { ADD: (s) => ({ n: s.n + 1 }), FOCUS: { ELEMENT: { focus: Add } } }
      run(App)
    `)
    for (const m of WIDGET_MARKERS) expect(code.includes(m), m).toBe(false)
  }, 30000)

  it('an app that uses it contains it', async () => {
    const code = await bundle(`
      import { run, createElement as h, defineWidget } from ${JSON.stringify(entry)}
      const W = defineWidget({ mount: (el) => ({}), events: ['pick'] })
      function App() { return h('div', null, h(W, { className: 'w' })) }
      App.initialState = {}
      run(App)
    `)
    for (const m of WIDGET_MARKERS) expect(code.includes(m), m).toBe(true)
  }, 30000)
})
