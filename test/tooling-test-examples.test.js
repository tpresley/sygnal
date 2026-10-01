// R10 (Phase 2 review): `npm run test:examples` is a cross-platform Node
// script (scripts/test-examples.mjs), not a POSIX shell loop.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(REPO, 'scripts', 'test-examples.mjs')

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

// examples: { name: { test: 'pass' | 'fail', testFile?: string, modules?: bool } }
function examples(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-test-examples-'))
  dirs.push(root)
  for (const [name, o] of Object.entries(spec)) {
    const dir = path.join(root, name)
    fs.mkdirSync(dir)
    const marker = path.join(root, `ran-${name}`).replace(/\\/g, '/')
    const code = `require('fs').writeFileSync('${marker}', '');process.exit(${o.test === 'fail' ? 3 : 0})`
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', private: true, scripts: { test: `node -e "${code}"` } }))
    if (o.testFile) {
      fs.mkdirSync(path.dirname(path.join(dir, o.testFile)), { recursive: true })
      fs.writeFileSync(path.join(dir, o.testFile), '')
    }
    if (o.modules !== false) fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  }
  return root
}

const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, TEST_EXAMPLES_INSTALL: '', ...env } })
  return { status: r.status, out: r.stdout + r.stderr }
}
const ran = (root) => fs.readdirSync(root).filter(f => f.startsWith('ran-')).map(f => f.slice(4)).sort()

describe('scripts/test-examples.mjs (R10)', () => {
  it('package.json runs it (no POSIX shell loop)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
    expect(pkg.scripts['test:examples']).toBe('node scripts/test-examples.mjs')
  })

  it('runs npm test in each example with test files; skips ones without (node_modules/dist not searched)', () => {
    const root = examples({
      a: { testFile: 'src/a.test.js' },
      b: { testFile: 'b.spec.ts' },
      c: {},
      d: { testFile: 'node_modules/x/x.test.js' },
      e: { testFile: 'dist/e.test.js' },
    })
    const r = run(['--dir', root])
    expect(r.status).toBe(0)
    expect(ran(root)).toEqual(['a', 'b'])
    expect(r.out).toMatch(/test:examples: .*a\n/)
  })

  it('stops with a non-zero exit at the first failing example', () => {
    const root = examples({ a: { testFile: 'a.test.js', test: 'fail' }, b: { testFile: 'b.test.js' } })
    const r = run(['--dir', root])
    expect(r.status).toBe(3)
    expect(ran(root)).toEqual(['a'])
    expect(r.out).toMatch(/a failed \(exit 3\)/)
  })

  it('an example without node_modules fails with a clear message', () => {
    const root = examples({ a: { testFile: 'a.test.js', modules: false } })
    const r = run(['--dir', root])
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/has no node_modules; run 'npm install' in .*a first \(or set TEST_EXAMPLES_INSTALL=1/)
    expect(ran(root)).toEqual([])
  })

  it('TEST_EXAMPLES_INSTALL=1 (or --install) installs it first', () => {
    for (const how of [{ env: { TEST_EXAMPLES_INSTALL: '1' }, args: [] }, { env: {}, args: ['--install'] }]) {
      const root = examples({ a: { testFile: 'a.test.js', modules: false } })
      const r = run(['--dir', root, ...how.args], how.env)
      expect(r.status, r.out).toBe(0)
      expect(r.out).toMatch(/test:examples: installing/)
      expect(ran(root)).toEqual(['a'])
    }
  }, 60000)

  it('runs only the named examples', () => {
    const root = examples({ a: { testFile: 'a.test.js' }, b: { testFile: 'b.test.js' } })
    expect(run(['--dir', root, 'b']).status).toBe(0)
    expect(ran(root)).toEqual(['b'])
    expect(run(['--dir', root, 'zzz']).status).toBe(1)
  })
})
