import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { main } from '../src/cli.js'
import * as files from '../src/files.js'

// count expandInputs calls (1H-13: the CLI must expand its inputs once)
vi.mock('../src/files.js', async (importOriginal) => {
  const mod = await importOriginal()
  return { ...mod, expandInputs: vi.fn(mod.expandInputs) }
})

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

  it('--strict runs the canonical-form rules', () => {
    const plain = run(['test/fixtures/strict/bad/model-forms.jsx'])
    expect(plain.out).not.toContain('SYG50')
    const strict = run(['test/fixtures/strict/bad/model-forms.jsx', '--strict'])
    expect(strict.code).toBe(1)
    expect(strict.out).toContain('SYG504')
    expect(strict.out).toContain('SYG505')
  })

  // D144: --strict leaves the a11y lane at warn; --a11y=error makes it an error
  it('--a11y=error reports SYG7xx as errors; --strict alone keeps them warnings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-cli-a11y-'))
    try {
      fs.writeFileSync(path.join(dir, 'App.jsx'), 'export function App() {\n  return <img src="a.png" />\n}\nApp.initialState = {}\n')
      const strict = run(['App.jsx', '--strict', '--fail-on=error'], dir)
      expect(strict.out).toContain('SYG703')
      expect(strict.out).not.toContain('[error]')
      expect(strict.code).toBe(0)
      const opt = run(['App.jsx', '--a11y=error', '--fail-on=error'], dir)
      expect(opt.out).toMatch(/SYG703 \[error\]/)
      expect(opt.code).toBe(1)
      expect(run(['App.jsx', '--a11y=warn', '--fail-on=error'], dir).code).toBe(0)
      const bad = run(['App.jsx', '--a11y=loud'], dir)
      expect(bad.code).toBe(2)
      expect(bad.err).toContain("--a11y must be warn or error")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts globs and reports missing paths', () => {
    expect(run(['test/fixtures/bad/**/*.tsx']).out).toContain('typed.tsx')
    const r = run(['does-not-exist'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('no such file or directory: does-not-exist')
  })

  it('globs honor --include-tests (1H-13)', () => {
    // a temp project: test files inside the repo would be collected by the root vitest
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-'))
    try {
      fs.mkdirSync(path.join(dir, 'src'))
      const comp = (name) => `function ${name}() { return <div className="a">x</div> }\n${name}.intent = ({ DOM }) => ({ GO: DOM.click('.b') })\n${name}.model = { GO: s => s }\nexport default ${name}\n`
      fs.writeFileSync(path.join(dir, 'src', 'App.jsx'), comp('App'))
      fs.writeFileSync(path.join(dir, 'src', 'App.test.jsx'), comp('Probe'))
      const without = run(['src/**/*.jsx', '--json'], dir)
      expect(JSON.parse(without.out).map(d => d.file)).toEqual(['src/App.jsx'])
      const withTests = run(['src/**/*.jsx', '--json', '--include-tests'], dir)
      expect(JSON.parse(withTests.out).map(d => d.file)).toEqual(['src/App.jsx', 'src/App.test.jsx'])
      // a directory input behaves the same
      expect(JSON.parse(run(['src', '--json'], dir).out).map(d => d.file)).toEqual(['src/App.jsx'])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('expands the inputs once per run (1H-13)', () => {
    files.expandInputs.mockClear()
    run(['test/fixtures/bad/**/*.tsx'])
    expect(files.expandInputs).toHaveBeenCalledTimes(1)
  })

  it('the bin script runs', () => {
    const r = spawnSync(process.execPath, [path.join(pkgRoot, 'bin/sygnal-check.js'), 'test/fixtures/bad/typed.tsx'], { cwd: pkgRoot, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('SYG101')
  })
})
