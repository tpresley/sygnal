/**
 * Strict mode (SYG501-507, workstream 2A): fixture tests with --strict,
 * strict off → nothing, canonical rewrites in the messages, and --fix.
 * Fixture expectations use the same `expect: SYG5xx [severity]` comments as
 * fixtures.vtest.js.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, checkFiles, fixFiles, strictRules, CODES } from '../src/index.js'
import { formatDiagnostic } from '../src/format.js'
import { removeUnusedEmitImport } from '../src/fix.js'
import { main } from '../src/cli.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const dir = (kind) => path.join(here, 'fixtures', 'strict', kind)

function fixtures(kind) {
  return fs.readdirSync(dir(kind)).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(dir(kind), f))
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
const strict = (file) => check([file], { cwd: pkgRoot, strict: true })
const find = (diags, code, re) => diags.find(d => d.code === code && (!re || re.test(d.message)))

describe('strict rule registry', () => {
  it('has one rule per canonical-form row, all strict', () => {
    expect(strictRules.flatMap(r => r.codes).sort()).toEqual(['SYG501', 'SYG502', 'SYG503', 'SYG504', 'SYG505', 'SYG506', 'SYG507', 'SYG508'])
    expect(strictRules.every(r => r.strict === true)).toBe(true)
    expect(CODES.SYG507.severity).toBe('info')
  })
})

describe('strict good fixtures', () => {
  for (const file of fixtures('good')) {
    it(path.basename(file), () => {
      const diags = strict(file)
      expect(diags.map(formatDiagnostic)).toEqual([])
    })
  }

  it('the whole good directory (incl. the Collection item helper) is clean', () => {
    expect(check([dir('good')], { cwd: pkgRoot, strict: true }).map(formatDiagnostic)).toEqual([])
  })
})

describe('strict bad fixtures', () => {
  for (const file of fixtures('bad')) {
    it(path.basename(file), () => {
      const diags = strict(file)
      expect(diags.length).toBeGreaterThan(0)
      expect(actual(diags)).toEqual(expectations(file))
      expect(diags.map(formatDiagnostic)).toMatchSnapshot()
    })

    it(`${path.basename(file)} without --strict reports no SYG5xx`, () => {
      const diags = check([file], { cwd: pkgRoot })
      expect(diags.filter(d => /^SYG5/.test(d.code))).toEqual([])
    })
  }
})

describe('canonical rewrites in the messages', () => {
  it('SYG501 shows the destructured signature', () => {
    const diags = strict(path.join(dir('bad'), 'positional-view.jsx'))
    expect(find(diags, 'SYG501').fix).toContain('`function Counter({ state, ...props })`')
    expect(diags.find(d => d.component === 'Badge').fix).toContain('`const Badge = ({ label, state, context }) => …`')
    expect(diags.find(d => d.component === 'Panel').fix).toContain('`function Panel({ state: { count } })`')
  })

  it('SYG502 shows the statement with ABORT', () => {
    const diags = strict(path.join(dir('bad'), 'reducers.jsx'))
    expect(find(diags, 'SYG502', /'SAVE'/).fix).toContain('`SAVE: (state) => state.title ? { ...state, saved: true } : ABORT`')
    expect(find(diags, 'SYG502', /'RESET'/).fix).toContain('`return ABORT`')
  })

  it('SYG503 shows the EFFECT form', () => {
    const diags = strict(path.join(dir('bad'), 'reducers.jsx'))
    expect(find(diags, 'SYG503', /'PLAY'/).fix).toContain("`PLAY: { EFFECT: (state, data, next) => { player.send('play') } }`")
    expect(find(diags, 'SYG503', /'LOG'/).fix).toContain('LOG: { STATE: (state, data) => …, EFFECT:')
  })

  it('SYG504 / SYG505 / SYG506 show the object form, event() and the identifier', () => {
    const diags = strict(path.join(dir('bad'), 'model-forms.jsx'))
    expect(find(diags, 'SYG505', /'DELETE'/).fix).toContain("`DELETE: { EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })) }`")
    expect(find(diags, 'SYG505', /'MARK'/).fix).toContain("`EVENTS: event('MARKED', (state) => state.id)`")
    expect(find(diags, 'SYG505', /'MOVE'/).fix).toContain("`MOVE: { EVENTS: event('MOVE_LANE', (state) => ({ laneId: state.id })) }`")
    expect(find(diags, 'SYG504', /PLAY/).fix).toContain("`PLAY: { EFFECT: () => cmd.send('play') }`")
    expect(find(diags, 'SYG504', /PING/).fix).toContain("`PING: { EVENTS: event('PING', (state) => state.id) }`")
    expect(find(diags, 'SYG506', /TodoItem/).fix).toBe('pass the component function: `CHILD.select(TodoItem)`')
    expect(find(diags, 'SYG506', /Unknown/).fix).toContain('(import Unknown first)')
  })

  it('SYG507 names the path and the context rewrite', () => {
    const diags = strict(path.join(dir('bad'), 'prop-drilling.jsx'))
    const d = diags.find(x => x.component === 'Toolbar')
    expect(d.data.path).toEqual(['App', 'Toolbar', 'Menu'])
    expect(d.fix).toContain('`App.context = { theme: state => state.theme }`')
  })

  it('strict diagnostics are plain JSON (edits stay off the serialized object)', () => {
    const diags = strict(path.join(dir('bad'), 'model-forms.jsx'))
    const json = JSON.parse(JSON.stringify(diags))
    expect(json.every(d => !('edits' in d))).toBe(true)
    expect(diags.some(d => d.edits?.length)).toBe(true)
  })
})

describe('--fix', () => {
  let tmp
  afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

  const copy = () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-fix-'))
    fs.cpSync(dir('bad'), tmp, { recursive: true })
    return tmp
  }
  const files = (root) => fs.readdirSync(root).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(root, f))

  it('rewrites shorthand keys, emit() and CHILD.select strings, and is idempotent', () => {
    const root = copy()
    const first = fixFiles(files(root), { cwd: root })
    expect(first.fixed).toBeGreaterThan(0)
    const src = fs.readFileSync(path.join(root, 'model-forms.jsx'), 'utf8')
    expect(src).toContain("import { Collection, createCommand, event } from 'sygnal'")
    expect(src).toContain("DONE: CHILD.select(TodoItem),")
    expect(src).toContain("OTHER: CHILD.select('Unknown'),") // not in scope: left alone
    expect(src).toContain("DELETE: { EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })) },")
    expect(src).toContain("PLAY: { EFFECT: () => cmd.send('play') },")
    expect(src).toContain("PING: { EVENTS: event('PING', (state) => state.id) },")
    expect(src).toContain("    EVENTS: event('MARKED', (state) => state.id),")
    expect(src).toContain("    EVENTS: event('MOVE_LANE', (state) => ({ laneId: state.id })),")
    const typed = fs.readFileSync(path.join(root, 'typed.tsx'), 'utf8')
    expect(typed).toContain("import { ABORT, event } from 'sygnal'")
    expect(typed).toContain("RESET: { EVENTS: event('RESET_DONE') },")

    const after = checkFiles(files(root), { cwd: root, strict: true })
    expect(after.filter(d => ['SYG504', 'SYG505'].includes(d.code))).toEqual([])
    expect(after.filter(d => d.code === 'SYG506').map(d => d.data.name)).toEqual(['Unknown'])

    const snapshot = files(root).map(f => fs.readFileSync(f, 'utf8'))
    const second = fixFiles(files(root), { cwd: root })
    expect(second).toEqual({ fixed: 0, files: [], passes: 0, diagnostics: [] })
    expect(files(root).map(f => fs.readFileSync(f, 'utf8'))).toEqual(snapshot)
  })

  it('leaves files without fixable findings untouched', () => {
    const root = copy()
    const before = fs.readFileSync(path.join(root, 'reducers.jsx'), 'utf8')
    fixFiles(files(root), { cwd: root })
    expect(fs.readFileSync(path.join(root, 'reducers.jsx'), 'utf8')).toBe(before)
  })

  it('does not rewrite a shorthand key whose action already has an entry (merge by hand)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-fix-'))
    const file = path.join(tmp, 'App.jsx')
    const src = `function App() { return <button className="go">go</button> }
App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
App.model = {
  GO: (state) => ({ ...state, n: 1 }),
  'GO | EFFECT': () => console.log('go'),
}
export default App
`
    fs.writeFileSync(file, src)
    const diags = checkFiles([file], { cwd: tmp, strict: true })
    expect(find(diags, 'SYG504').fix).toContain("merge it into the existing 'GO' entry")
    fixFiles([file], { cwd: tmp })
    expect(fs.readFileSync(file, 'utf8')).toBe(src)
  })

  it('does not add an event import when `event` is bound to something else', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-fix-'))
    const file = path.join(tmp, 'App.jsx')
    const src = `import { emit } from 'sygnal'
const event = 1
function App() { return <button className="go">go</button> }
App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
App.model = { GO: emit('GONE') }
export default App
`
    fs.writeFileSync(file, src)
    fixFiles([file], { cwd: tmp })
    expect(fs.readFileSync(file, 'utf8')).toBe(src)
  })

  it('removes an emit import only when nothing else uses it', () => {
    expect(removeUnusedEmitImport(`import { a, emit } from 'sygnal'\na()\n`, 'x.js')).toBe(`import { a } from 'sygnal'\na()\n`)
    expect(removeUnusedEmitImport(`import { emit, a } from 'sygnal'\na()\n`, 'x.js')).toBe(`import { a } from 'sygnal'\na()\n`)
    const used = `import { a, emit } from 'sygnal'\nemit('X')\n`
    expect(removeUnusedEmitImport(used, 'x.js')).toBe(used)
  })

  it('the CLI --fix reports what it fixed, then checks with --strict', () => {
    const root = copy()
    let out = ''
    let err = ''
    const code = main(['.', '--fix', '--fail-on=never'], {
      cwd: root,
      stdout: { write: (s) => { out += s } },
      stderr: { write: (s) => { err += s } },
    })
    expect(code).toBe(0)
    expect(err).toMatch(/^sygnal-check: fixed \d+ issues in 2 files$/m)
    expect(out).toContain('SYG501')
    expect(out).not.toContain('SYG504')
  })
})
