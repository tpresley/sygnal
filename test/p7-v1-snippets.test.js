// PLAN-7 §3 Snippets gate (V-1): every snippet the VS Code extension contributes
// (editors/vscode/snippets/*.json) expands to code that parses and is `sygnal-check --strict`
// clean, so the snippets can't drift from the canonical forms (PLAN-1-canonical-forms.md).
//
// Each body is expanded twice: with the placeholders' defaults, and with every mirrored placeholder
// renamed (a tabstop that must agree with its mirrors, like the action name in intent and model).
// Model-entry snippets are fragments, checked inside a host component. A broken copy of each
// expansion must produce a finding, which shows the check really analysed it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check } from '../sygnal-check/src/index.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ext = path.join(repo, 'editors/vscode')
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'package.json'), 'utf8'))
const LANGS = { javascriptreact: '.jsx', typescriptreact: '.tsx' }

/** Expands a snippet body (VS Code syntax: $n, ${n}, ${n:default}, ${n|a,b|}); `rename` alters mirrored tabstops. */
function expand(body, { rename = false } = {}) {
  const text = Array.isArray(body) ? body.join('\n') : body
  expect(text, 'no variables or nested placeholders').not.toMatch(/\$[A-Z_]|\$\{[A-Z_]|\$\{\d+:[^}]*\$/)
  const defaults = {}
  for (const m of text.matchAll(/\$\{(\d+):([^}]*)\}/g)) {
    expect(defaults[m[1]] === undefined || defaults[m[1]] === m[2], `tabstop ${m[1]} has one default`).toBe(true)
    defaults[m[1]] = m[2]
  }
  for (const m of text.matchAll(/\$\{(\d+)\|([^|]*)\|\}/g)) defaults[m[1]] ??= m[2].split(',')[0]
  const uses = {}
  for (const m of text.matchAll(/\$(?:\{(\d+)[:|}]|(\d+))/g)) { const n = m[1] ?? m[2]; uses[n] = (uses[n] ?? 0) + 1 }
  const value = (n) => {
    if (n === '0') return defaults[n] ?? ''
    expect(defaults[n], `tabstop $${n} has a default somewhere`).toBeDefined()
    return rename && uses[n] > 1 && /^[A-Za-z_]\w*$/.test(defaults[n]) ? `${defaults[n]}Two` : defaults[n]
  }
  const values = Object.fromEntries(Object.keys(uses).map(n => [n, value(n)]))
  const out = text
    .replace(/\$\{(\d+):[^}]*\}/g, (_, n) => values[n])
    .replace(/\$\{(\d+)\|[^|]*\|\}/g, (_, n) => values[n])
    .replace(/\$\{(\d+)\}/g, (_, n) => values[n])
    .replace(/\$(\d+)/g, (_, n) => values[n])
  expect(out, 'every tabstop replaced').not.toMatch(/\$\{?\d/)
  return { code: out, values }
}

// Model-entry fragments, placed in a host component that triggers the action (and receives the event).
const HOSTS = {
  'Sygnal model entry with EFFECT': (code, v, ts) => [
    `function Host({ state }${ts ? ': any' : ''}) {`,
    '  return <div><button className="go">Go</button><span>{state.n}</span></div>',
    '}',
    'Host.initialState = { n: 0 }',
    `Host.intent = ({ DOM }${ts ? ': any' : ''}) => ({ ${v[1]}: DOM.click('.go') })`,
    'Host.model = {',
    code,
    '}',
    'export default Host',
  ].join('\n'),
  'Sygnal model entry emitting an EVENTS event': (code, v, ts) => [
    "import { event } from 'sygnal'",
    `function Host({ state }${ts ? ': any' : ''}) {`,
    `  return <div><button className="go">Go</button><span>{String(state.${v[2]})}</span></div>`,
    '}',
    `Host.initialState = { ${v[2]}: false, got: 0 }`,
    `Host.intent = ({ DOM, EVENTS }${ts ? ': any' : ''}) => ({ ${v[1]}: DOM.click('.go'), GOT: EVENTS.select('${v[3]}') })`,
    'Host.model = {',
    code,
    '  GOT: (state) => ({ ...state, got: state.got + 1 }),',
    '}',
    'export default Host',
  ].join('\n'),
}

function strictFindings(file, code) {
  return check([file], { cwd: repo, strict: true, config: false, sources: { [file]: code } })
    .map(d => `${d.code} ${d.line}:${d.column} ${d.message}`)
}

describe('PLAN-7 V-1 snippets gate', () => {
  it('the manifest contributes one snippet file per JSX language, with the same snippets', () => {
    const contributed = manifest.contributes.snippets.map(s => s.language).sort()
    expect(contributed).toEqual(Object.keys(LANGS).sort())
    const names = manifest.contributes.snippets.map(s => Object.keys(JSON.parse(fs.readFileSync(path.join(ext, s.path), 'utf8'))).sort())
    expect(names[0]).toEqual(names[1])
    expect(names[0].length).toBeGreaterThanOrEqual(1)
  })

  for (const { language, path: rel } of manifest.contributes.snippets) {
    const snippets = JSON.parse(fs.readFileSync(path.join(ext, rel), 'utf8'))
    const ts = language === 'typescriptreact'
    for (const [name, snippet] of Object.entries(snippets)) {
      for (const rename of [false, true]) {
        it(`${language}: "${name}"${rename ? ' (mirrored tabstops renamed)' : ''} parses and is --strict clean`, () => {
          expect(snippet.prefix, 'has a prefix').toBeTruthy()
          expect(snippet.description, 'has a description').toBeTruthy()
          const { code, values } = expand(snippet.body, { rename })
          const fragment = !/export default/.test(code)
          if (fragment) expect(HOSTS[name], `a host for the fragment "${name}"`).toBeTypeOf('function')
          const full = fragment ? HOSTS[name](code, values, ts) : code
          const file = path.join(repo, '.snippet-check', `${name.replace(/\W+/g, '-')}${LANGS[language]}`)
          expect(strictFindings(file, full)).toEqual([])
          // a broken copy is reported (the file really was analysed)
          const broken = full.replace("DOM.click('.", "DOM.click('.zz")
          expect(broken).not.toBe(full)
          expect(strictFindings(file, broken).some(f => f.startsWith('SYG110'))).toBe(true)
        })
      }
    }
  }
})
