// PLAN-5 V-1 gate: an app that doesn't use VirtualCollection ships none of it, nor the bundled
// @tanstack/virtual-core (the host is registered by the tag's first render, not on import). Bundles
// two small apps against the build (dist/index.esm.js) with Rollup (tree-shaking; the dependencies
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

// what only the VirtualCollection module and virtual-core have
const MARKERS = ["'virtual-collection'", 'scrollToIndex', 'getVirtualIndexes', 'measureElement', 'overflowAnchor']

describe('VirtualCollection tree-shaking', () => {
  it('an app with a Collection but no VirtualCollection contains none of it (nor virtual-core)', async () => {
    const code = await bundle(`
      import { run, createElement as h, Collection } from ${JSON.stringify(entry)}
      function Item({ state }) { return h('li', null, state.t) }
      function App() { return h('ul', null, h(Collection, { of: Item, from: 'items' })) }
      App.initialState = { items: [{ id: 1, t: 'a' }] }
      run(App)
    `)
    for (const m of MARKERS) expect(code.includes(m), m).toBe(false)
  }, 30000)

  it('an app that uses it contains it', async () => {
    const code = await bundle(`
      import { run, createElement as h, VirtualCollection } from ${JSON.stringify(entry)}
      function Item({ state }) { return h('div', null, state.t) }
      function App() { return h('div', null, h(VirtualCollection, { of: Item, from: 'items', className: 'rows' })) }
      App.initialState = { items: [{ id: 1, t: 'a' }] }
      run(App)
    `)
    for (const m of MARKERS) expect(code.includes(m), m).toBe(true)
  }, 30000)
})
