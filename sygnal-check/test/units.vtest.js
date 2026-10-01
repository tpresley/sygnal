import { describe, it, expect } from 'vitest'
import { selectorRequirements } from '../src/selectors.js'
import { evalStrings, tokenize, DYN } from '../src/strings.js'
import { globToRegExp } from '../src/files.js'
import { parseSource } from '../src/ast.js'

const req = (s) => selectorRequirements(s).map(r => (r.kind === 'class' ? '.' : '#') + r.name)

describe('selectorRequirements', () => {
  it('extracts classes and ids from compound, descendant and list selectors', () => {
    expect(req('.a')).toEqual(['.a'])
    expect(req('ul.list > li.item:first-child')).toEqual(['.list', '.item'])
    expect(req('.restart, .gameover')).toEqual(['.restart', '.gameover'])
    expect(req('#modal .close')).toEqual(['#modal', '.close'])
  })
  it('ignores negations, attributes, tags and global selectors', () => {
    expect(req('li:not(.done)')).toEqual([])
    expect(req('[data-x=".y"]')).toEqual([])
    expect(req('input[type=checkbox]')).toEqual([])
    expect(req('document')).toEqual([])
    expect(req('body')).toEqual([])
  })
})

function exprOf(code) {
  const ast = parseSource(`(${code})`, 'x.jsx')
  return ast.program.body[0].expression
}
const tokens = (code) => {
  const t = tokenize(evalStrings(exprOf(code), null))
  return { names: [...t.names].sort(), patterns: t.patterns.map(p => p.source) }
}

describe('class expression evaluation', () => {
  it('static strings, concatenation and conditionals', () => {
    expect(tokens(`'a b'`).names).toEqual(['a', 'b'])
    expect(tokens(`'lane' + (x ? ' dragging' : '')`).names).toEqual(['dragging', 'lane'])
    expect(tokens(`x ? 'on' : 'off'`).names).toEqual(['off', 'on'])
    expect(tokens(`x && 'shown'`).names).toEqual(['shown'])
  })
  it('template literals keep static parts and mark dynamic parts as patterns', () => {
    expect(tokens('`task ${done ? "done" : ""}`').names).toEqual(['done', 'task'])
    const t = tokens('`tile tile-${id}`')
    expect(t.names).toEqual(['tile'])
    expect(t.patterns).toEqual(['tile-*'])
  })
  it('classes()/clsx() calls and [..].join(" ")', () => {
    expect(tokens(`classes('todo', 'todo-' + id, { completed, 'is-editing': editing })`)).toEqual({ names: ['completed', 'is-editing', 'todo'], patterns: ['todo-*'] })
    expect(tokens(`clsx(['a', cond && 'b'])`).names).toEqual(['a', 'b'])
    expect(tokens(`['x', y && 'z'].filter(Boolean).join(' ')`).names).toEqual(['x', 'z'])
  })
  it('unknown values are fully dynamic', () => {
    expect(tokens(`props.className`).patterns).toEqual(['*'])
    expect(evalStrings(exprOf('foo()'), null)).toEqual([DYN])
  })
})

describe('globToRegExp', () => {
  it('supports **, * and {a,b}', () => {
    const re = globToRegExp('/p/src/**/*.{jsx,tsx}')
    expect(re.test('/p/src/a/b/C.jsx')).toBe(true)
    expect(re.test('/p/src/C.tsx')).toBe(true)
    expect(re.test('/p/src/C.js')).toBe(false)
  })
})
