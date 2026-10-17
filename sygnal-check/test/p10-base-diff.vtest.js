// PLAN-10 C-3 / V-6: `--graph --base <ref>`: the base graph read from git (src/gitBase.js), the diff
// (src/graphView/diff.js: graphDiff, formatDiff, diffModel, diffMermaid), the CLI and the page's
// model of the diff (groups.js's "Changes only" filter, folded-group counts).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { main, parseArgs } from '../src/cli.js'
import { openRef, baseGraph, GitBaseError } from '../src/gitBase.js'
import { graphDiff, formatDiff, diffIsEmpty, diffModel, diffMermaid, keyParts, diffSummaryHtml, diffDetailHtml, diffGroupCount, diffEdgeClass } from '../src/graphView/diff.js'
import { buildModel } from '../src/graphView/model.js'
import { toMermaid } from '../src/graphView/mermaid.js'
import { projectView, tierFor, groupKeys } from '../src/graphView/groups.js'
import { graphHtml } from '../src/graphView/html.js'
import { loadConfig } from '../src/config.js'
import { makeDiffRepo } from './fixtures/git-diff-app.js'
import { synthGraph } from './fixtures/graph-synth.js'

const V = { buildModel, toMermaid }
const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
const repo = (opts) => { const r = makeDiffRepo(opts); dirs.push(r.root); return r }
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-nogit-'))); dirs.push(d); return d }

function run(argv, cwd) {
  let out = '', err = ''
  const code = main(argv, { cwd, stdout: { write: (s) => { out += s }, isTTY: false }, stderr: { write: (s) => { err += s } }, env: {}, isTTY: false, openFile: () => {} })
  return { code, out, err }
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** A component as the graph has it, every list empty unless given. */
function comp(name, file, line, extra = {}) {
  return {
    name, id: `${file}:${line}`, key: `${file}#${name}`, parentId: null, file, kind: 'child', actions: [], stateKeys: [], calculated: [],
    contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [], ...extra,
  }
}
const G = (components, events = {}) => ({ version: 1, source: 'static', components, events, diagnostics: [] })

describe('--base: the CLI on a git repository', () => {
  it('--json prints the diff: added, removed (a renamed file is both), changed fields, EVENTS types', () => {
    const { root, git } = repo()
    const r = run(['--graph', '--json', '--base', 'HEAD~1'], root)
    expect(r.code).toBe(0)
    const d = JSON.parse(r.out)
    expect(Object.keys(d)).toEqual(['base', 'head', 'commit', 'added', 'removed', 'changed', 'events'])
    expect(d.base).toBe('HEAD~1')
    expect(d.head).toBe('working tree')
    expect(d.commit).toBe(git('rev-parse', 'HEAD~1').trim())
    expect(d.added).toEqual(['src/Lists.jsx#List', 'src/New.jsx#New'])
    expect(d.removed).toEqual(['src/List.jsx#List', 'src/Old.jsx#Old'])
    expect(d.changed.map(c => c.key)).toEqual(['src/App.jsx#App', 'src/Header.jsx#Header', 'src/Item.jsx#Item'])
    const f = Object.fromEntries(d.changed.map(c => [keyParts(c.key).name, c.fields]))
    expect(f.Header).toEqual({ actions: { added: ['CLOSE', 'OPEN'], removed: ['TOGGLE'] } })
    expect(f.Item).toEqual({ eventsEmitted: { added: ['REMOVED'], removed: ['SAVED'] } })
    expect(f.App.children).toEqual({ added: ['src/Lists.jsx#List', 'src/New.jsx#New'], removed: ['src/List.jsx#List', 'src/Old.jsx#Old'] })
    expect(d.events).toEqual({ added: ['REMOVED'], removed: [] })
  })

  it('text: a summary per component', () => {
    const { root } = repo()
    const r = run(['--graph', '--base', 'HEAD~1'], root)
    expect(r.code).toBe(0)
    expect(r.out.replace(/\([0-9a-f]{10}\)/, '(<sha>)')).toMatchInlineSnapshot(`
      "app graph: HEAD~1 (<sha>) → working tree
      + List  src/Lists.jsx
      + New  src/New.jsx
      - List  src/List.jsx
      - Old  src/Old.jsx
      ~ App: +child List in src/Lists.jsx, +child New, -child List in src/List.jsx, -child Old  src/App.jsx
      ~ Header: +action CLOSE, +action OPEN, -action TOGGLE  src/Header.jsx
      ~ Item: +emits REMOVED, -emits SAVED  src/Item.jsx
      EVENTS: +REMOVED
      2 added, 2 removed, 3 changed
      "
    `)
  })

  it('mermaid: the head graph plus the removed components, classes and linkStyle', () => {
    const { root } = repo()
    const r = run(['--graph=mermaid', '--base', 'HEAD~1'], root)
    expect(r.code).toBe(0)
    expect(r.out).toMatchInlineSnapshot(`
      "flowchart TD
        n0["App"]:::changed
        n1["Header"]:::changed
        n2["Item"]:::changed
        n3["New"]:::added
        n4["List"]:::added
        n5["Old"]:::removed
        n6["List"]:::removed
        n0 --> n1
        n0 --> n4
        n0 --> n3
        n4 -->|"[items]"| n2
        n6 -->|"[items]"| n2
        n0 --> n6
        n0 --> n5
        n2 -.->|"SAVED"| n0
        classDef added stroke:#15803d,stroke-width:2px
        classDef removed stroke:#c81e1e,stroke-dasharray:5 5,opacity:0.6
        classDef changed stroke:#a14a07,stroke-width:2px
        linkStyle 1,2,3 stroke:#15803d,stroke-width:2px
        linkStyle 4,5,6,7 stroke:#c81e1e,stroke-dasharray:5 5
      "
    `)
    expect(run(['--graph=mermaid', '--events=false', '--base', 'HEAD~1'], root).out).not.toContain('-.->')
  })

  it('html: the page carries the base graph and the diff modules; --out writes it', () => {
    const { root } = repo()
    const out = path.join(root, 'page.html')
    const r = run(['--graph=html', '--base', 'HEAD~1', '--out', out], root)
    expect(r.code).toBe(0)
    const html = fs.readFileSync(out, 'utf8')
    expect(html).toContain('"base":{"ref":"HEAD~1"')
    expect(html).toContain('compared with HEAD~1')
    expect(html).toContain('V.diffModel') // the module is inlined (its exports are copied onto V)
    expect(html).toMatch(/diffModel\(V, META\.base\.graph/)
  })

  it('no change against HEAD when the working tree is clean', () => {
    const { root, git } = repo()
    git('add', '-A'); git('commit', '-q', '-m', 'edits')
    const r = run(['--graph', '--json', '--base', 'HEAD'], root)
    expect(diffIsEmpty(JSON.parse(r.out))).toBe(true)
    expect(run(['--graph', '--base', 'HEAD'], root).out).toContain('no changes')
  })

  it('matches by key, not id: a component moved down a few lines is not a change', () => {
    const { root, git } = repo()
    git('add', '-A'); git('commit', '-q', '-m', 'edits')
    fs.writeFileSync(path.join(root, 'src/Header.jsx'), '\n\n\n' + fs.readFileSync(path.join(root, 'src/Header.jsx'), 'utf8'))
    expect(diffIsEmpty(JSON.parse(run(['--graph', '--json', '--base', 'HEAD'], root).out))).toBe(true)
  })

  it('paths missing at the ref: everything in them is added', () => {
    const { root } = repo()
    fs.mkdirSync(path.join(root, 'lib'))
    fs.writeFileSync(path.join(root, 'lib/Extra.jsx'), 'export function Extra() { return <i /> }\nExtra.initialState = { a: 1 }\nExtra.isolatedState = true\n')
    const r = run(['lib', '--graph', '--json', '--base', 'HEAD~1'], root)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out).added).toEqual(['lib/Extra.jsx#Extra'])
    expect(r.err).toContain('lib is not in HEAD~1: everything there counts as added')
  })

  it('reads the config file at the ref (flags still win), and skips test files unless configured', () => {
    const lonely = "export function Lonely() { return <b /> }\nLonely.model = { PING: { EVENTS: () => ({ type: 'PING' }) } }\nLonely.intent = ({ DOM }) => ({ PING: DOM.click('b') })\n"
    const testFile = 'export function InTest() { return <i /> }\nInTest.initialState = { a: 1 }\nInTest.isolatedState = true\n'
    const { root } = repo({ extra: { 'src/Lonely.jsx': lonely, 'src/Thing.test.jsx': testFile } })
    // HEAD's config ignores SYG105; the working tree's doesn't any more
    fs.writeFileSync(path.join(root, 'sygnal-check.config.json'), '{}')
    fs.rmSync(path.join(root, 'src/Thing.test.jsx'))
    const d = JSON.parse(run(['--graph', '--json', '--base', 'HEAD'], root).out)
    const lon = d.changed.find(c => c.key === 'src/Lonely.jsx#Lonely')
    expect(lon.fields.diagnostics.added.some(x => x.startsWith('SYG105'))).toBe(true)
    expect(d.removed).not.toContain('src/Thing.test.jsx#InTest') // the test file was never scanned
    // with --include-tests the base has it (it was deleted in the working tree)
    expect(JSON.parse(run(['--graph', '--json', '--include-tests', '--base', 'HEAD'], root).out).removed).toContain('src/Thing.test.jsx#InTest')
    // --no-config: neither side reads one
    expect(JSON.parse(run(['--graph', '--json', '--no-config', '--base', 'HEAD'], root).out).changed.find(c => c.key === 'src/Lonely.jsx#Lonely')).toBeUndefined()
  })

  it('exit 2: no ref, an unknown ref, a ref like an option, not a git repository, a path outside it, with --watch or without --graph', () => {
    const { root } = repo()
    let r = run(['--graph', '--base'], root)
    expect(r.code).toBe(2); expect(r.err).toContain('--base needs a value')
    r = run(['--graph', '--base', 'no-such-branch'], root)
    expect(r.code).toBe(2); expect(r.err).toContain("unknown git ref 'no-such-branch'")
    r = run(['--graph', '--base=--output=x'], root)
    expect(r.code).toBe(2); expect(r.err).toContain('--base needs a git ref')
    const plain = tmp()
    fs.mkdirSync(path.join(plain, 'src'))
    fs.writeFileSync(path.join(plain, 'src/A.jsx'), 'export function A() { return <i /> }\nA.initialState = {}\n')
    r = run(['--graph', '--base', 'HEAD'], plain)
    expect(r.code).toBe(2); expect(r.err).toContain('--base needs a git repository')
    r = run([plain + '/src', '--graph', '--base', 'HEAD'], root)
    expect(r.code).toBe(2); expect(r.err).toMatch(/is outside the git repository/)
    expect(() => parseArgs(['--graph=html', '--watch', '--base', 'HEAD'])).toThrow('--base cannot be combined with --watch')
    expect(() => parseArgs(['--base', 'HEAD'])).toThrow('--base needs --graph')
  })

  it('openRef / baseGraph: the tree of a commit, read in one batch, symlinked cwd spelling kept', () => {
    const { root } = repo()
    const t = openRef('HEAD~1', { cwd: root })
    expect(t.top).toBe(root)
    expect(t.isFile(path.join(root, 'src/Old.jsx'))).toBe(true)
    expect(t.isFile(path.join(root, 'src/New.jsx'))).toBe(false)
    expect(t.read(path.join(root, 'src/Old.jsx'))).toContain('Old.isolatedState')
    expect(t.read(path.join(root, 'nope.js'))).toBe(null)
    const r = baseGraph(t, ['src'], { cwd: root })
    expect(r.files.map(f => path.relative(root, f))).toEqual(['src/App.jsx', 'src/Header.jsx', 'src/Item.jsx', 'src/List.jsx', 'src/Old.jsx'])
    expect(r.graph.components.map(c => c.key)).toContain('src/Old.jsx#Old')
    expect(() => openRef('-x', { cwd: root })).toThrow(GitBaseError)
    // config.js io: loadConfig at the ref
    const head = openRef('HEAD', { cwd: root })
    expect(loadConfig(root, { io: { exists: head.exists, read: head.readOrThrow } }).config).toEqual({ ignore: ['SYG105'] })
    expect(loadConfig(root, { io: { exists: t.exists, read: t.readOrThrow } }).config).toEqual({})
  })
})

describe('diff.js: pure', () => {
  it('graphDiff: scalars as { base, head }, sinks only of kept actions, selectors and diagnostics without lines', () => {
    const base = G([comp('A', 'a.jsx', 1, { kind: 'root', actions: [{ name: 'X', sinks: ['STATE'] }, { name: 'Y', sinks: ['STATE'] }], selectors: [{ selector: '.x', line: 3 }], diagnostics: [{ code: 'SYG110', message: 'm', line: 4 }] })])
    const head = G([comp('A', 'a.jsx', 9, { kind: 'child', actions: [{ name: 'X', sinks: ['STATE', 'EFFECT'] }, { name: 'Z', sinks: ['EVENTS'] }], selectors: [{ selector: '.x', line: 12 }, { control: 'Add', selector: '[data-control="Add"]' }], diagnostics: [{ code: 'SYG110', message: 'm', line: 40 }] })])
    const d = graphDiff(base, head, { base: 'main' })
    expect(d.changed).toEqual([{ key: 'a.jsx#A', fields: {
      kind: { base: 'root', head: 'child' },
      actions: { added: ['Z'], removed: ['Y'] },
      sinks: { added: ['X:EFFECT'], removed: [] },
      selectors: { added: ['control Add'], removed: [] },
    } }])
    expect(formatDiff(d)).toContain('~ A: kind "root" → "child", +action Z, -action Y, +sink X:EFFECT, +selector control Add  a.jsx')
    expect(keyParts('src/a#b/Item.jsx#Item#2')).toEqual({ file: 'src/a#b/Item.jsx', name: 'Item#2' })
  })

  it('diffModel: removed cards in the model, edges marked, health from the head alone', () => {
    const base = G([
      comp('App', 'App.jsx', 1, { kind: 'root', children: [{ name: 'Old', via: 'tag', id: 'Old.jsx:1' }, { name: 'Keep', via: 'tag', id: 'Keep.jsx:1' }], eventsSelected: ['E'] }),
      comp('Old', 'Old.jsx', 1, { eventsEmitted: ['E'], diagnostics: [{ code: 'SYG110', severity: 'warn', message: 'x' }] }),
      comp('Keep', 'Keep.jsx', 1),
    ], { E: { emitters: ['Old'], selectors: ['App'], emitterIds: ['Old.jsx:1'], selectorIds: ['App.jsx:1'] } })
    const head = G([
      comp('App', 'App.jsx', 3, { kind: 'root', children: [{ name: 'Keep', via: 'tag', id: 'Keep.jsx:1' }, { name: 'New', via: 'tag', id: 'New.jsx:1' }] }),
      comp('Keep', 'Keep.jsx', 1),
      comp('New', 'New.jsx', 1),
    ])
    const DX = diffModel(V, base, head, { base: 'HEAD' })
    const M = DX.M
    const by = (n) => M.comps.find(c => c.name === n)
    expect(by('Old')).toMatchObject({ id: 'base:Old.jsx:1', diff: 'removed', diagnostics: [] })
    expect(by('New').diff).toBe('added')
    expect(by('App').diff).toBe('changed')
    expect(by('Keep').diff).toBeUndefined()
    const re = (from, to) => M.renderEdges.find(e => e.from === by(from).id && e.to === by(to).id)
    expect(re('App', 'Old').diff).toBe('removed')
    expect(re('App', 'New').diff).toBe('added')
    expect(re('App', 'Keep').diff).toBeUndefined()
    expect(M.eventEdges).toEqual([{ from: 'base:Old.jsx:1', to: 'App.jsx:3', type: 'E', diff: 'removed' }])
    expect(M.parentsOf.get('base:Old.jsx:1')).toEqual(['App.jsx:3'])
    expect(DX.headModel.comps.map(c => c.name)).toEqual(['App', 'Keep', 'New'])
    expect(diffEdgeClass({ from: 'App.jsx:3', to: 'base:Old.jsx:1', edge: re('App', 'Old') })).toBe(' diff-removed')
    expect(diffEdgeClass({ from: 'grp:src', to: 'base:Old.jsx:1', edge: re('App', 'Old') })).toBe('')
    // the page's HTML pieces
    const html = diffSummaryHtml(DX, { esc, byId: M.byId })
    expect(html).toContain('data-goto="base:Old.jsx:1"')
    expect(html).toContain('<b>1</b> added')
    expect(diffDetailHtml(DX, by('App'), { esc })).toContain('+ New')
    expect(diffDetailHtml(DX, by('Old'), { esc })).toContain('Removed: in <code>HEAD</code>')
    expect(diffDetailHtml(DX, by('Keep'), { esc })).toBe('')
    expect(diffMermaid(V, base, head, { base: 'HEAD' })).toContain(':::removed')
  })

  it('large tiers: folded groups count their changes; "Changes only" keeps the changed and their ancestors', () => {
    const base = synthGraph(300, 7)
    const head = { ...base, components: base.components.slice(0, -10).map((c, i) => i % 50 === 7 ? { ...c, stateKeys: [...(c.stateKeys || []), 'extra'] } : c) }
    const DX = diffModel(V, base, head)
    const M = DX.M
    expect(DX.diff.removed.length).toBe(10)
    expect(DX.diff.changed.length).toBeGreaterThan(3)
    const tier = tierFor(M.comps.filter(c => !c.ghost && c.diff !== 'removed').length)
    expect(tier.name).toBe('large')
    const groupOf = groupKeys(M)
    const P = projectView(M, { tier, groupOf })
    const counted = P.nodes.filter(n => n.type === 'group').reduce((n, g) => n + diffGroupCount(DX, g.members, M.byId), 0)
    const drawnAlone = P.nodes.filter(n => n.type === 'comp' && n.comp.diff).length
    expect(counted + drawnAlone).toBe(M.comps.filter(c => c.diff).length)
    const C = projectView(M, { tier, groupOf, filter: { changes: true }, open: new Set(groupOf.values()) })
    const shown = [...C.rep.keys()].map(id => M.byId.get(id))
    expect(shown.filter(c => c.diff).length).toBe(M.comps.filter(c => c.diff).length)
    expect(shown.filter(c => !c.diff).every(c => C.dimmed.has(c.id))).toBe(true)
  })

  it('graphHtml: META.base on the page, the diff CSS in the style', () => {
    const g = G([comp('A', 'a.jsx', 1)])
    const html = graphHtml(g, { title: 't', base: { ref: 'main', graph: G([]) } })
    expect(html).toContain('.node.diff-removed')
    expect(html).toContain('"base":{"ref":"main"')
  })
})
