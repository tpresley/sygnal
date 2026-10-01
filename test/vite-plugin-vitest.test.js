// The Vite plugin under Vitest (Phase 2 review fixes, 2E-1).
// Runs against the built plugin (npm run build).
import { describe, it, expect } from 'vitest'
import sygnal from '../dist/vite/plugin.mjs'

const ENTRY = `import { run } from 'sygnal'\nimport App from './App.jsx'\nrun(App)\n`

function underVitest(options) {
  const plugin = sygnal(options)
  const saved = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    plugin.config({ root: process.cwd() }, { command: 'serve' })
  } finally {
    if (saved === undefined) delete process.env.VITEST
    else process.env.VITEST = saved
  }
  return plugin
}

describe('vite plugin under Vitest — no dev/strict flags (R9)', () => {
  it('does not inject __SYGNAL_DEV__ (or __SYGNAL_STRICT__) into files that import run', () => {
    // a flag set by one test file would leak into later files of the same worker
    expect(underVitest().transform(ENTRY, '/src/main.js')).toBeNull()
    expect(underVitest({ diagnostics: { strict: true } }).transform(ENTRY, '/src/main.js')).toBeNull()
    expect(underVitest({ diagnostics: 'error' }).transform(ENTRY, '/src/App.test.js')).toBeNull()
  })
})
