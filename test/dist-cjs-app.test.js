// G-067: run a whole app through the built files in plain Node with jsdom: render,
// click, state update, a Collection, EVENTS between components, ABORT and an xstream
// extra. dist-exports.test.js only probes the exports; this catches a regression inside
// the runtime itself. Before 5.4.0, `run()` threw `xs.create is not a function` both
// under plain CJS `require()` and native Node ESM `import` (xstream's default import was
// its whole module.exports there), and no test noticed.
//
// The app runs in a child `node` process (test/fixtures/cjs-app.cjs) so Vitest's own
// module interop can't mask the problem. SYGNAL_DIST_DIR overrides the dist directory
// (e.g. to show that the test fails on an older build).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = process.env.SYGNAL_DIST_DIR || resolve(root, 'dist')
const fixture = resolve(root, 'test/fixtures/cjs-app.cjs')

function runApp(file) {
  const out = execFileSync(process.execPath, ['--no-warnings', fixture, file], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
  })
  return JSON.parse(out.trim().split('\n').pop())
}

function expectWorkingApp(result) {
  expect(result.requireError, 'loading the dist file').toBeUndefined()
  expect(result.uncaught, 'uncaught exception').toBeUndefined()
  expect(result.failure, `app did not behave (html: ${result.html})`).toBeUndefined()
  expect(result.steps).toEqual(['initial render', 'first click', 'EVENTS to sibling', 'debounced extra', 'second click', 'reset'])
  expect(result.errors).toEqual([])
  expect(result.ok).toBe(true)
}

describe('a full app through the built files in plain Node + jsdom (G-067)', () => {
  const cjsFile = resolve(dist, 'index.cjs.js')
  const esmFile = resolve(dist, 'index.esm.js')

  it.skipIf(!existsSync(cjsFile))('CJS: require(dist/index.cjs.js) renders, handles clicks and updates state', () => {
    expectWorkingApp(runApp(cjsFile))
  })

  it.skipIf(!existsSync(esmFile))('native ESM: import(dist/index.esm.js) renders, handles clicks and updates state', () => {
    expectWorkingApp(runApp(esmFile))
  })
})
