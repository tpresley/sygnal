// PLAN-4 2-A GS-11: the Vike and Astro wrappers pass the app-level onError hook to run() on the
// client and to renderToString on the server. Runs against the built files (npm run build).
// 2-A2 (D120): Astro's hook is the integration's `onError` option, a module path loaded through
// the virtual module `virtual:sygnal/astro-on-error` by both island entries.
import { describe, it, expect, vi, afterAll } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const runs = []
vi.mock('sygnal', async (importOriginal) => ({
  ...(await importOriginal()),
  run: (component, drivers, options) => {
    runs.push({ component, drivers, options })
    return { sources: {}, sinks: {}, dispose() {} }
  },
}))

// the module the integration's onError option names (the virtual module re-exports its default)
const astroHook = vi.hoisted(() => ({ fn: undefined }))
vi.mock('virtual:sygnal/astro-on-error', () => ({ default: (...a) => astroHook.fn(...a) }))

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
const { default: sygnalAstro } = await import('../dist/astro/index.mjs')

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

describe("GS-11 / D120: Astro (the integration's onError module)", () => {
  it("client: run() gets the module's default export as onError (an onAppError static is ignored)", async () => {
    astroHook.fn = vi.fn()
    const onAppError = vi.fn()
    function Island() { return { sel: 'p', data: {}, children: [], text: 'x' } }
    Island.initialState = {}
    Island.onAppError = onAppError
    await astroClient({ hasAttribute: () => true })(Island, {}, {}, { client: 'load' })
    const { onError } = runs.at(-1).options
    expect(typeof onError).toBe('function')
    onError(new Error('e'), { componentName: 'Island', phase: 'view' })
    expect(astroHook.fn).toHaveBeenCalledTimes(1)
    expect(onAppError).not.toHaveBeenCalled()
  })

  it("server: renderToString reports to it ('view')", () => {
    astroHook.fn = vi.fn()
    const onAppError = vi.fn()
    function Island() { return boom() }
    Island.initialState = {}
    Island.onAppError = onAppError
    expect(renderToStaticMarkup(Island, {}).html).toContain('data-sygnal-error')
    expect(astroHook.fn.mock.calls.map(c => c[1])).toEqual([{ componentName: 'Island', phase: 'view' }])
    expect(onAppError).not.toHaveBeenCalled()
  })

  const viteOf = (options, command = 'build', root = pathToFileURL(path.resolve('/proj') + '/')) => {
    let vite
    sygnalAstro(options).hooks['astro:config:setup']({ addRenderer() {}, updateConfig(c) { vite = c.vite }, command, config: { root } })
    return vite
  }
  const virtualOf = (vite) => {
    const p = vite.plugins.find(p => p.name === 'sygnal:astro-on-error')
    const id = p.resolveId('virtual:sygnal/astro-on-error')
    return { id, code: p.load(id) }
  }

  it('the integration serves the virtual module: the option resolved against the project root, in dev and build', () => {
    for (const command of ['dev', 'build']) {
      const { id, code } = virtualOf(viteOf({ onError: './src/onError.js' }, command))
      expect(id).toBe('\0virtual:sygnal/astro-on-error')
      expect(code).toBe(`export { default } from ${JSON.stringify(path.resolve('/proj/src/onError.js'))}`)
    }
    // an absolute path is kept
    expect(virtualOf(viteOf({ onError: path.resolve('/abs/hook.ts') })).code).toContain(JSON.stringify(path.resolve('/abs/hook.ts')))
  })

  it('without the option the virtual module exports undefined (no hook)', () => {
    expect(virtualOf(viteOf({})).code).toBe('export default undefined')
    expect(virtualOf(viteOf(undefined, 'dev')).code).toBe('export default undefined')
  })

  it('keeps the island entries on Vite: the virtual id is not pre-bundled, sygnal is not externalized for SSR', () => {
    const vite = viteOf({ onError: './x.js' })
    expect(vite.optimizeDeps.exclude).toContain('virtual:sygnal/astro-on-error')
    expect(vite.ssr.noExternal).toContain('sygnal')
    // Vite 6+ environments (Astro 6 prerenders in its own): every server environment
    const p = vite.plugins.find(p => p.name === 'sygnal:astro-on-error')
    for (const env of ['ssr', 'prerender', 'astro']) expect(p.configEnvironment(env).resolve.noExternal).toEqual(['sygnal'])
    expect(p.configEnvironment('client')).toBeUndefined()
  })
})
