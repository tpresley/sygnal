// B-026: Astro island props reach the view the same way on the server
// (renderToString) and the client (sygnal/astro/client): spread top-level,
// the canonical `{ state, ...props }`, plus a `props` key for compatibility.
// Runs against the built files (npm run build).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runs = []
vi.mock('sygnal', () => ({
  run: (component, drivers, options) => {
    runs.push({ component, drivers, options })
    return { dispose() {} }
  },
}))
// D120: served by the integration's Vite plugin in an Astro project (no hook here)
vi.mock('virtual:sygnal/astro-on-error', () => ({ default: undefined }))

const { default: clientRenderer } = await import('../dist/astro/client.mjs')
const { renderToStaticMarkup } = await import('../dist/astro/server.mjs')

function makeComponent(view) {
  const C = (args) => { C.calls.push(args); return view(args) }
  C.calls = []
  C.initialState = { count: 0 }
  C.model = { INCREMENT: s => ({ count: s.count + 1 }) }
  return C
}

const h = (sel, text) => ({ sel, data: {}, children: undefined, text, elm: undefined, key: undefined })

beforeEach(() => { runs.length = 0 })

describe('astro island props (B-026)', () => {
  it('client: props are spread top-level, and also passed as `props`', async () => {
    const Canonical = makeComponent(({ state, title }) => h('h2', `${title}: ${state.count}`))
    const element = { hasAttribute: (a) => a === 'ssr' }
    await clientRenderer(element)(Canonical, { title: 'T', step: 2 }, {}, { client: 'load' })
    expect(runs).toHaveLength(1)
    const Wrapped = runs[0].component
    expect(Wrapped.model).toBe(Canonical.model)
    // named after the island component (run() and diagnostics use `name`)
    expect(Wrapped.name).toBe('C')
    expect(Wrapped.componentName).toBe('C')
    const vnode = Wrapped({ state: { count: 1 }, context: {}, children: [] })
    expect(vnode.text).toBe('T: 1')
    expect(Canonical.calls[0]).toMatchObject({ title: 'T', step: 2, state: { count: 1 }, props: { title: 'T', step: 2 } })
  })

  it('client: the view args (state, context) win over a prop with the same name', async () => {
    const C = makeComponent(() => h('div', ''))
    await clientRenderer({ hasAttribute: () => true })(C, { state: 'prop', title: 'x' }, {}, { client: 'load' })
    runs[0].component({ state: { count: 5 }, context: {} })
    expect(C.calls[0].state).toEqual({ count: 5 })
  })

  it('server: the canonical { state, ...props } view renders (no data-sygnal-error), and gets `props` too', () => {
    const Canonical = makeComponent(({ state, title }) => h('h2', `${title}: ${state.count}`))
    const { html } = renderToStaticMarkup(Canonical, { title: 'Plugin Smoke Test' })
    expect(html).toBe('<h2>Plugin Smoke Test: 0</h2>')
    expect(Canonical.calls[0].props).toEqual({ title: 'Plugin Smoke Test' })

    const Legacy = makeComponent(({ state, props }) => h('h2', `${props.title}: ${state.count}`))
    expect(renderToStaticMarkup(Legacy, { title: 'L' }).html).toBe('<h2>L: 0</h2>')
  })
})
