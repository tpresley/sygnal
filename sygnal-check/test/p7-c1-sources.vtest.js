// PLAN-7 C-1: in-memory sources (an editor's unsaved buffers) for check(), checkFiles(),
// buildProject() and the graph APIs, including import resolution and directory inputs.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, checkFiles, buildProject, graph, graphFiles } from '../src/index.js'
import { expandInputs, resolveImport } from '../src/files.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const dir = path.join(here, 'fixtures/sources')
const counter = path.join(dir, 'Counter.jsx')
const parent = path.join(dir, 'Parent.jsx')
const child = path.join(dir, 'Child.jsx') // never on disk

const codes = (diags, file) => diags.filter(d => !file || d.file.endsWith(file)).map(d => d.code)

const FIXED_COUNTER = `function Counter({ state }) {
  return <div><button className="inc">+</button><span>{state.count}</span></div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click('.inc') })
Counter.model = { INCREMENT: (state) => ({ ...state, count: state.count + 1 }) }
export default Counter
`

const CHILD = `function Child({ state }) {
  return <div className="child"><button className="child-btn">go</button></div>
}
Child.intent = ({ DOM }) => ({ GO: DOM.click('.child-btn') })
Child.model = { GO: (state) => state }
export default Child
`

describe('sources: unsaved buffers', () => {
  it('disk behaviour is unchanged without sources, or with an empty Map / object', () => {
    const base = check([dir], { cwd: pkgRoot })
    expect(codes(base, 'Counter.jsx')).toEqual(['SYG101', 'SYG110', 'SYG102'])
    expect(codes(base, 'Parent.jsx')).toEqual(['SYG110'])
    expect(check([dir], { cwd: pkgRoot, sources: new Map() })).toEqual(base)
    expect(check([dir], { cwd: pkgRoot, sources: {} })).toEqual(base)
    expect(checkFiles([counter, parent], { cwd: pkgRoot, sources: new Map() })).toEqual(base)
  })

  it('a buffer that fixes the findings wins over the file on disk', () => {
    const diags = checkFiles([counter], { cwd: pkgRoot, sources: new Map([[counter, FIXED_COUNTER]]) })
    expect(diags).toEqual([])
    // a plain object works too, and check() passes it through
    expect(codes(check([dir], { cwd: pkgRoot, sources: { [counter]: FIXED_COUNTER } }), 'Counter.jsx')).toEqual([])
  })

  it('a buffer that introduces a finding', () => {
    const broken = FIXED_COUNTER.replace("DOM.click('.inc')", "DOM.click('.plus')")
    const diags = checkFiles([counter], { cwd: pkgRoot, sources: new Map([[counter, broken]]) })
    expect(diags.map(d => [d.code, d.line])).toEqual([['SYG110', 5]])
    expect(diags[0].message).toMatch(/'\.plus'/)
  })

  it('relative keys are resolved against cwd', () => {
    const rel = path.relative(pkgRoot, counter)
    expect(checkFiles([counter], { cwd: pkgRoot, sources: { [rel]: FIXED_COUNTER } })).toEqual([])
  })

  it('a buffer with a syntax error gives SYG900 at the parser position, as from disk', () => {
    const text = 'function Counter() {\n  return <div>\n}\n'
    const diags = checkFiles([counter], { cwd: pkgRoot, sources: new Map([[counter, text]]) })
    expect(diags).toHaveLength(1)
    expect(diags[0].code).toBe('SYG900')
    expect(diags[0].file).toBe('test/fixtures/sources/Counter.jsx')
    expect(diags[0].message).toMatch(/could not parse file/)
    // the same text on disk gives the same finding
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-c1-'))
    try {
      fs.writeFileSync(path.join(tmp, 'Counter.jsx'), text)
      const disk = checkFiles([path.join(tmp, 'Counter.jsx')], { cwd: tmp })
      expect(disk.map(d => [d.code, d.line, d.column, d.message]))
        .toEqual(diags.map(d => [d.code, d.line, d.column, d.message]))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('sources: files that exist only in a buffer', () => {
  it('an import resolves to a source-only file (SYG110 becomes SYG104)', () => {
    const diags = checkFiles([parent], { cwd: pkgRoot, sources: new Map([[child, CHILD]]) })
    expect(codes(diags, 'Parent.jsx')).toEqual(['SYG104'])
  })

  it('resolveImport takes an isFile callback; without it, the disk', () => {
    expect(resolveImport(parent, './Child.jsx')).toBe(null)
    expect(resolveImport(parent, './Child')).toBe(null)
    expect(resolveImport(parent, './Child', { isFile: p => p === child })).toBe(child)
    expect(resolveImport(parent, './Counter.jsx')).toBe(counter)
  })

  it('a source-only file passed explicitly is checked', () => {
    const text = CHILD.replace("DOM.click('.child-btn')", "DOM.click('.nope')")
    const diags = checkFiles([child], { cwd: pkgRoot, sources: { [child]: text } })
    expect(diags.map(d => [d.code, d.file])).toEqual([['SYG110', 'test/fixtures/sources/Child.jsx']])
    // check() with the file named explicitly: not reported missing, and checked
    expect(codes(check([child], { cwd: pkgRoot, sources: { [child]: text } }))).toEqual(['SYG110'])
  })

  it('a source-only file under a directory input is picked up (same filters as the walk)', () => {
    const sources = new Map([
      [child, CHILD],
      [path.join(dir, 'Child.test.jsx'), 'x'],              // test file: needs includeTests
      [path.join(dir, 'node_modules/x/Y.jsx'), 'x'],       // ignored directory
      [path.join(dir, '.hidden/Z.jsx'), 'x'],              // dot directory
      [path.join(dir, 'notes.md'), 'x'],                   // not a source file
      [path.join(pkgRoot, 'test/fixtures/good/X.jsx'), 'x'], // another directory
    ])
    const { files, missing } = expandInputs([dir], { cwd: pkgRoot, sources })
    expect(missing).toEqual([])
    expect(files).toEqual([child, counter, parent])
    expect(expandInputs([dir], { cwd: pkgRoot, sources, includeTests: true }).files)
      .toEqual([child, path.join(dir, 'Child.test.jsx'), counter, parent])
    // globs too
    expect(expandInputs(['test/fixtures/sources/C*.jsx'], { cwd: pkgRoot, sources }).files).toEqual([child, counter])
    // and check() reports for it: Parent sees the child, Child.jsx itself is clean
    const diags = check(['test/fixtures/sources'], { cwd: pkgRoot, sources: new Map([[child, CHILD]]) })
    expect(codes(diags, 'Parent.jsx')).toEqual(['SYG104'])
    expect(codes(diags, 'Child.jsx')).toEqual([])
  })

  it('buildProject() scans a source-only file', () => {
    const project = buildProject([child, parent], { cwd: pkgRoot, sources: { [child]: CHILD } })
    expect(project.components.map(c => c.name).sort()).toEqual(['Child', 'Parent'])
    expect(project.files.get(child).source).toBe(CHILD)
  })
})

describe('sources: graph APIs', () => {
  it('graph() and graphFiles() see the buffers', () => {
    const g = graph([dir], { cwd: pkgRoot, sources: { [child]: CHILD, [counter]: FIXED_COUNTER } })
    expect(g.components.map(c => c.name).sort()).toEqual(['Child', 'Counter', 'Parent'])
    const all = [...g.diagnostics, ...g.components.flatMap(c => c.diagnostics)]
    expect(all.map(d => d.code)).toEqual(['SYG104'])
    const g2 = graphFiles([parent], { cwd: pkgRoot, sources: new Map([[child, CHILD]]) })
    const sel = g2.components.find(c => c.name === 'Parent').selectors[0]
    expect(sel.isolationHit).toBeTruthy()
  })
})
