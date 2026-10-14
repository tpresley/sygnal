/**
 * PLAN-7 C-2: end ranges. Every finding carries endLine / endColumn (1-based, endColumn
 * exclusive, UTF-16 units like Babel's loc), from the node the rule reports (or `endNode`);
 * `anchor` keeps old `// sygnal-ignore` comments working where a range was narrowed; `related`
 * locates the other side of pair and cross-file findings. Spike: dev-plans/research/p7-spikes/0-S1.md.
 *
 * test/fixtures/ranges/cases.json holds one small project per rule code, harvested from the
 * findings the rest of this suite produces (the smallest project for each code).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  check, checkFiles, graphFiles, validateSchema, buildProject, runRules,
  coreRules, strictRules, a11yRules, formatDiagnostics,
} from '../src/index.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'schema/inspect.schema.json'), 'utf8'))
const CASES = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'test/fixtures/ranges/cases.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function project(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-c2-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const root = tmp
  const sources = Object.keys(files).map(f => path.join(root, f))
  return { root, sources, check: (opts = {}) => checkFiles(sources, { cwd: root, strict: true, includeTests: true, ...opts }) }
}

/** The source text a range covers (endColumn exclusive). */
function underlined(src, d) {
  const lines = src.split('\n')
  if (d.line === d.endLine) return lines[d.line - 1].slice(d.column - 1, d.endColumn - 1)
  const parts = [lines[d.line - 1].slice(d.column - 1)]
  for (let l = d.line + 1; l < d.endLine; l++) parts.push(lines[l - 1])
  parts.push(lines[d.endLine - 1].slice(0, d.endColumn - 1))
  return parts.join('\n')
}

// [code, file, line, underlined text] — one per rule code, for the project in cases.json
const RANGES = [
  ['SYG101', 'App.jsx', 3, 'HYDRATE'],
  ['SYG102', 'T.jsx', 3, 'A'],
  ['SYG104', 'App.jsx', 5, 'Go'],
  ['SYG105', 'App.jsx', 5, "'GONE'"],
  ['SYG110', 'src/App.jsx', 2, "'.b'"],
  ['SYG111', 'C.jsx', 3, 'value={null}'],
  ['SYG112', 'App.jsx', 3, "'RECIEVED'"],
  ['SYG124', 'App.jsx', 7, 'TodoItem'],
  ['SYG125', 'App.jsx', 2, 'Add.model'],
  ['SYG126', 'App.jsx', 3, '<A'],                 // endNode: "<Control", not the whole tag
  ['SYG127', 'C.jsx', 4, 'pager'],
  ['SYG128', 'a.js', 2, 'Add'],
  ['SYG129', 'src/App.jsx', 5, 'Card'],           // the selected component, not the CHILD.select() call
  ['SYG140', 'w.js', 4, "'rtae'"],
  ['SYG141', 'Order.jsx', 14, "'.actions'"],
  ['SYG142', 'Order.jsx', 15, 'opne'],
  ['SYG143', 'Order.jsx', 14, 'Menu'],
  ['SYG144', 'w.js', 3, "'change'"],
  ['SYG150', 'Counter.jsx', 10, 'INCREMNT'],
  ['SYG151', 'Counter.jsx', 10, 'tools'],
  ['SYG152', 'Chat.jsx', 8, 'messages'],          // the `messages` key, not the request object
  ['SYG153', 'Signup.jsx', 2, 'toolname="sign_up"'],
  ['SYG161', 'c.jsx', 5, 'Box'],                  // the render value
  ['SYG162', 'c.jsx', 3, 'a'],                    // the part's key
  ['SYG223', 'TodoApp.jsx', 10, "'filtr'"],
  ['SYG250', 'c.jsx', 3, "'b'"],
  ['SYG253', 'c.jsx', 3, 'descrption'],
  ['SYG254', 'c.jsx', 4, "'KPI card: monthly revenue total'"],
  ['SYG450', 'c.jsx', 3, "'drawer'"],
  ['SYG680', 'c.jsx', 3, 'heading'],
  ['SYG224', 'TodoApp.jsx', 10, 'TodoApp.persist'],
  ['SYG226', 'C.jsx', 6, "'SETT'"],
  ['SYG240', 'Counter.jsx', 10, "{ type: 'integer' }"],
  ['SYG243', 'Counter.jsx', 10, 'z.date()'],
  ['SYG246', 'Stats.jsx', 5, 'async (state) => state.n'],
  ['SYG247', 'Pay.jsx', 6, 'pay'],
  ['SYG248', 'Shop.jsx', 6, "'search'"],
  ['SYG401', 'collection-from.jsx', 13, 'from="item"'],
  ['SYG426', 'App.jsx', 3, 'collection'],         // the tag name (what --fix renames)
  ['SYG427', 'parent.jsx', 2, 'Child'],          // the first use (the tag), the import as related
  ['SYG405', 'Search.jsx', 4, 'Search.initialState'],
  ['SYG422', 'T.jsx', 2, '100'],                  // a spec that isn't an object: the value
  ['SYG440', 'Right.jsx', 3, "'panel'"],
  ['SYG441', 'TodoApp.jsx', 30, '{ text, done: false }'],
  ['SYG501', 'positional-view.jsx', 2, 'state'],
  ['SYG503', 'reducers.jsx', 49, "player.send('play')"], // the call, without the ";"
  ['SYG504', 'App.jsx', 5, "'GO | EFFECT'"],
  ['SYG505', 'App.jsx', 5, "emit('GONE')"],
  ['SYG506', 'P.jsx', 12, "'Thing'"],
  ['SYG507', 'prop-drilling.jsx', 13, 'theme={theme}'],
  ['SYG508', 'Quote.jsx', 4, "HTTP.select('quote')"],
  ['SYG609', 'src/Chat.jsx', 3, 'WS'],            // the sink key, not the sink function
  ['SYG612', 'App.jsx', 3, 'App.stateSourceName'],
  ['SYG634', 'App.jsx', 8, 'q'],
  ['SYG640', 'F.jsx', 5, "'.x'"],
  ['SYG641', 'F.jsx', 5, 'fokus'],
  ['SYG643', 'src/Feed.jsx', 2, 'Feed.connections'],
  ['SYG701', 'App.jsx', 2, "'.x b'"],
  ['SYG702', 'App.jsx', 2, '<input'],
  ['SYG703', 'App.jsx', 2, '<img'],
  ['SYG704', 'App.jsx', 2, "'.x'"],
  ['SYG705', 'App.jsx', 3, '<A'],
  ['SYG706', 'App.jsx', 3, 'tabIndex={2}'],
  ['SYG707', 'App.jsx', 3, 'aria-lable="x"'],
  ['SYG708', 'App.jsx', 3, "for={uid('a')}"],
  ['SYG722', 'View.jsx', 5, '<Combobox'],
  ['SYG724', 'TaskList.jsx', 23, "'.grip'"],
  ['SYG730', 'App.jsx', 5, "'.more'"],
  ['SYG731', 'Star.jsx', 2, 'className={{ star: true, on: state.on }}'],
]

describe('C-2: a range for every rule code', () => {
  it('covers every code the rules report', () => {
    const codes = new Set([...coreRules, ...strictRules, ...a11yRules].flatMap(r => r.codes))
    expect([...codes].filter(c => !RANGES.some(r => r[0] === c)).sort()).toEqual([])
    expect(Object.keys(CASES).sort()).toEqual(RANGES.map(r => r[0]).sort())
  })

  it.each(RANGES)('%s underlines its node (%s:%i)', (code, file, line, text) => {
    const files = CASES[code]
    const d = project(files).check().find(x => x.code === code && x.file === file && x.line === line)
    expect(d, `${code} at ${file}:${line}`).toBeTruthy()
    expect(Number.isInteger(d.endLine) && Number.isInteger(d.endColumn)).toBe(true)
    expect(d.endLine > d.line || (d.endLine === d.line && d.endColumn > d.column)).toBe(true)
    expect(underlined(files[file], d)).toBe(text)
  })

  it('no fixture finding has a multi-line range', () => {
    const multi = []
    for (const files of Object.values(CASES)) {
      for (const d of project(files).check()) if (d.endLine !== d.line) multi.push(`${d.code} ${d.file}:${d.line}`)
      fs.rmSync(tmp, { recursive: true, force: true }); tmp = null
    }
    expect(multi).toEqual([])
  })

  it('counts columns in UTF-16 units, like LSP', () => {
    const src = `export function App({ state }) {
  return <div className="a">{'😀 é'}</div>
}
App.intent = ({ DOM }) => ({ GO: DOM.click('😀.b') })
App.model = { GO: (s) => s }
`
    const d = project({ 'App.jsx': src }).check().find(x => x.code === 'SYG110')
    // '😀.b' with its quotes: 4 + 2 UTF-16 units (the emoji is a surrogate pair)
    expect(d.endColumn - d.column).toBe(6)
    expect(underlined(src, d)).toBe("'😀.b'")
  })
})

// dev-plans/research/p7-spikes/0-S1/probe: the wide nodes, formatted the way real code is
const PROBE = `import { ABORT } from 'sygnal'

export function App({ state }) {
  return (
    <main>
      <img
        className="cover"
        src={state.cover}
      />
      <button
        type="button"
        className={state.starred ? 'star on' : 'star'}
      >
        Star
      </button>
      <button
        type="button"
        className="close"
      />
      <input
        type="text"
        className="search"
      />
      <ul className="list">{state.courses.length}</ul>
    </main>
  )
}
App.initialState = { courses: [], cover: '', starred: false }
App.intent = ({ DOM }) => ({
  STAR: DOM.click('.star'),
  LOAD: DOM.click('.list'),
  CLOSE: DOM.click('.close'),
  ASK: DOM.click('.cover'),
})
App.timers = (state) => ({
  tick: state.starred && {
    every: 0,
    action: 'TICK',
  },
  pulse: {
    every: 1000,
  },
})
App.model = {
  STAR: (state) => ({ ...state, starred: !state.starred }),
  LOAD: {
    HTTP: () => ({
      url: '/api/courses',
      ok: 'LOADED',
    }),
  },
  LOADED: (state, courses) => ({ ...state, courses }),
  CLOSE: (state) => {
    console.log('closing')
    return ABORT
  },
  ASK: {
    LLM: (state) => ({
      messages: state.messages,
      delta: 'DELTA',
    }),
  },
  DELTA: (state) => state,
  TICK: (state) => state,
}
`
const MAIN = `import { run } from 'sygnal'
import { App } from './App.jsx'

run(App)
`
const NARROWED = ['SYG152', 'SYG422', 'SYG503', 'SYG609', 'SYG702', 'SYG703', 'SYG705', 'SYG731']
const spans = (diags, src) => diags.filter(d => NARROWED.includes(d.code))
  .map(d => `${d.code} ${d.line}:${d.column}-${d.endLine}:${d.endColumn} ${underlined(src, d)}`)

describe('C-2: multi-line constructs (the 0-S1 probe)', () => {
  it('underlines the narrow node, on one line', () => {
    const p = project({ 'App.jsx': PROBE, 'main.js': MAIN })
    expect(spans(p.check(), PROBE)).toEqual([
      'SYG703 6:7-6:11 <img',
      "SYG731 12:9-12:55 className={state.starred ? 'star on' : 'star'}",
      'SYG705 16:7-16:14 <button',
      'SYG702 20:7-20:13 <input',
      'SYG422 37:5-37:13 every: 0',                       // the wrong value
      'SYG422 40:3-40:8 pulse',                           // a missing key: the timer's name
      'SYG609 47:5-47:9 HTTP',
      "SYG503 54:5-54:27 console.log('closing')",
      'SYG609 58:5-58:8 LLM',
      'SYG152 59:7-59:15 messages',
    ])
  })

  it('a timer spec with a wrong action underlines the action property', () => {
    const src = `export function T() { return <div /> }
T.timers = {
  t: () => ({
    every: 10,
    action: 42,
  }),
}
`
    const d = project({ 'T.jsx': src }).check().filter(x => x.code === 'SYG422')
    expect(d.map(x => underlined(src, x))).toEqual(['action: 42'])
  })
})

describe('C-2: sygnal-ignore comments on the old (anchor) line', () => {
  const withComments = PROBE
    .replace('      <button\n        type="button"\n        className={state.starred', '      {/* sygnal-ignore SYG731 */}\n      <button\n        type="button"\n        className={state.starred')
    .replace('    LLM: (state) => ({', '    // sygnal-ignore SYG152\n    LLM: (state) => ({')
    .replace('  tick: state.starred && {', '  // sygnal-ignore SYG422\n  tick: state.starred && {')

  it('a comment above the element / object still suppresses the narrowed finding', () => {
    expect(withComments).not.toBe(PROBE)
    const left = project({ 'App.jsx': withComments, 'main.js': MAIN }).check()
      .filter(d => ['SYG731', 'SYG152', 'SYG422'].includes(d.code))
      .map(d => `${d.code} ${underlined(withComments, d)}`)
    // only the uncommented timer (pulse) is left
    expect(left).toEqual(['SYG422 pulse'])
  })

  it('the narrowed start lines are out of the comment\'s reach without the anchor', () => {
    // a comment above the anchor line reaches only that line: the narrowed starts are below it
    const diags = project({ 'App.jsx': PROBE, 'main.js': MAIN }).check()
    const moved = (code, anchorLine) => diags.find(d => d.code === code && d.line > anchorLine)
    expect(moved('SYG731', 10)).toBeTruthy()      // <button on line 10
    expect(moved('SYG152', 58)).toBeTruthy()      // LLM: (state) => ({ on line 58
    expect(moved('SYG422', 36)).toBeTruthy()      // tick: … && { on line 36
  })

  it('a comment on the narrowed line works too', () => {
    const src = PROBE.replace('      messages: state.messages,', '      messages: state.messages, // sygnal-ignore SYG152')
    expect(project({ 'App.jsx': src, 'main.js': MAIN }).check().filter(d => d.code === 'SYG152')).toEqual([])
  })
})

describe('C-2: related locations', () => {
  const rel = (d) => d.related?.map(r => `${r.file}:${r.line}:${r.column}-${r.endLine}:${r.endColumn} ${r.message}`)

  it.each([
    ['SYG104', ['App.jsx:4:33-4:37 <Card> is rendered here; its DOM events stay inside it', 'App.jsx:4:39-4:41 control <Go> is rendered here, inside <Card>']],
    ['SYG128', ["a.js:2:29-2:32 'Add' is first declared here"]],
    ['SYG129', ['src/List.jsx:2:47-2:51 List renders <Card> here']],
    ['SYG440', ["Left.jsx:3:22-3:29 Left.agent is also named 'panel'"]],
    ['SYG609', ['src/main.js:4:1-4:4 this run() call registers no WS driver']],
    ['SYG643', ['src/main.js:3:1-3:4 this run() call registers no makeSocketDriver() driver']],
  ])('%s points at the other side', (code, expected) => {
    const [, file, line] = RANGES.find(r => r[0] === code)
    const files = CASES[code]
    const d = project(files).check().find(x => x.code === code && x.file === file && x.line === line)
    expect(rel(d)).toEqual(expected)
    for (const r of d.related) {
      const text = underlined(files[r.file], r)
      expect(text.length).toBeGreaterThan(0)
    }
  })

  it('SYG104 by class: the child tag and the className attribute that renders it (also in another file)', () => {
    const fixture = path.join(pkgRoot, 'test/fixtures/bad/parent-selects-child.jsx')
    const diags = check([fixture], { cwd: pkgRoot }).filter(d => d.code === 'SYG104')
    const by = Object.fromEntries(diags.map(d => [d.data.selector, d.related.map(r => {
      const src = fs.readFileSync(path.join(pkgRoot, r.file), 'utf8')
      return `${path.basename(r.file)} ${underlined(src, r)}: ${r.message}`
    })]))
    expect(by['.remove']).toEqual([
      'parent-selects-child.jsx Collection: <TodoItem> is rendered here; its DOM events stay inside it',
      'TodoItem.jsx className="remove": .remove is rendered here, inside <TodoItem>',
    ])
    // JSX passed into a child renders in the child's scope: the element is in the parent's file
    expect(by['.panel-close']).toEqual([
      'parent-selects-child.jsx Panel: <Panel> is rendered here; its DOM events stay inside it',
      'parent-selects-child.jsx className="panel-close": .panel-close is rendered here, inside <Panel>',
    ])
  })

  it('SYG105: a near-miss type on the other side', () => {
    const src = `import { event } from 'sygnal'
export function A() { return <div /> }
A.intent = ({ EVENTS }) => ({ SAVED: EVENTS.select('DOC_SAVED') })
A.model = { SAVED: (s) => s, SAVE: { EVENTS: event('DOC_SAVE', () => 1) } }
`
    const diags = project({ 'A.jsx': src }).check().filter(d => d.code === 'SYG105')
    expect(diags.map(d => [d.data.type, rel(d)])).toEqual([
      ['DOC_SAVED', ["A.jsx:4:52-4:62 'DOC_SAVE' is emitted here"]],
      ['DOC_SAVE', ["A.jsx:3:52-3:63 'DOC_SAVED' is selected here"]],
    ])
  })

  it('SYG105 without a close name has no related', () => {
    const d = project(CASES.SYG105).check().find(x => x.code === 'SYG105')
    expect(d.related).toBeUndefined()
    expect('related' in d).toBe(false)
  })

  it('a related entry without a node is dropped', () => {
    const p = project({ 'A.jsx': 'export function A() { return <div /> }\n' })
    const proj = buildProject(p.sources, { cwd: p.root })
    const file = proj.files.get(p.sources[0])
    const node = file.ast.program.body[0]
    const rule = { id: 't', codes: ['SYG110'], run: (_, report) => report({ code: 'SYG110', file, node, message: 'm', related: [{ message: 'no node' }, { node: node.declaration.id, message: 'the name' }] }) }
    const [d] = runRules(proj, [rule])
    expect(d.related).toEqual([{ file: 'A.jsx', line: 1, column: 17, endLine: 1, endColumn: 18, message: 'the name' }])
  })
})

describe('C-2: SYG900', () => {
  it('a parse error is one character at the parser position', () => {
    const d = project({ 'Broken.jsx': 'export const x = (\n' }).check().find(x => x.code === 'SYG900')
    expect(d.endLine).toBe(d.line)
    expect(d.endColumn).toBe(d.column + 1)
  })

  it('a rule crash has no location and no range', () => {
    const p = project({ 'A.jsx': 'export function A() { return <div /> }\n' })
    const proj = buildProject(p.sources, { cwd: p.root })
    const [d] = runRules(proj, [{ id: 'boom', codes: [], run() { throw new Error('boom') } }])
    expect(d).toMatchObject({ code: 'SYG900', file: '', line: 0, column: 0 })
    expect('endLine' in d || 'endColumn' in d).toBe(false)
  })
})

describe('C-2: output', () => {
  it('--json carries endLine / endColumn / related; the text output is unchanged', () => {
    const p = project(CASES.SYG128)
    const args = Object.keys(CASES.SYG128)
    const json = spawnSync(process.execPath, [path.join(pkgRoot, 'bin/sygnal-check.js'), '--json', ...args], { cwd: p.root, encoding: 'utf8' })
    const [d] = JSON.parse(json.stdout).filter(x => x.code === 'SYG128')
    expect(Object.keys(d)).toEqual(['code', 'severity', 'message', 'fix', 'docsUrl', 'file', 'line', 'column', 'endLine', 'endColumn', 'related', 'data', 'text'])
    expect(d.related[0]).toMatchObject({ file: 'a.js', line: 2 })
    const text = spawnSync(process.execPath, [path.join(pkgRoot, 'bin/sygnal-check.js'), ...args], { cwd: p.root, encoding: 'utf8' })
    expect(text.stdout).not.toMatch(/endLine|related/)
    expect(text.stdout).toContain(`a.js:${d.line}:${d.column} SYG128`)
    const { endLine, endColumn, related, ...withoutRange } = d
    expect(formatDiagnostics([d])).toBe(formatDiagnostics([withoutRange]))
  })

  it('graph diagnostics carry the range and related, and validate against the schema', () => {
    for (const code of ['SYG104', 'SYG129', 'SYG609', 'SYG731']) {
      const p = project(CASES[code])
      const g = graphFiles(p.sources, { cwd: p.root, strict: true })
      expect(validateSchema(schema, g), code).toEqual([])
      const all = [...g.diagnostics, ...g.components.flatMap(c => c.diagnostics)]
      const d = all.find(x => x.code === code)
      expect(Number.isInteger(d.endLine) && Number.isInteger(d.endColumn), code).toBe(true)
      if (code !== 'SYG731') expect(d.related?.length, code).toBeGreaterThan(0)
      fs.rmSync(tmp, { recursive: true, force: true }); tmp = null
    }
  })

  it('the schema rejects a malformed related entry', () => {
    const p = project(CASES.SYG609)
    const g = graphFiles(p.sources, { cwd: p.root })
    const d = [...g.diagnostics, ...g.components.flatMap(c => c.diagnostics)].find(x => x.code === 'SYG609')
    d.related[0].extra = 1
    delete d.related[0].endColumn
    expect(validateSchema(schema, g).join('\n')).toMatch(/endColumn[\s\S]*extra|extra[\s\S]*endColumn/)
  })
})
