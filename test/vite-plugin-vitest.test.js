// The Vite plugin under Vitest (Phase 2 review fixes, 2E-1).
// Runs against the built plugin (npm run build).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sygnal from '../dist/vite/plugin.mjs'

const ENTRY = `import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n`

function underVitest(options, root = process.cwd()) {
  const plugin = sygnal(options)
  const saved = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    plugin.config({ root }, { command: 'serve' })
  } finally {
    if (saved === undefined) delete process.env.VITEST
    else process.env.VITEST = saved
  }
  return plugin
}

describe('vite plugin under Vitest — setup file is loadable in jsdom (G-050)', () => {
  // jsdom loads setup files via /@fs/ URLs, which Vite only serves inside server.fs.allow
  const REPO = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))
  const setupDir = path.join(REPO, 'dist')

  function resolved(root, allow, options) {
    const plugin = underVitest(options, root)
    const config = { root, server: { fs: { allow: [...allow] } } }
    plugin.configResolved(config)
    return config.server.fs.allow
  }

  it("adds the setup file's directory to the resolved server.fs.allow (an app outside the package)", () => {
    const app = path.join(os.tmpdir(), 'app')
    // the repo root resolves 'sygnal' to this checkout, like a linked package
    expect(resolved(REPO, [app])).toEqual([app, setupDir])
  })

  it('leaves it alone when already allowed, and outside Vitest', () => {
    expect(resolved(REPO, [REPO])).toEqual([REPO])
    const plugin = sygnal()
    const saved = process.env.VITEST
    delete process.env.VITEST
    try { plugin.config({ root: REPO }, { command: 'serve' }) } finally { if (saved !== undefined) process.env.VITEST = saved }
    const config = { root: REPO, server: { fs: { allow: ['/x'] } } }
    plugin.configResolved(config)
    expect(config.server.fs.allow).toEqual(['/x'])
  })
})

describe('vite plugin under Vitest — no dev/strict flags (R9)', () => {
  it('does not inject __SYGNAL_DEV__ (or __SYGNAL_STRICT__) into files that import run', () => {
    // a flag set by one test file would leak into later files of the same worker
    expect(underVitest().transform(ENTRY, '/src/main.js')).toBeNull()
    expect(underVitest({ diagnostics: { strict: true } }).transform(ENTRY, '/src/main.js')).toBeNull()
    expect(underVitest({ diagnostics: 'error' }).transform(ENTRY, '/src/App.test.js')).toBeNull()
  })
})
