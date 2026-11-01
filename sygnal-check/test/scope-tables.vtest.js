// Native-tooling research, round 2 (dev-plans/research/native-tooling, E-2 / E-3): two
// algorithmic fixes that must not change any finding.
//   E-2 scope.js: a per-scope-node declaration table (built once per AST) instead of rescanning
//       every statement list up to the Program on each lookup. Checked against the old linear
//       scan for every identifier of the examples and fixtures.
//   E-3 a11y/shared.js: SYG702's "is this component rendered inside a <label>" looks up the
//       component's usages by name (indexed once per build, memoized per name and depth) instead
//       of scanning every JSX element of the project per field and per level.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, buildProject } from '../src/index.js'
import { expandInputs } from '../src/files.js'
import { walk, isFunction } from '../src/ast.js'
import { findBinding, patternNames } from '../src/scope.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')

// The lookup before E-2, verbatim in behavior: scan each enclosing scope's statements in order.
function refDeclInStatement(stmt, name) {
  if (!stmt) return null
  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') return stmt.declaration ? refDeclInStatement(stmt.declaration, name) : null
  if (stmt.type === 'VariableDeclaration') {
    for (const d of stmt.declarations) {
      if (d.id.type === 'Identifier') { if (d.id.name === name) return { kind: 'var', node: d, init: d.init, declKind: stmt.kind } } else if (patternNames(d.id).includes(name)) return { kind: 'pattern', node: d }
    }
  }
  if (stmt.type === 'FunctionDeclaration' && stmt.id?.name === name) return { kind: 'function', node: stmt }
  if (stmt.type === 'ClassDeclaration' && stmt.id?.name === name) return { kind: 'class', node: stmt }
  if (stmt.type === 'ImportDeclaration' && stmt.importKind !== 'type') {
    for (const s of stmt.specifiers) {
      if (s.local.name !== name || s.importKind === 'type') continue
      const imported = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : (s.imported.type === 'Identifier' ? s.imported.name : s.imported.value)
      return { kind: 'import', node: stmt, specifier: s, imported, source: stmt.source.value }
    }
  }
  return null
}
function refDeclInScope(scope, name) {
  if (isFunction(scope)) {
    for (const p of scope.params) if (patternNames(p).includes(name)) return { kind: 'param', node: scope }
    if (scope.type === 'FunctionExpression' && scope.id?.name === name) return { kind: 'function', node: scope }
    return null
  }
  if (scope.type === 'CatchClause') return scope.param && patternNames(scope.param).includes(name) ? { kind: 'param', node: scope } : null
  if (scope.type === 'ForStatement' || scope.type === 'ForInStatement' || scope.type === 'ForOfStatement') {
    const init = scope.init || scope.left
    return init && init.type === 'VariableDeclaration' ? refDeclInStatement(init, name) : null
  }
  const body = scope.type === 'Program' || scope.type === 'BlockStatement' || scope.type === 'StaticBlock' ? scope.body : scope.type === 'SwitchCase' ? scope.consequent : null
  if (!body) return null
  for (const stmt of body) { const d = refDeclInStatement(stmt, name); if (d) return d }
  return null
}
function refFindBinding(file, name, from) {
  let node = from, last = null
  while (node) { const d = refDeclInScope(node, name); if (d) return d; last = node; node = file.parents.get(node) }
  return last?.type === 'Program' ? null : refDeclInScope(file.ast.program, name)
}

describe('E-2: findBinding with scope tables = the linear scan', () => {
  const roots = ['examples', 'sygnal-check/test/fixtures'].map(r => path.join(repo, r))
  const files = roots.flatMap(r => expandInputs([r], { cwd: r }).files)
  it(`every identifier of ${files.length} example and fixture files resolves the same`, () => {
    const project = buildProject(files, { cwd: repo })
    let n = 0
    for (const p of files) {
      const file = project.files.get(p)
      if (!file) continue
      walk(file.ast.program, (node) => {
        if (node.type !== 'Identifier') return true
        const a = findBinding(file, node.name, node)
        const b = refFindBinding(file, node.name, node)
        n++
        if (a?.node !== b?.node || a?.kind !== b?.kind || a?.specifier !== b?.specifier) {
          throw new Error(`${p}:${node.loc.start.line}: ${node.name} → ${a?.kind}@${a?.node?.start} vs ${b?.kind}@${b?.node?.start}`)
        }
        return true
      })
    }
    expect(n).toBeGreaterThan(10_000)
  })

  it('the first declaration in a statement list wins, inner scopes shadow, `export` and destructuring count', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-scope-'))
    try {
      const f = path.join(tmp, 'a.jsx')
      fs.writeFileSync(f, `import { x as y } from 'm'
export const a = 1, { b, c: [d] } = o
function a2() {}
export function f(p, { q }) {
  const y = 2
  { let p = 3; use(p, y, q) }
  use(p, y, a, b, d, a2)
}
var a = 5
`)
      const file = buildProject([f], { cwd: tmp }).files.get(f)
      const ids = []
      walk(file.ast.program, (n) => { if (n.type === 'Identifier' && file.parents.get(n)?.type === 'CallExpression' && n.name !== 'use') ids.push(n); return true })
      const kinds = ids.map(n => `${n.name}:${findBinding(file, n.name, n)?.kind}@${findBinding(file, n.name, n)?.node.loc.start.line}`)
      expect(kinds).toEqual(['p:var@6', 'y:var@5', 'q:param@4', 'p:param@4', 'y:var@5', 'a:var@2', 'b:pattern@2', 'd:pattern@2', 'a2:function@3'])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

describe('E-3: SYG702 through component usages', () => {
  let tmp
  afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
  const write = (files) => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-e3-'))
    for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
    return Object.keys(files).map(f => path.join(tmp, f))
  }
  const fields = (files) => checkFiles(write(files), { cwd: tmp }).filter(d => d.code === 'SYG702').map(d => `${d.file}:${d.line}`)

  it('a field in a component is labelled when any usage is inside a <label>, up to the depth limit', () => {
    expect(fields({
      'Field.jsx': `export default function Field() { return <input /> }\nField.initialState = {}`,
      'Wrap.jsx': `import Field from './Field.jsx'\nexport default function Wrap() { return <span><Field /></span> }\nWrap.initialState = {}`,
      'A.jsx': `import Wrap from './Wrap.jsx'\nexport default function A() { return <label>Name <Wrap /></label> }\nA.initialState = {}`,
      'B.jsx': `import Wrap from './Wrap.jsx'\nexport default function B() { return <div><Wrap /></div> }\nB.initialState = {}`,
    })).toEqual([]) // A wraps Wrap (and so Field) in a label; B's usage doesn't matter
    expect(fields({
      'Field.jsx': `export default function Field() { return <input /> }\nField.initialState = {}`,
      'Wrap.jsx': `import Field from './Field.jsx'\nexport default function Wrap() { return <span><Field /></span> }\nWrap.initialState = {}`,
      'B.jsx': `import Wrap from './Wrap.jsx'\nexport default function B() { return <div><Wrap /></div> }\nB.initialState = {}`,
    })).toEqual(['Field.jsx:1'])
  })

  it('stays linear in practice: 300 components in a 4-ary tree, one unlabelled field each', () => {
    const files = {}
    const N = 300
    for (let i = 0; i < N; i++) {
      const kids = [1, 2, 3, 4].map(k => i * 4 + k).filter(k => k < N)
      files[`C${i}.jsx`] = `${kids.map(k => `import C${k} from './C${k}.jsx'`).join('\n')}
export default function C${i}() { return <div><input className="f" />${kids.map(k => `<C${k} />`).join('')}</div> }
C${i}.initialState = {}`
    }
    const t = performance.now()
    expect(fields(files)).toHaveLength(N)
    expect(performance.now() - t).toBeLessThan(5000) // was quadratic in fields × elements; a generous bound
  })
})
