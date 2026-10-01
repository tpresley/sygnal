import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { main } from '../src/cli.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

function run(args, cwd = pkgRoot) {
  let out = ''
  let err = ''
  const code = main(args, {
    cwd,
    stdout: { write: (s) => { out += s } },
    stderr: { write: (s) => { err += s } },
  })
  return { code, out, err }
}

describe('cli', () => {
  it('prints file:line:col CODE message (fix) and exits 1 on warnings', () => {
    const r = run(['test/fixtures/bad/selector-typo.jsx'])
    expect(r.code).toBe(1)
    expect(r.out.split('\n')[0]).toBe(
      "test/fixtures/bad/selector-typo.jsx:20:15 SYG110 App: selector '.add-todo-button' targets .add-todo-button, but App's view never renders that class, so this action never fires (did you mean '.add-todo-btn'? The view renders className=\"add-todo-btn\")",
    )
    expect(r.out).toMatch(/sygnal-check: 3 warnings$/m)
  })

  it('exits 0 on a clean project', () => {
    const r = run(['test/fixtures/good/todo-app.jsx'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('0 warnings')
  })

  it('hides info in text output unless --verbose, and info never fails the run', () => {
    const quiet = run(['test/fixtures/good/dynamic-and-suppressed.jsx'])
    expect(quiet.code).toBe(0)
    expect(quiet.out).not.toContain('SYG110')
    expect(quiet.out).toContain('3 info (hidden; use --verbose)')
    const verbose = run(['test/fixtures/good/dynamic-and-suppressed.jsx', '--verbose'])
    expect(verbose.out).toContain('SYG110 [info]')
  })

  it('--json prints Diagnostic objects', () => {
    const r = run(['test/fixtures/bad/typed.tsx', '--json'])
    const diags = JSON.parse(r.out)
    expect(diags.map(d => d.code)).toEqual(['SYG110', 'SYG101'])
    expect(diags[0]).toHaveProperty('docsUrl')
    expect(diags[0]).toHaveProperty('line', 13)
  })

  it('--fail-on controls the exit code', () => {
    expect(run(['test/fixtures/bad/typed.tsx', '--fail-on=error']).code).toBe(0)
    expect(run(['test/fixtures/bad/typed.tsx', '--fail-on=never']).code).toBe(0)
    expect(run(['test/fixtures/bad/typed.tsx', '--fail-on=warn']).code).toBe(1)
    expect(run(['x', '--fail-on=sometimes']).code).toBe(2)
  })

  it('defaults to ./src', () => {
    const r = run([], path.resolve(pkgRoot, '..', 'examples', 'getting-started'))
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
  })

  it('--strict and --graph are stubbed', () => {
    expect(run(['--strict']).err).toContain('--strict is not implemented yet')
    expect(run(['--graph']).err).toContain('--graph is not implemented yet')
    expect(run(['--graph']).code).toBe(2)
  })

  it('accepts globs and reports missing paths', () => {
    expect(run(['test/fixtures/bad/**/*.tsx']).out).toContain('typed.tsx')
    const r = run(['does-not-exist'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('no such file or directory: does-not-exist')
  })

  it('the bin script runs', () => {
    const r = spawnSync(process.execPath, [path.join(pkgRoot, 'bin/sygnal-check.js'), 'test/fixtures/bad/typed.tsx'], { cwd: pkgRoot, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('SYG101')
  })
})
