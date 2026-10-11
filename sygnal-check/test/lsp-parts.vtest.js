// PLAN-7 P4 perf: a check's index and completion index as parts (core.js "Parts"): the index
// early (before the rules) when a request waits on the check, else late with the completion index
// (after the diagnostics); the flow's SYG101/SYG102 verdicts from the check's own rule run
// (flow.js tapVerdicts); navigation released by a part, and supersession with parts.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { startServer, tempDir, copyFixture, uriOf, repo, tick } from './lsp-helpers.js'
import { buildProject } from '../src/model/project.js'
import { expandInputs } from '../src/files.js'
import { selectRules } from '../src/rules/index.js'
import { runRules, sortDiagnostics } from '../src/run.js'
import { buildFlow, tapVerdicts } from '../src/lsp/flow.js'
import { createCore } from '../src/lsp/core.js'
import { createChecker } from '../src/lsp/checker.js'
import { createNavigation } from '../src/lsp/navigation.js'

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* already gone */ }
  }
})

const C = `function C({ state }) { return <button className="go">{state.n}</button> }
C.initialState = { n: 0 }
C.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
C.model = { GO: (s) => s }
export default C
`
const PKG = '{ "name": "p", "private": true }'
const dirWith = (files) => {
  const dir = tempDir({ 'package.json': PKG, ...files })
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** The fixture and example directories the verdict comparison runs on. */
const DIRS = [
  ...['bad', 'good', 'strict', 'p7-c4', 'ranges', 'sources'].map(d => path.join(repo, 'sygnal-check/test/fixtures', d)),
  path.join(repo, 'dev-plans/research/p7-spikes/0-S3/fixture'),
  ...fs.readdirSync(path.join(repo, 'examples')).map(e => path.join(repo, 'examples', e, 'src')),
].filter(d => fs.existsSync(d))

describe('flow verdicts from the check\'s own SYG101 / SYG102 run', () => {
  it('the same diagnostics as runRules over the untapped rules, and the same flow as buildFlow re-running the rules', () => {
    let compared = 0, verdicts = 0
    for (const dir of DIRS) {
      const files = expandInputs([dir], { cwd: dir, includeTests: false }).files
      if (!files.length) continue
      for (const strict of [false, true]) {
        const project = buildProject(files, { cwd: dir })
        const selected = selectRules({ strict })
        const plain = sortDiagnostics(runRules(project, selected))
        const tapped = tapVerdicts(selected)
        expect(tapped.rules.filter((r, i) => r !== selected[i])).toHaveLength(2)
        // as core.js runs them: the tapped two first (no parse errors), then the rest
        const first = tapped.rules.filter((r, i) => r !== selected[i])
        const split = sortDiagnostics([
          ...runRules(project, first, { parseErrors: false }),
          ...runRules(project, tapped.rules.filter(r => !first.includes(r))),
        ])
        expect(JSON.stringify(split), dir).toBe(JSON.stringify(plain))
        const reused = buildFlow(project, tapped.verdicts)
        const rerun = buildFlow(project)
        expect(reused, dir).toEqual(rerun)
        for (const f of Object.values(reused)) verdicts += f.unhandled.length + Object.keys(f.untriggered).length
        compared++
      }
    }
    expect(compared).toBeGreaterThanOrEqual(20)
    expect(verdicts).toBeGreaterThan(0) // the fixtures do have SYG101 / SYG102 verdicts
  })

  it('core.check with parts: the same diagnostics, and its index part equals the inline index', () => {
    for (const dir of DIRS.filter(d => /examples|fixtures\/(bad|sources)/.test(d)).slice(0, 6)) {
      const folder = path.dirname(dir).endsWith('examples') ? dir : dir
      const sources = new Map()
      const inline = createCore().check({ folder, settings: { strict: true, paths: ['.'] }, sources })
      const parts = []
      const later = []
      const res = createCore().check({ folder, settings: { strict: true, paths: ['.'] }, sources }, {
        part: (p) => parts.push(p), wanted: () => false, defer: (fn) => later.push(fn),
      })
      if (!inline.components) continue
      expect(res.late).toBe(true)
      expect(res.index).toBeUndefined()
      expect(res.completion).toBeUndefined()
      expect(parts).toHaveLength(0) // not wanted: nothing before the result
      for (const fn of later) fn()
      expect(parts).toHaveLength(1)
      expect(parts[0].index).toEqual(inline.index)
      expect(parts[0].completion).toEqual(inline.completion)
      const strip = ({ ms, index, completion, late, ...r }) => r
      expect(strip(res)).toEqual(strip(inline))
    }
  })
})

describe('checker: parts in order', () => {
  for (const worker of [true, false]) {
    it(`${worker ? 'worker' : 'in-thread'}: an index wanted before the check is early (before the result); else late, with the completion index, after it`, async () => {
      const dir = dirWith({ 'src/C.jsx': C })
      const checker = createChecker({ worker })
      cleanup.push(() => checker.dispose())
      expect(checker.usingWorker).toBe(worker)
      const payload = { folder: dir, settings: {}, sources: new Map() }

      const events = []
      checker.wantIndex()
      const r1 = await checker.call('check', payload, { onPart: (p) => events.push(['part', Object.keys(p).sort().join(',')]) })
      events.push(['result', r1.late])
      await new Promise(r => setTimeout(r, 50))
      expect(events).toEqual([['part', 'index,ms,substituted'], ['result', true], ['part', 'completion']])

      events.length = 0
      const r2 = await checker.call('check', payload, { onPart: (p) => events.push(['part', Object.keys(p).sort().join(',')]) })
      events.push(['result', r2.late])
      await new Promise(r => setTimeout(r, 50))
      // the flag was cleared by the first check's decision
      expect(events).toEqual([['result', true], ['part', 'completion,index,substituted']])
      expect(r2.files).toEqual(r1.files)

      // without onPart: everything in the result, as before
      const r3 = await checker.call('check', payload)
      expect(r3.late).toBeUndefined()
      expect(r3.index.occurrences.length).toBeGreaterThan(0)
      expect(r3.completion).not.toBeNull()
    })
  }
})

describe('navigation with parts (a fake checker)', () => {
  /** A navigation over one folder whose open documents are `docs`; `indexOf(text)` a real index. */
  function setup() {
    const dir = dirWith({ 'src/C.jsx': C })
    const file = path.join(dir, 'src/C.jsx')
    const core = createCore()
    const indexOf = (text) => core.index({ folder: dir, settings: {}, sources: new Map([[file, text]]) })
    const docs = new Map([[file, C]])
    const calls = []
    let wants = 0
    const checker = {
      call: (type, payload) => { calls.push(type); return Promise.resolve(core[type](payload)) },
      wantIndex: () => { wants++ },
    }
    const nav = createNavigation({
      checker, overlaysUnder: () => new Map(docs), settingsFor: () => ({}), folderOf: () => dir, uriFor: uriOf,
    })
    const goAt = (text) => {
      const i = text.indexOf('GO:')
      const before = text.slice(0, i)
      return { textDocument: { uri: uriOf(file) }, position: { line: before.split('\n').length - 1, character: i - before.lastIndexOf('\n') - 1 } }
    }
    const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
    return { dir, file, docs, nav, indexOf, goAt, calls, wants: () => wants, deferred }
  }
  const line = (locs) => locs?.map(l => l.range.start.line + 1)

  it('a request waiting on the check in flight is answered by its early part, before the check settles', async () => {
    const t = setup()
    const snap = t.nav.snapshot(new Map(t.docs))
    const check = t.deferred()
    t.nav.track(t.dir, snap, check.promise)
    let answer = 'pending'
    const req = Promise.resolve(t.nav.definition(t.goAt(C))).then(r => { answer = r })
    expect(t.wants()).toBe(1) // it asked the worker for the index early
    await tick()
    expect(answer).toBe('pending')
    t.nav.indexPart(t.dir, snap, t.indexOf(C))
    await req
    expect(line(answer)).toEqual([4])
    expect(t.calls).toEqual([]) // no index call
    // the check's result (no index: it came early) returns the early entry
    const entry = t.nav.accept(t.dir, snap, { files: [] })
    expect(entry.index.occurrences.length).toBeGreaterThan(0)
    check.resolve()
  })

  it('late index: the result alone does not release the request; the late part does', async () => {
    const t = setup()
    const snap = t.nav.snapshot(new Map(t.docs))
    const check = t.deferred()
    const settled = check.promise.then(res => t.nav.accept(t.dir, snap, res))
    t.nav.track(t.dir, snap, settled)
    let answer = 'pending'
    const req = Promise.resolve(t.nav.definition(t.goAt(C))).then(r => { answer = r })
    check.resolve({ files: [], late: true }) // the diagnostics, no index
    await settled
    await tick(); await tick()
    expect(answer).toBe('pending')
    // a second request meanwhile waits on the same check (still in flight until its index)
    let second = 'pending'
    const req2 = Promise.resolve(t.nav.references({ ...t.goAt(C), context: { includeDeclaration: true } })).then(r => { second = r })
    t.nav.indexPart(t.dir, snap, { ...t.indexOf(C), completion: null })
    await Promise.all([req, req2])
    expect(line(answer)).toEqual([4])
    expect(line(second)).toEqual([3, 4])
    expect(t.calls).toEqual([])
  })

  it('supersession: an older check\'s part never replaces a newer index, nor answers for documents changed since', async () => {
    const t = setup()
    const snap1 = t.nav.snapshot(new Map(t.docs))
    const c1 = t.deferred()
    t.nav.track(t.dir, snap1, c1.promise)
    // the document changes while check 1 runs; check 2 is sent with the new text
    const text2 = '// a new first line\n' + C
    t.docs.set(t.file, text2)
    const snap2 = t.nav.snapshot(new Map(t.docs))
    const c2 = t.deferred()
    t.nav.track(t.dir, snap2, c2.promise)
    let answer = 'pending'
    const req = Promise.resolve(t.nav.definition(t.goAt(text2))).then(r => { answer = r })
    // check 1's part: not for these documents, so it doesn't answer the request
    t.nav.indexPart(t.dir, snap1, t.indexOf(C))
    await tick(); await tick()
    expect(answer).toBe('pending')
    t.nav.indexPart(t.dir, snap2, t.indexOf(text2))
    await req
    expect(line(answer)).toEqual([5])
    // a late duplicate of check 1's part (a retried worker call) doesn't replace check 2's index
    t.nav.indexPart(t.dir, snap1, t.indexOf(C))
    expect(line(await t.nav.definition(t.goAt(text2)))).toEqual([5])
    expect(t.calls).toEqual([])
    c1.resolve(); c2.resolve()
  })

  it('a check that fails releases its waiting requests (an index call answers them)', async () => {
    const t = setup()
    const snap = t.nav.snapshot(new Map(t.docs))
    const check = t.deferred()
    const settled = check.promise.then(() => { throw new Error('boom') })
    t.nav.track(t.dir, snap, settled)
    settled.catch(() => {})
    const req = t.nav.definition(t.goAt(C))
    check.resolve()
    // released with no index (null); the next request goes to an index call
    expect(await req).toBeNull()
    expect(line(await t.nav.definition(t.goAt(C)))).toEqual([4])
    expect(t.calls).toEqual(['index'])
  })
})

describe('the server', () => {
  /** Messages after `from`: the response to request `id` and the publish carrying `pred`'s finding. */
  const order = (client, from, id, file, pred) => {
    const msgs = client.messages.slice(from)
    const answered = msgs.findIndex(m => m.id === id && !m.method)
    const published = msgs.findIndex(m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uriOf(file) && m.params.diagnostics.some(pred))
    return { answered, published }
  }
  const unhandled = (text) => text.replace("({ GO: DOM.click('.go') })", "({ GO: DOM.click('.go'), STRAY: DOM.click('.go') })")

  it('in-thread: a definition right after a save is answered from the early index, before that check publishes', async () => {
    const dir = dirWith({ 'src/C.jsx': C })
    const file = path.join(dir, 'src/C.jsx')
    const client = startServer({ server: { debounce: 60_000 } })
    cleanup.push(() => client.server.dispose())
    await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'p' }] })
    client.open(file, C)
    await client.settle()
    const text = '// moved down\n' + unhandled(C)
    const from = client.messages.length
    client.change(file, text, 2)
    client.save(file)
    const id = 9001
    const res = await client.send('textDocument/definition', { textDocument: { uri: uriOf(file) }, position: { line: 3, character: 28 } }, id)
    expect(res.result.map(l => l.range.start.line + 1)).toEqual([5])
    await client.waitFor(() => client.diags(file).some(d => d.code === 'SYG101'))
    const { answered, published } = order(client, from, id, file, d => d.code === 'SYG101')
    expect(answered).toBeGreaterThanOrEqual(0)
    expect(published).toBeGreaterThan(answered)
    await client.settle()
  })

  it('worker (kanban): a definition right after a save is answered from the early index, before that check publishes', async () => {
    const dir = copyFixture(path.join(repo, 'examples/kanban'))
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const file = path.join(dir, 'src/LaneComponent.jsx')
    const original = fs.readFileSync(file, 'utf8')
    const client = startServer({ server: { worker: true, debounce: 60_000 } })
    cleanup.push(() => client.server.dispose())
    await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'k' }] })
    expect(client.server.usingWorker).toBe(true)
    client.open(file, original)
    await client.settle()
    expect(original.indexOf('DELETE_LANE:')).toBeGreaterThan(0)
    for (let i = 0; i < 3; i++) {
      // moved down a line (the kept index is stale) and a new SYG101 finding to wait for
      const text = `// saved ${i}\n` + original + `\nfunction Zq${i}() { return <div /> }\nZq${i}.intent = ({ DOM }) => ({ NOPE${i}: DOM.click('.x') })\nZq${i}.model = {}\n`
      const at = text.indexOf('DELETE_LANE:')
      const pre = text.slice(0, at)
      const position = { line: pre.split('\n').length - 1, character: at - pre.lastIndexOf('\n') - 1 }
      const from = client.messages.length
      client.change(file, text, 2 + i)
      client.save(file)
      const id = 9100 + i
      const res = await client.send('textDocument/definition', { textDocument: { uri: uriOf(file) }, position }, id)
      expect(res.result?.length).toBeGreaterThan(0)
      const planted = (d) => d.code === 'SYG101' && d.message.includes(`'NOPE${i}'`)
      await client.waitFor(() => client.diags(file).some(planted))
      const { answered, published } = order(client, from, id, file, planted)
      expect(published).toBeGreaterThan(answered)
      await client.settle()
    }
  })

  it('completions and the kept index arrive with the late part; the server is idle only after it', async () => {
    const dir = dirWith({ 'src/C.jsx': C })
    const file = path.join(dir, 'src/C.jsx')
    for (const worker of [false, true]) {
      const client = startServer({ server: { worker } })
      cleanup.push(() => client.server.dispose())
      await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'p' }], initializationOptions: { trace: { server: 'verbose' } } })
      const text = C.replace("DOM.click('.go')", "DOM.click('.")
      client.open(file, text)
      await client.settle()
      // right after settle: the completion index is in (a selector completion from the view)
      const at = text.indexOf("DOM.click('.") + "DOM.click('.".length
      const pre = text.slice(0, at)
      const list = await client.request('textDocument/completion', { textDocument: { uri: uriOf(file) }, position: { line: pre.split('\n').length - 1, character: at - pre.lastIndexOf('\n') - 1 } })
      expect(list.items.map(i => i.label)).toContain('.go')
      // and the kept index answers navigation without a worker call
      const n = client.messages.length
      const goAt = text.indexOf('GO:')
      const pre2 = text.slice(0, goAt)
      await client.request('textDocument/definition', { textDocument: { uri: uriOf(file) }, position: { line: pre2.split('\n').length - 1, character: goAt - pre2.lastIndexOf('\n') - 1 } })
      const logs = client.messages.slice(n).filter(m => m.method === 'window/logMessage' && m.params.message.includes('navigation:')).map(m => m.params.message)
      expect(logs.at(-1)).toMatch(/from the last check's index/)
      client.server.dispose()
    }
  })
})
