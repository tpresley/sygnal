// PLAN-7 C-3: the parse cache. A ParseCache passed to check(), checkFiles(), buildProject() and
// the graph APIs reuses a file's parse (AST, parent index, suppressions), or its parse failure,
// while the text is identical; per-build data (the FileInfo, components, the model) is rebuilt.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, checkFiles, buildProject, graph, graphFiles, runRules, ParseCache, createParseCache } from '../src/index.js'
import { selectRules } from '../src/rules/index.js'
import { expandInputs } from '../src/files.js'
import { elementsOf } from '../src/rules/a11y/shared.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const repo = path.resolve(pkgRoot, '..')
const dir = path.join(here, 'fixtures/sources')
const counter = path.join(dir, 'Counter.jsx')
const parent = path.join(dir, 'Parent.jsx')

const FIXED_COUNTER = `function Counter({ state }) {
  return <div><button className="inc">+</button><span>{state.count}</span></div>
}
Counter.initialState = { count: 0 }
Counter.intent = ({ DOM }) => ({ INCREMENT: DOM.click('.inc') })
Counter.model = { INCREMENT: (state) => ({ ...state, count: state.count + 1 }) }
export default Counter
`
const BROKEN = 'function Counter({ state }) {\n  return <div>\n}\nexport default (\n'

describe('ParseCache: reuse', () => {
  it('is exported as a class and a factory', () => {
    expect(createParseCache()).toBeInstanceOf(ParseCache)
    expect(new ParseCache().size).toBe(0)
  })

  it('reuses an entry on identical text (no re-parse) and keeps per-build file objects', () => {
    const cache = createParseCache()
    const p1 = buildProject([counter, parent], { cwd: pkgRoot, cache })
    expect(cache.stats).toEqual({ hits: 0, parses: 2 })
    const p2 = buildProject([counter, parent], { cwd: pkgRoot, cache })
    expect(cache.stats).toEqual({ hits: 2, parses: 2 })
    const f1 = p1.files.get(counter), f2 = p2.files.get(counter)
    expect(f2.ast).toBe(f1.ast) // the parse products are shared
    expect(f2.parents).toBe(f1.parents)
    expect(f2.suppressions).toBe(f1.suppressions)
    expect(f2).not.toBe(f1) // the FileInfo and its components are per build
    expect(f2.components).not.toBe(f1.components)
    expect(f2.components[0]).not.toBe(f1.components[0])
    expect(f2.components[0].file).toBe(f2)
    expect(cache.get(counter)).toMatchObject({ text: fs.readFileSync(counter, 'utf8'), ast: f1.ast })
  })

  it('re-parses a file whose text changed, from sources or the disk', () => {
    const cache = createParseCache()
    checkFiles([counter, parent], { cwd: pkgRoot, cache })
    const ast1 = cache.get(counter).ast
    const diags = checkFiles([counter, parent], { cwd: pkgRoot, cache, sources: { [counter]: FIXED_COUNTER } })
    expect(cache.stats).toEqual({ hits: 1, parses: 3 }) // Parent reused, Counter re-parsed
    expect(cache.get(counter).text).toBe(FIXED_COUNTER)
    expect(cache.get(counter).ast).not.toBe(ast1)
    expect(diags.filter(d => d.file.endsWith('Counter.jsx'))).toEqual([])
    // back to the disk text: parsed again (the cache keeps one entry per path)
    const back = checkFiles([counter, parent], { cwd: pkgRoot, cache })
    expect(cache.stats.parses).toBe(4)
    expect(back).toEqual(checkFiles([counter, parent], { cwd: pkgRoot }))
  })

  it('a cached parse failure still reports SYG900 identically on every build', () => {
    const cache = createParseCache()
    const sources = { [counter]: BROKEN }
    const plain = checkFiles([counter], { cwd: pkgRoot, sources })
    const s900 = plain.filter(d => d.code === 'SYG900')
    expect(s900).toHaveLength(1)
    const first = checkFiles([counter], { cwd: pkgRoot, sources, cache })
    const second = checkFiles([counter], { cwd: pkgRoot, sources, cache })
    expect(cache.stats).toEqual({ hits: 1, parses: 1 })
    expect(cache.get(counter).error).toMatchObject({ line: s900[0].line })
    expect(first).toEqual(plain)
    expect(second).toEqual(plain)
    // parseErrors is per build
    const p = buildProject([counter], { cwd: pkgRoot, sources, cache })
    expect(p.parseErrors).toHaveLength(1)
    expect(p.files.get(counter)).toBe(null)
  })

  it('an unreadable file is not cached', () => {
    const cache = createParseCache()
    const missing = path.join(dir, 'Missing.jsx')
    buildProject([missing], { cwd: pkgRoot, cache })
    expect(cache.has(missing)).toBe(false)
  })

  it('check() and the graph APIs take the cache too', () => {
    const cache = createParseCache()
    expect(check([dir], { cwd: pkgRoot, cache })).toEqual(check([dir], { cwd: pkgRoot }))
    const parses = cache.stats.parses
    expect(graph([dir], { cwd: pkgRoot, cache })).toEqual(graph([dir], { cwd: pkgRoot }))
    expect(graphFiles([counter, parent], { cwd: pkgRoot, cache })).toEqual(graphFiles([counter, parent], { cwd: pkgRoot }))
    expect(cache.stats.parses).toBe(parses)
  })
})

describe('ParseCache: eviction', () => {
  it('delete() and clear()', () => {
    const cache = createParseCache()
    buildProject([counter, parent], { cwd: pkgRoot, cache })
    expect(cache.size).toBe(2)
    expect(cache.delete(counter)).toBe(true)
    expect(cache.has(counter)).toBe(false)
    expect(cache.delete(counter)).toBe(false)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.stats).toEqual({ hits: 0, parses: 2 }) // the counters are kept
  })

  it('a build drops the entries the previous build did not use', () => {
    const cache = createParseCache()
    buildProject([counter, parent], { cwd: pkgRoot, cache })
    buildProject([parent], { cwd: pkgRoot, cache }) // Counter unused in this build...
    expect(cache.has(counter)).toBe(true)
    buildProject([parent], { cwd: pkgRoot, cache }) // ...so the next build drops it
    expect([...cache.keys()]).toEqual([parent])
    // a file loaded only while rules run (after build()) still counts for that build
    const p = buildProject([parent], { cwd: pkgRoot, cache })
    p.loadFile(counter)
    buildProject([parent], { cwd: pkgRoot, cache })
    expect(cache.has(counter)).toBe(true)
  })
})

// --- cache parity: every fixture and example, strict and not, with a frozen-AST cache ---

const fixtureFiles = ['good', 'bad', 'strict', 'sources'].flatMap(k => {
  const d = path.join(here, 'fixtures', k)
  return fs.readdirSync(d).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(d, f))
})
const exampleDirs = fs.readdirSync(path.join(repo, 'examples'), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => path.join('examples', d.name))

/** A per-build object (FileInfo) reachable from the model that belongs to another build. */
function staleFiles(project) {
  const stale = new Set()
  const seen = new Set()
  const visit = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (typeof v.type === 'string' && typeof v.start === 'number') return // AST nodes are shared on purpose
    if (v instanceof WeakMap) return
    if (typeof v.path === 'string' && v.ast && Array.isArray(v.components)) {
      if (project.files.get(v.path) !== v) stale.add(v.path)
    }
    if (v instanceof Map) { for (const [k, x] of v) { visit(k); visit(x) } return }
    if (v instanceof Set) { for (const x of v) visit(x); return }
    for (const k of Object.keys(v)) visit(v[k])
  }
  visit(project.components)
  visit(project.events)
  visit(elementsOf(project))
  return [...stale]
}

describe('ParseCache: results equal no cache, rules never mutate a cached AST', () => {
  for (const strict of [false, true]) {
    it(`fixtures, each checked alone${strict ? ', strict' : ''}`, () => {
      const cache = createParseCache({ freeze: true })
      for (const file of fixtureFiles) {
        const base = check([file], { cwd: pkgRoot, strict })
        expect(check([file], { cwd: pkgRoot, strict, cache }), file).toEqual(base)
        expect(check([file], { cwd: pkgRoot, strict, cache }), file).toEqual(base)
      }
      expect(cache.stats.hits).toBeGreaterThan(0)
    })

    it(`examples${strict ? ', strict' : ''}`, () => {
      for (const ex of exampleDirs) {
        const cache = createParseCache({ freeze: true })
        const base = check([ex], { cwd: repo, strict })
        expect(check([ex], { cwd: repo, strict, cache }), ex).toEqual(base)
        expect(check([ex], { cwd: repo, strict, cache }), ex).toEqual(base)
        expect(graph([ex], { cwd: repo, strict, cache }), ex).toEqual(graph([ex], { cwd: repo, strict }))
      }
    }, 60_000)
  }

  it('the frozen run really freezes the cached ASTs', () => {
    const cache = createParseCache({ freeze: true })
    const p = buildProject([counter], { cwd: pkgRoot, cache })
    const ast = p.files.get(counter).ast
    expect(Object.isFrozen(ast)).toBe(true)
    expect(Object.isFrozen(ast.program.body[0])).toBe(true)
    expect(Object.isFrozen(ast.program.body[0].loc.start)).toBe(true)
    expect(() => { 'use strict'; ast.program.body[0].extra = 1 }).toThrow(TypeError)
  })

  it('no model object of a warm build points at a previous build\'s FileInfo', () => {
    for (const ex of exampleDirs) {
      const cache = createParseCache()
      const { files } = expandInputs([ex], { cwd: repo })
      const rules = selectRules({ strict: true })
      for (let i = 0; i < 2; i++) {
        const p = buildProject(files, { cwd: repo, cache })
        runRules(p, rules)
        expect(staleFiles(p), ex).toEqual([])
      }
    }
  }, 60_000)
})
