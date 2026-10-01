// B-027: the Vite plugin configures JSX for Vite 7 (esbuild) as well as
// Vite 8 (oxc). Runs against the built plugin (npm run build).
import { describe, it, expect } from 'vitest'
import sygnal from '../dist/vite/plugin.mjs'

const ESBUILD = { jsx: 'automatic', jsxImportSource: 'sygnal' }
const OXC = { jsx: { runtime: 'automatic', importSource: 'sygnal' } }

function configWith(meta, options, command = 'build') {
  const plugin = sygnal(options)
  return plugin.config.call({ meta }, { root: process.cwd() }, { command })
}

describe('vite plugin — JSX options per Vite version (B-027)', () => {
  it('Vite 7: sets esbuild (and oxc) JSX options', () => {
    const c = configWith({ viteVersion: '7.3.1' })
    expect(c.esbuild).toEqual(ESBUILD)
    expect(c.oxc).toEqual(OXC)
  })

  it('Vite 8: only oxc (Vite 8 warns about a plugin setting esbuild)', () => {
    for (const meta of [{ viteVersion: '8.0.3' }, { rolldownVersion: '1.0.0' }]) {
      const c = configWith(meta)
      expect(c.esbuild).toBeUndefined()
      expect(c.oxc).toEqual(OXC)
    }
  })

  it('without this.meta, reads the version of the vite the project resolves (this repo: Vite 7)', () => {
    const c = sygnal().config({ root: process.cwd() }, { command: 'build' })
    expect(c.esbuild).toEqual(ESBUILD)
  })

  it('disableJsx sets neither', () => {
    const c = configWith({ viteVersion: '7.0.0' }, { disableJsx: true })
    expect(c.esbuild).toBeUndefined()
    expect(c.oxc).toBeUndefined()
  })
})
