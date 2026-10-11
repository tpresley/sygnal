// PLAN-7 N-1 (the actions part): range() and the occurrence index (src/model/positions.js), on
// small projects, 0-S3's edge-case fixture, and every example's src/ against the spike's
// prototype (dev-plans/research/p7-spikes/0-S3/positions.mjs).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildProject } from '../src/model/project.js'
import { expandInputs } from '../src/files.js'
import { parseSource } from '../src/ast.js'
import { range, buildIndex, createLookup } from '../src/model/positions.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const spike = path.join(repo, 'dev-plans/research/p7-spikes/0-S3')

const cleanup = []
afterEach(() => { for (const d of cleanup.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

function temp(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-pos-')))
  cleanup.push(dir)
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}

function indexOf(dir, opts = {}) {
  const { files } = expandInputs([dir], { cwd: dir })
  const project = buildProject(files, { cwd: dir, sources: opts.sources })
  return { project, index: buildIndex(project, opts) }
}

/** `name kind line:col-endCol` for each occurrence (1-based, endCol exclusive), optionally of one file. */
const brief = (index, file) => index.occurrences.filter(o => !file || o.file.endsWith(file))
  .map(o => `${o.name} ${o.kind} ${o.line}:${o.column}-${o.endColumn}`)

/** The source text an occurrence covers. */
const textAt = (o) => fs.readFileSync(o.file, 'utf8').slice(o.start, o.end)

describe('range()', () => {
  const ast = parseSource(`const a = { 'SAVE | EVENTS': 1, B: 2 }\nconst s = \`x\`\n`, 'x.js')
  const obj = ast.program.body[0].declarations[0].init
  const str = obj.properties[0].key
  it('a node: offsets, 1-based line/column, exclusive end', () => {
    expect(range(str)).toEqual({ start: 12, end: 27, line: 1, column: 13, endLine: 1, endColumn: 28 })
    expect(range(obj.properties[1].key)).toEqual({ start: 32, end: 33, line: 1, column: 33, endLine: 1, endColumn: 34 })
  })
  it('inner: a string or template literal without its quotes; sub: a part of it', () => {
    expect(range(str, { inner: true })).toEqual({ start: 13, end: 26, line: 1, column: 14, endLine: 1, endColumn: 27 })
    expect(range(str, { inner: true, sub: [0, 4] })).toEqual({ start: 13, end: 17, line: 1, column: 14, endLine: 1, endColumn: 18 })
    const tpl = ast.program.body[1].declarations[0].init
    expect(range(tpl, { inner: true })).toMatchObject({ start: 50, end: 51, line: 2, column: 12, endColumn: 13 })
    expect(range(obj.properties[1].key, { inner: true })).toEqual(range(obj.properties[1].key)) // not a literal
  })
  it('null without a location', () => {
    expect(range(null)).toBeNull()
    expect(range({ type: 'Identifier' })).toBeNull()
  })
})

describe('buildIndex: 0-S3 edge fixture', () => {
  const { project, index } = indexOf(path.join(spike, 'fixture'))
  const edge = path.join(spike, 'fixture/Edge.jsx')
  const comp = index.components[0]

  it('every action kind, with its contents range', () => {
    expect(index.components).toEqual([{ id: `${edge}:17`, name: 'Edge', file: edge, line: 17 }])
    expect(brief(index)).toEqual([
      'c.BUMP uses 20:15-16', 'c.RESET uses 20:15-16',
      'SAVE intent 23:3-7', 'EXTERNAL intent 25:3-11',
      'UNDO model 27:14-22', 'REDO model 27:14-22',
      'SAVE model 28:3-7',
      'LOADED reply 30:36-42', 'FAILED reply 30:53-59', 'TRIAGED reply 31:44-51',
      'SAVED emit 32:20-25',
      'LOADED model 34:3-9', 'FAILED model 35:4-10', 'TICK model 36:3-7', 'c.BUMP model 37:4-10',
      'POLL timer 39:62-66', 'SAVE agent 40:41-45', 'LOADED agent 40:72-78',
    ])
    for (const o of index.occurrences) if (o.kind !== 'uses' && !o.synthetic) expect(textAt(o)).toBe(o.name.replace(/^c\./, o.kind === 'model' ? 'c.' : ''))
  })

  it('flags: shorthand sub-range, synthetic undoable() entries, behavior names, reply keys', () => {
    const at = (name, kind) => index.occurrences.find(o => o.name === name && o.kind === kind)
    const failed = at('FAILED', 'model')
    expect(failed).toMatchObject({ shorthand: true, role: 'handler', component: comp.id })
    expect(failed.hit).toMatchObject({ column: failed.column, endColumn: failed.endColumn }) // only the action part
    expect(textAt(failed)).toBe('FAILED')
    expect(at('UNDO', 'model')).toMatchObject({ synthetic: true })
    expect(textAt(at('UNDO', 'model'))).toBe('undoable')
    expect(at('c.BUMP', 'model')).toMatchObject({ behavior: 'c' })
    expect(at('c.RESET', 'uses')).toMatchObject({ behavior: 'c', firstParty: false, role: 'trigger' })
    expect(at('LOADED', 'reply')).toMatchObject({ key: 'ok', sink: 'HTTP' })
    expect(at('TRIAGED', 'reply')).toMatchObject({ key: 'ok', sink: 'LLM' })
    expect(at('POLL', 'timer')).toMatchObject({ key: 'action' })
    expect(at('SAVED', 'emit')).toMatchObject({ role: 'emit', component: null })
    // a plain string occurrence: the hit includes the quotes
    const loaded = at('LOADED', 'reply')
    expect(loaded.hit.column).toBe(loaded.column - 1)
    expect(loaded.hit.endColumn).toBe(loaded.endColumn + 1)
  })

  it('dynamic and computed names have no occurrence', () => {
    // [ACTIONS.TICK] intent key, next(PREFIX + ...), EVENTS.select(SAVED) with an imported constant
    expect(index.occurrences.filter(o => o.line === 24)).toEqual([])
    expect(index.occurrences.filter(o => o.line === 29)).toEqual([])
    expect(index.occurrences.some(o => o.kind === 'select')).toBe(false)
    expect(project.components[0].model.dynamicNext).toHaveLength(2)
  })

  it('exclude leaves a file out', () => {
    expect(buildIndex(project, { exclude: new Set([edge]) }).occurrences).toEqual([])
  })
})

describe('buildIndex: built-ins, EVENTS, cross-file and shared definitions', () => {
  it('built-ins are marked', () => {
    const dir = temp({
      'A.jsx': `function A() { return <div /> }\nA.model = { BOOTSTRAP: (s) => s, GO: (s) => s }\nA.intent = ({ DOM }) => ({ GO: DOM.click('.a'), READY: DOM.click('.b') })\n`,
    })
    const { index } = indexOf(dir)
    expect(index.occurrences.filter(o => o.builtin).map(o => `${o.name} ${o.kind}`)).toEqual(['BOOTSTRAP model', 'READY intent'])
  })

  it('EVENTS: emits and selects across files (event(), emit(), raw { type }, EVENTS.select, Toaster)', () => {
    const dir = temp({
      'Emitter.jsx': `import { event, emit } from 'sygnal'\nfunction E() { return <b /> }\nE.intent = ({ DOM }) => ({ A: DOM.click('b'), B: DOM.click('b'), C: DOM.click('b') })\nE.model = {\n  A: { EVENTS: event('SAVED', (s) => s) },\n  B: emit('SAVED', (s) => s),\n  C: { EVENTS: () => ({ type: 'TOAST', data: 1 }) },\n}\n`,
      'Listener.jsx': `import { Toaster } from 'sygnal/ui'\nfunction L() { return <Toaster /> }\nL.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('SAVED') })\nL.model = { GOT: (s) => s }\n`,
    })
    const { index } = indexOf(dir)
    expect(index.occurrences.filter(o => o.component === null).map(o => `${path.basename(o.file)} ${o.name} ${o.kind}${o.implicit ? ' implicit' : ''}`).sort()).toEqual([
      'Emitter.jsx SAVED emit', 'Emitter.jsx SAVED emit', 'Emitter.jsx TOAST emit',
      'Listener.jsx SAVED select', 'Listener.jsx TOAST select implicit', 'Listener.jsx TOAST_DISMISS select implicit',
    ])
    const look = createLookup(index)
    const sel = index.occurrences.find(o => o.kind === 'select' && o.name === 'SAVED')
    expect(look.definition([sel]).map(o => `${path.basename(o.file)}:${o.line}`)).toEqual(['Emitter.jsx:5', 'Emitter.jsx:6'])
    const toast = index.occurrences.find(o => o.kind === 'emit' && o.name === 'TOAST')
    expect(look.definition([toast]).map(o => `${o.name} ${o.implicit}`)).toEqual(['TOAST true'])
  })

  it('an intent and a model imported from other files: occurrences in those files', () => {
    const dir = temp({
      'intent.js': `export const intent = ({ DOM }) => ({ INC: DOM.click('.inc') })\n`,
      'model.js': `export const model = { INC: (s) => s + 1 }\n`,
      'C.jsx': `import { intent } from './intent.js'\nimport { model } from './model.js'\nfunction C() { return <button className="inc" /> }\nC.intent = intent\nC.model = model\n`,
    })
    const { index } = indexOf(dir)
    expect(index.occurrences.map(o => `${path.basename(o.file)} ${o.name} ${o.kind}`)).toEqual(['intent.js INC intent', 'model.js INC model'])
    const look = createLookup(index)
    const [i, m] = index.occurrences
    expect(look.definition([i])).toEqual([m])
    expect(look.definition([m])).toEqual([i])
  })

  it('a model shared by two components: one occurrence per component, definition gives both intents', () => {
    const dir = temp({
      'shared.js': `export const model = { GO: (s) => s }\n`,
      'A.jsx': `import { model } from './shared.js'\nfunction A() { return <a className="a" /> }\nA.intent = ({ DOM }) => ({ GO: DOM.click('.a') })\nA.model = model\n`,
      'B.jsx': `import { model } from './shared.js'\nfunction B() { return <b className="b" /> }\nB.intent = ({ DOM }) => ({ GO: DOM.click('.b') })\nB.model = model\n`,
    })
    const { index } = indexOf(dir)
    const look = createLookup(index)
    const shared = path.join(dir, 'shared.js')
    const here = look.at(shared, 1, 25)
    expect(here.map(o => o.component).sort()).toEqual([`${path.join(dir, 'A.jsx')}:2`, `${path.join(dir, 'B.jsx')}:2`])
    expect(look.definition(here).map(o => path.basename(o.file))).toEqual(['A.jsx', 'B.jsx'])
    // from one component's intent: the shared entry (once)
    const a = index.occurrences.find(o => o.kind === 'intent' && o.file.endsWith('A.jsx'))
    expect(look.definition([a]).map(o => path.basename(o.file))).toEqual(['shared.js'])
    expect(look.references([a]).map(o => `${path.basename(o.file)} ${o.kind}`)).toEqual(['A.jsx intent', 'shared.js model'])
  })
})

describe('createLookup', () => {
  const dir = temp({
    'C.jsx': [
      `function C() { return <button className="go" /> }`,
      `C.intent = ({ DOM }) => ({ GO: DOM.click('.go'), STOP: DOM.click('.go') })`,
      `C.model = {`,
      `  GO: (s, d, next) => { next('DONE'); return s },`,
      `  'STOP | EFFECT': () => {},`,
      `  DONE: { STATE: (s) => s, HTTP: () => ({ url: '/x', ok: 'DONE' }) },`,
      `}`,
      '',
    ].join('\n'),
  })
  const { index } = indexOf(dir)
  const look = createLookup(index)
  const file = path.join(dir, 'C.jsx')
  const names = (list) => list.map(o => `${o.name} ${o.kind} ${o.line}`)

  it('at(): inside the token, at its edges (quotes, the position after it), not outside', () => {
    expect(names(look.at(file, 2, 28))).toEqual(['GO intent 2']) // G of GO
    expect(names(look.at(file, 2, 30))).toEqual(['GO intent 2']) // right after GO
    expect(look.at(file, 2, 31)).toEqual([]) // the colon
    expect(names(look.at(file, 4, 30))).toEqual(['DONE next 4']) // the opening quote
    expect(look.at(file, 4, 29)).toEqual([]) // the parenthesis
    expect(names(look.at(file, 4, 36))).toEqual(['DONE next 4']) // after the closing quote
    expect(look.at(file, 1, 5)).toEqual([])
    expect(look.at('/elsewhere.jsx', 1, 1)).toEqual([])
  })

  it('a shorthand key: only its action part', () => {
    expect(names(look.at(file, 5, 4))).toEqual(['STOP model 5'])
    expect(look.at(file, 5, 3)).toEqual([]) // the quote
    expect(look.at(file, 5, 11)).toEqual([]) // EFFECT
  })

  it('definition and references', () => {
    const next = look.at(file, 4, 32)
    expect(names(look.definition(next))).toEqual(['DONE model 6'])
    const doneModel = look.at(file, 6, 4)
    // no intent key: the other triggers
    expect(names(look.definition(doneModel))).toEqual(['DONE next 4', 'DONE reply 6'])
    expect(names(look.references(doneModel))).toEqual(['DONE next 4', 'DONE model 6', 'DONE reply 6'])
    expect(names(look.references(doneModel, false))).toEqual(['DONE next 4', 'DONE reply 6'])
    expect(names(look.definition(look.at(file, 2, 28)))).toEqual(['GO model 4'])
    expect(names(look.definition(look.at(file, 4, 4)))).toEqual(['GO intent 2'])
  })
})

describe('parity with the 0-S3 prototype (positions.mjs) on every example', () => {
  const examples = fs.readdirSync(path.join(repo, 'examples')).filter(e => fs.existsSync(path.join(repo, 'examples', e, 'src'))).sort()

  it.each(examples)('examples/%s/src', (example) => {
    const dir = path.join(repo, 'examples', example, 'src')
    const out = JSON.parse(execFileSync(process.execPath, [path.join(spike, 'positions.mjs'), dir, '--json'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 }))
    const { index } = indexOf(dir)
    const compIds = new Map() // 'file\0name' → ids
    for (const c of index.components) {
      const k = `${c.file}\0${c.name}`
      compIds.set(k, [...(compIds.get(k) || []), c.id])
    }
    let total = 0
    for (const c of out.components) {
      const ids = compIds.get(`${path.resolve(repo, c.file)}\0${c.name}`)
      expect(ids, `${c.name} in the index`).toBeTruthy()
      const mine = index.occurrences.filter(o => ids.includes(o.component))
      const located = [], behavior = []
      for (const a of c.actions) {
        for (const o of a.occurrences) {
          if (!o.range || /^behavior def|^first-party behavior/.test(o.note || '')) behavior.push(a.name)
          else located.push(`${path.resolve(repo, o.range.file)} ${o.range.start}-${o.range.end} ${a.name}`)
        }
      }
      const actions = mine.filter(o => o.kind !== 'uses').map(o => `${o.file} ${o.start}-${o.end} ${o.name}`)
      expect(actions.sort(), `${example} ${c.name}`).toEqual([...new Set(located)].sort())
      // the behavior names it couldn't locate (first-party: no source) or re-derived: at the uses key
      for (const name of behavior) expect(mine.some(o => o.kind === 'uses' && o.name === name), `${c.name} ${name}`).toBe(true)
      total += located.length + behavior.length
    }
    expect(total).toBe(out.components.reduce((n, c) => n + c.actions.reduce((m, a) => m + a.occurrences.length, 0), 0))
  }, 30_000)
})
