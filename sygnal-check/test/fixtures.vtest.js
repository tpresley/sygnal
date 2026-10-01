/**
 * Fixture tests. Each fixture is checked on its own (imports are followed
 * but not reported on). Expected diagnostics are written in the fixture as
 * `expect: SYG110` (optionally `expect: SYG110 info`) comments on the line
 * the diagnostic points at; every diagnostic must be expected and every
 * expectation must be met. The full output is also snapshotted.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check } from '../src/index.js'
import { formatDiagnostic } from '../src/format.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')

function fixtures(kind) {
  const dir = path.join(here, 'fixtures', kind)
  return fs.readdirSync(dir).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(dir, f))
}

function expectations(file) {
  const out = []
  fs.readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    const m = /expect:\s*(.+?)\s*(?:\*\/\s*\})?\s*$/.exec(text)
    if (!m) return
    for (const part of m[1].split(',')) {
      const [code, severity = 'warn'] = part.trim().split(/\s+/)
      out.push(`${i + 1} ${code} ${severity}`)
    }
  })
  return out.sort()
}

const actual = (diags) => diags.map(d => `${d.line} ${d.code} ${d.severity}`).sort()

describe('good fixtures', () => {
  for (const file of fixtures('good')) {
    it(path.basename(file), () => {
      const diags = check([file], { cwd: pkgRoot })
      expect(diags.filter(d => d.severity !== 'info').map(formatDiagnostic)).toEqual([])
      expect(actual(diags)).toEqual(expectations(file))
    })
  }
})

describe('bad fixtures', () => {
  for (const file of fixtures('bad')) {
    it(path.basename(file), () => {
      const diags = check([file], { cwd: pkgRoot })
      expect(diags.length).toBeGreaterThan(0)
      expect(actual(diags)).toEqual(expectations(file))
      expect(diags.map(formatDiagnostic)).toMatchSnapshot()
    })
  }
})

describe('diagnostic shape', () => {
  it('matches the runtime Diagnostic plus file/line/column', () => {
    const [d] = check([path.join(here, 'fixtures/bad/selector-typo.jsx')], { cwd: pkgRoot })
    expect(d).toMatchObject({
      code: 'SYG110',
      severity: 'warn',
      component: 'App',
      file: 'test/fixtures/bad/selector-typo.jsx',
      line: 20,
      column: 15,
      docsUrl: 'https://sygnal.js.org/reference/errors#syg110',
    })
    expect(d.message).toContain(".add-todo-button")
    expect(d.fix).toContain("'.add-todo-btn'")
    expect(d.text).toMatch(/^\[Sygnal SYG110\] App: selector '\.add-todo-button' .*\. did you mean .* https:\/\/sygnal\.js\.org\/reference\/errors#syg110$/)
  })

  it('SYG104 names the child and says how to fix it', () => {
    const diags = check([path.join(here, 'fixtures/bad/parent-selects-child.jsx')], { cwd: pkgRoot })
    const d = diags.find(x => x.data.selector === '.remove')
    expect(d.message).toContain('<TodoItem>')
    expect(d.message).toContain("parents can't see DOM events inside child components")
    expect(d.fix).toBe('handle it in <TodoItem> and send it up via PARENT or EVENTS')
  })

  it('reports nothing for files that only the checked file imports', () => {
    const diags = check([path.join(here, 'fixtures/bad/parent-selects-child.jsx')], { cwd: pkgRoot })
    expect(diags.every(d => d.file.endsWith('parent-selects-child.jsx'))).toBe(true)
  })

  it('checks a whole directory as one project (SYG105 counterparts across files)', () => {
    const diags = check(['test/fixtures/good'], { cwd: pkgRoot })
    expect(diags.filter(d => d.severity !== 'info')).toEqual([])
  })

  it('options.ignore drops codes', () => {
    const diags = check([path.join(here, 'fixtures/bad/typed.tsx')], { cwd: pkgRoot, ignore: ['SYG110'] })
    expect(diags.map(d => d.code)).toEqual(['SYG101'])
  })
})
