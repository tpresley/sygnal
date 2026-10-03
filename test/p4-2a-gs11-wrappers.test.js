// PLAN-4 2-A GS-11: the Vike and Astro wrappers pass the app-level onError hook to run() on the
// client and to renderToString on the server. Runs against the built files (npm run build).
import { describe, it, expect, vi, afterAll } from 'vitest'

const runs = []
vi.mock('sygnal', async (importOriginal) => ({
  ...(await importOriginal()),
  run: (component, drivers, options) => {
    runs.push({ component, drivers, options })
    return { sources: {}, sinks: {}, dispose() {} }
  },
}))

const savedWindow = globalThis.window
globalThis.window = { location: { pathname: '/' } }
afterAll(() => {
  if (savedWindow === undefined) delete globalThis.window
  else globalThis.window = savedWindow
})

const { onRenderClient } = await import('../dist/vike/onRenderClient.mjs')
const { onRenderHtml } = await import('../dist/vike/onRenderHtml.mjs')
const { default: vikeConfig } = await import('../dist/vike/config/+config.js')
const { default: astroClient } = await import('../dist/astro/client.mjs')
const { renderToStaticMarkup } = await import('../dist/astro/server.mjs')

const boom = () => { throw new Error('ssr view') }

describe('GS-11: Vike', () => {
  it('declares onError as a config on both sides', () => {
    expect(vikeConfig.meta.onError).toEqual({ env: { server: true, client: true } })
  })

  it('onRenderClient passes config.onError to run()', () => {
    const onError = () => {}
    function Page() { return { sel: 'p', data: {}, children: [], text: 'x' } }
    Page.initialState = {}
    globalThis.document = { getElementById: () => null }
    onRenderClient({ Page, config: { onError }, data: {} })
    expect(runs.at(-1).options).toMatchObject({ mountPoint: '#page-view', onError })
    delete globalThis.document
  })

  it("onRenderHtml passes config.onError to renderToString ('view')", () => {
    const onError = vi.fn()
    function Page() { return boom() }
    Page.initialState = {}
    Page.onError = () => ({ sel: 'p', data: {}, children: undefined, text: 'fallback' })
    const out = onRenderHtml({ Page, config: { onError }, data: {} })
    expect(String(out.documentHtml._escaped ?? out.documentHtml)).toContain('fallback')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toMatchObject({ componentName: 'Page', phase: 'view' })
  })
})

describe('GS-11: Astro (the island component\'s onAppError static)', () => {
  it('client: run() gets it as onError', async () => {
    const onAppError = () => {}
    function Island() { return { sel: 'p', data: {}, children: [], text: 'x' } }
    Island.initialState = {}
    Island.onAppError = onAppError
    await astroClient({ hasAttribute: () => true })(Island, {}, {}, { client: 'load' })
    expect(runs.at(-1).options).toMatchObject({ onError: onAppError })
  })

  it("server: renderToString reports to it ('view')", () => {
    const onAppError = vi.fn()
    function Island() { return boom() }
    Island.initialState = {}
    Island.onAppError = onAppError
    expect(renderToStaticMarkup(Island, {}).html).toContain('data-sygnal-error')
    expect(onAppError.mock.calls.map(c => c[1])).toEqual([{ componentName: 'Island', phase: 'view' }])
  })
})
