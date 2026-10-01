// sygnal-check --graph / graph(): the static InspectGraph, validated against schema/inspect.schema.json
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { graph, validateSchema } from '../src/index.js'
import { main } from '../src/cli.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')
const schema = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'schema/inspect.schema.json'), 'utf8'))
const g = (inputs, opts = {}) => graph(inputs, { cwd: pkgRoot, ...opts })
const comp = (graph, name, file) => graph.components.find(c => c.name === name && (!file || c.file.endsWith(file)))

function run(args, cwd = pkgRoot) {
  let out = ''
  let err = ''
  const code = main(args, { cwd, stdout: { write: (s) => { out += s } }, stderr: { write: (s) => { err += s } } })
  return { code, out, err }
}

describe('graph()', () => {
  it('serializes the fixtures into a schema-valid InspectGraph', () => {
    for (const inputs of [['test/fixtures/good'], ['test/fixtures/bad'], ['test/fixtures/strict']]) {
      expect(validateSchema(schema, g(inputs)), inputs[0]).toEqual([])
      expect(validateSchema(schema, g(inputs, { strict: true })), inputs[0]).toEqual([])
    }
  })

  it('components: id, kind, actions with triggers, state, events, children, selectors', () => {
    const graph = g(['test/fixtures/good/todo-app.jsx'])
    expect(graph.version).toBe(1)
    expect(graph.source).toBe('static')
    const app = comp(graph, 'App')
    expect(app.id).toBe('test/fixtures/good/todo-app.jsx:49')
    expect(app.file).toBe('test/fixtures/good/todo-app.jsx')
    expect(app.parentId).toBe(null)
    expect(app.kind).toBe('root')
    const actions = Object.fromEntries(app.actions.map(a => [a.name, a]))
    expect(actions.ADD).toEqual({ name: 'ADD', trigger: 'intent', sinks: ['STATE', 'EVENTS'] })
    expect(actions.BOOTSTRAP).toEqual({ name: 'BOOTSTRAP', trigger: 'builtin', sinks: ['EFFECT'] })
    expect(actions.LOAD).toEqual({ name: 'LOAD', trigger: 'next', sinks: ['STATE'] })
    expect(app.stateKeys).toEqual(['input', 'todos', 'filter', 'page', 'modal', 'status'])
    expect(app.eventsSelected).toEqual(expect.arrayContaining(['TODO_REMOVED', 'CARD_PING']))
    expect(app.children).toEqual([
      { name: 'TodoItem', via: 'collection', from: 'todos' },
      { name: 'Home', via: 'switchable' },
      { name: 'About', via: 'switchable' },
      { name: 'Card', via: 'tag' },
    ])
    expect(app.selectors[0]).toEqual({ selector: '.new-todo', events: ['input'], matched: true, isolationHit: null })
    expect(app.selectors.find(s => s.selector === 'document')).toEqual({ selector: 'document', events: ['keydown'], matched: null, isolationHit: null })
    expect(app.diagnostics).toEqual([])

    const item = comp(graph, 'TodoItem')
    expect(item.kind).toBe('collection-item')
    expect(item.actions).toEqual([
      { name: 'TOGGLE', trigger: 'intent', sinks: ['STATE'] },
      { name: 'REMOVE', trigger: 'intent', sinks: ['PARENT', 'EVENTS'] },
    ])
    expect(item.eventsEmitted).toEqual(['TODO_REMOVED'])
    expect(item.selectors.map(s => [s.selector, s.events])).toEqual([['.toggle', ['click']], ['.remove', ['click']]])
    expect(comp(graph, 'Card').kind).toBe('child')
    expect(graph.events.TODO_REMOVED).toEqual({ emitters: ['TodoItem'], selectors: ['App'] })
    expect(graph.events.CARD_PING).toEqual({ emitters: ['Card'], selectors: ['App'] })
  })

  it('selectors: isolation hits and misses come from SYG104 / SYG110, and diagnostics attach to their component', () => {
    const graph = g(['test/fixtures/bad/parent-selects-child.jsx', 'test/fixtures/bad/selector-typo.jsx'])
    const parent = comp(graph, 'App', 'parent-selects-child.jsx')
    expect(parent.selectors.find(s => s.selector === '.remove')).toEqual({ selector: '.remove', events: ['click'], matched: false, isolationHit: 'TodoItem' })
    expect(parent.selectors.find(s => s.selector === '.panel').isolationHit).toBe('Panel')
    expect(parent.diagnostics.map(d => d.code)).toEqual(['SYG104', 'SYG104', 'SYG104', 'SYG104'])
    expect(parent.diagnostics[0]).toMatchObject({ file: 'test/fixtures/bad/parent-selects-child.jsx', line: expect.any(Number), column: expect.any(Number) })
    const typo = comp(graph, 'App', 'selector-typo.jsx')
    expect(typo.selectors.find(s => s.selector === '.add-todo-button')).toMatchObject({ matched: false, isolationHit: null })
    expect(typo.selectors.find(s => s.selector === '.new-todo-input').matched).toBe(true)
    expect(typo.diagnostics.every(d => d.code === 'SYG110')).toBe(true)
  })

  it('triggers: next() literals vs unreachable entries; intent actions without a model entry', () => {
    const form = comp(g(['test/fixtures/bad/intent-model-mismatch.jsx']), 'Form')
    const t = Object.fromEntries(form.actions.map(a => [a.name, [a.trigger, a.sinks]]))
    expect(t.SAVE).toEqual(['intent', []])
    expect(t.CLEAR).toEqual(['next', ['STATE']])
    expect(t.SAV).toEqual(['unknown', ['STATE']])
    expect(t.READY).toEqual(['builtin', ['READY']])
  })

  it('contextConsumes: fields the view reads from context', () => {
    const dir = fs.mkdtempSync(path.join(pkgRoot, 'test', '.tmp-graph-'))
    try {
      fs.writeFileSync(path.join(dir, 'App.jsx'), [
        `function Child({ state, context }) { const { theme } = context; return <p className={theme}>{context.user?.name}</p> }`,
        `Child.intent = () => ({})`,
        `function Other({ context: { locale } }) { return <p>{locale}</p> }`,
        `Other.model = {}`,
        `function App() { return <div><Child /><Other /></div> }`,
        `App.context = { theme: () => 'dark', user: s => s.user, locale: () => 'en' }`,
        `App.initialState = { user: null }`,
      ].join('\n'))
      const graph = g([dir])
      expect(comp(graph, 'Child').contextConsumes.sort()).toEqual(['theme', 'user'])
      expect(comp(graph, 'Other').contextConsumes).toEqual(['locale'])
      expect(comp(graph, 'App').contextProvides).toEqual(['theme', 'user', 'locale'])
      expect(comp(graph, 'App').children).toEqual([{ name: 'Child', via: 'tag' }, { name: 'Other', via: 'tag' }])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('strict: true adds the SYG5xx findings', () => {
    const plain = g(['test/fixtures/strict/bad/model-forms.jsx'])
    const strict = g(['test/fixtures/strict/bad/model-forms.jsx'], { strict: true })
    const codes = (graph) => [...graph.components.flatMap(c => c.diagnostics), ...graph.diagnostics].map(d => d.code)
    expect(codes(plain).some(c => c.startsWith('SYG5'))).toBe(false)
    expect(codes(strict)).toEqual(expect.arrayContaining(['SYG504', 'SYG505']))
  })
})

describe('sygnal-check --graph', () => {
  it('--json prints the InspectGraph and exits 0', () => {
    const r = run(['test/fixtures/bad/selector-typo.jsx', '--graph', '--json'])
    expect(r.code).toBe(0)
    const graph = JSON.parse(r.out)
    expect(validateSchema(schema, graph)).toEqual([])
    expect(graph.components.map(c => c.name)).toEqual(['App'])
  })

  it('prints a text summary without --json', () => {
    const r = run(['test/fixtures/good/todo-app.jsx', '--graph'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('App  test/fixtures/good/todo-app.jsx:49  root')
    expect(r.out).toContain('children  TodoItem (collection from \'todos\'), Home (switchable), About (switchable), Card (tag)')
    expect(r.out).toContain('TODO_REMOVED  TodoItem → App')
  })

  it('rejects --graph --fix', () => {
    const r = run(['--graph', '--fix'])
    expect(r.code).toBe(2)
    expect(r.err).toContain('--graph and --fix cannot be combined')
  })
})
