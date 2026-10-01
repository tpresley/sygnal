/**
 * --fix regressions from the Phase 2 close review (2E-1):
 *   R1  SYG505 raw-EVENTS rewrite: generic / typed arrows and parenthesized
 *       or sequence `data`; the re-parse backstop (SYG900 "fix skipped")
 *   R7  SYG506 only rewrites strings whose binding is a component
 *   R8  a sole-specifier `import { emit } from 'sygnal'` is removed
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles, fixFiles, strictRules } from '../src/index.js'
import { parseSource } from '../src/ast.js'
import { removeUnusedEmitImport } from '../src/fix.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function write(name, src) {
  tmp = tmp || fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-fixreg-'))
  const file = path.join(tmp, name)
  fs.writeFileSync(file, src)
  return file
}
const parses = (src, name) => {
  const ast = parseSource(src, name)
  return ast.errors.length === 0
}

describe('R1: SYG505 raw EVENTS rewrite keeps the code parseable', () => {
  it('keeps the parens (and type parameters) of a generic arrow', () => {
    const file = write('C.tsx', `import { event } from 'sygnal'
type S = { id: number }
export function C({ state }: any) { return <button className="x">x</button> }
C.intent = ({ DOM }: any) => ({ X: DOM.select('.x').events('click'), Y: DOM.select('.x').events('dblclick') })
C.model = {
  X: { EVENTS: <T extends S>(s: T) => ({ type: 'CX', data: s.id }) },
  Y: { EVENTS: (s: S) => ({ type: 'CY', data: s.id }) },
}
`)
    const r = fixFiles([file], { cwd: tmp })
    const out = fs.readFileSync(file, 'utf8')
    expect(out).toContain("X: { EVENTS: event('CX', <T extends S>(s: T) => s.id) },")
    expect(out).toContain("Y: { EVENTS: event('CY', (s: S) => s.id) },")
    expect(parses(out, file)).toBe(true)
    expect(r.diagnostics).toEqual([])
  })

  it('keeps an arrow return type', () => {
    const file = write('R.tsx', `import { event } from 'sygnal'
export function R({ state }: any) { return <button className="x">x</button> }
R.intent = ({ DOM }: any) => ({ X: DOM.select('.x').events('click') })
R.model = {
  X: { EVENTS: (s: any): any => ({ type: 'RX', data: s.id }) },
}
`)
    fixFiles([file], { cwd: tmp })
    const out = fs.readFileSync(file, 'utf8')
    expect(out).toContain("X: { EVENTS: event('RX', (s: any): any => s.id) },")
    expect(parses(out, file)).toBe(true)
  })

  it('keeps the parens around a parenthesized / sequence data expression', () => {
    const file = write('A.jsx', `import { event } from 'sygnal'
export function A({ state }) { return <button className="x">x</button> }
A.intent = ({ DOM }) => ({ X: DOM.select('.x').events('click'), Y: DOM.select('.x').events('dblclick') })
A.model = {
  X: { EVENTS: s => ({ type: 'AX', data: (s.a, s.b) }) },
  Y: { EVENTS: s => ({ type: 'AY', data: (s.a) }) },
}
`)
    fixFiles([file], { cwd: tmp })
    const out = fs.readFileSync(file, 'utf8')
    expect(out).toContain("X: { EVENTS: event('AX', s => (s.a, s.b)) },")
    expect(out).toContain("Y: { EVENTS: event('AY', s => (s.a)) },")
    expect(parses(out, file)).toBe(true)
  })

  it('backstop: rolls back a file whose fixed source no longer parses and reports SYG900', () => {
    const src = `const x = 1\nexport default x\n`
    const file = write('B.js', src)
    // a rule whose --fix edit produces broken syntax
    const broken = {
      id: 'test-broken-fix', codes: ['SYG505'], strict: true,
      run(project, report) {
        const f = project.files.get(file)
        report({ code: 'SYG505', file: f, node: f.ast.program.body[0], message: 'broken', fix: 'x',
          edits: [{ file, start: 0, end: 5, text: 'const const' }] })
      },
    }
    const r = fixFiles([file], { cwd: tmp, rules: [...strictRules, broken] })
    expect(fs.readFileSync(file, 'utf8')).toBe(src)
    expect(r.fixed).toBe(0)
    expect(r.files).toEqual([])
    expect(r.diagnostics.map(d => d.code)).toEqual(['SYG900'])
    expect(r.diagnostics[0].message).toContain('fix skipped')
    expect(r.diagnostics[0].file).toBe('B.js')
  })
})

describe('R7: SYG506 --fix only rewrites component bindings', () => {
  it('rewrites imports / functions / classes / const arrows, not other bindings', () => {
    write('Other.jsx', `export function Other() { return <div /> }\n`)
    const file = write('P.jsx', `import { Collection, component } from 'sygnal'
import Other from './Other.jsx'
import * as NS from './Other.jsx'
const Thing = 'thing'
const Arrow = () => <div />
function Fn() { return <div /> }
class Klass {}
const Made = component({ view: () => <div /> })
export function P({ state }) { return <div><Collection of={Other} from="items" /></div> }
P.intent = ({ CHILD }) => ({
  A: CHILD.select('Other'),
  B: CHILD.select('Thing'),
  C: CHILD.select('Arrow'),
  D: CHILD.select('Fn'),
  E: CHILD.select('Klass'),
  F: CHILD.select('NS'),
  G: CHILD.select('Made'),
})
P.model = { A: s => s, B: s => s, C: s => s, D: s => s, E: s => s, F: s => s, G: s => s }
`)
    const diags = checkFiles([file], { cwd: tmp, strict: true }).filter(d => d.code === 'SYG506')
    const made = diags.find(d => d.data.name === 'Made')
    expect(made.fix).toMatch(/component\(\)/)
    fixFiles([file], { cwd: tmp })
    const out = fs.readFileSync(file, 'utf8')
    expect(out).toContain('A: CHILD.select(Other),')
    expect(out).toContain("B: CHILD.select('Thing'),")
    expect(out).toContain('C: CHILD.select(Arrow),')
    expect(out).toContain('D: CHILD.select(Fn),')
    expect(out).toContain('E: CHILD.select(Klass),')
    expect(out).toContain("F: CHILD.select('NS'),")
    expect(out).toContain("G: CHILD.select('Made'),")
  })
})

describe('R8: a sole-specifier unused emit import is removed', () => {
  it('removeUnusedEmitImport drops the whole declaration', () => {
    expect(removeUnusedEmitImport(`import { event } from 'sygnal'\nimport { emit } from 'sygnal'\nevent('X')\n`, 'x.js'))
      .toBe(`import { event } from 'sygnal'\nevent('X')\n`)
    const used = `import { emit } from 'sygnal'\nemit('X')\n`
    expect(removeUnusedEmitImport(used, 'x.js')).toBe(used)
  })

  it('--fix leaves no unused emit import when event goes into another sygnal import', () => {
    const file = write('C.jsx', `import { Collection } from 'sygnal'
import { emit } from 'sygnal'
export function C({ state }) { return <button className="x">x</button> }
C.intent = ({ DOM }) => ({ X: DOM.select('.x').events('click') })
C.model = { X: emit('CX', s => s.id) }
`)
    fixFiles([file], { cwd: tmp })
    const out = fs.readFileSync(file, 'utf8')
    expect(out).not.toMatch(/\bemit\b/)
    expect(out).toContain("import { Collection, event } from 'sygnal'\nexport function C")
    expect(out).toContain("X: { EVENTS: event('CX', s => s.id) }")
  })
})
