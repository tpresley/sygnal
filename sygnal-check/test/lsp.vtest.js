// PLAN-7 L-2: the language server (src/lsp/) driven in-process through createLspServer() with an
// in-memory client (lsp-helpers.js). The PoC fixture (dev-plans/research/ide-tooling-poc/fixture)
// is the three forms of the counter (A.tsx, B.tsx, C.jsx), each with the same three findings.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { coreRules } from '../src/rules/index.js'
import { startServer, copyFixture, tempDir, pocFixture, uriOf, applyTextEdits, where, tick } from './lsp-helpers.js'

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* already gone */ }
  }
})

/** A server on a fresh copy of the PoC fixture, initialized and settled. */
async function poc({ init = {}, server, onRequest } = {}) {
  const dir = copyFixture(pocFixture)
  const client = startServer({ server, onRequest })
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  const result = await client.initialize({ rootUri: uriOf(dir), ...init })
  const file = (name) => path.join(dir, 'src', name)
  return { dir, client, result, file, C: file('C.jsx'), A: file('A.tsx'), B: file('B.tsx') }
}

async function project(files, { init = {}, server, onRequest } = {}) {
  const dir = tempDir({ 'package.json': '{ "name": "p", "private": true }', ...files })
  const client = startServer({ server, onRequest })
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'p' }], ...init })
  return { dir, client, file: (rel) => path.join(dir, rel) }
}

const EMIT = `import { emit } from 'sygnal'

function Saver({ state }) {
  return <button className="save">{state.n}</button>
}
Saver.initialState = { n: 0 }
Saver.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Saver.model = {
  SAVE: emit('SAVED', (state) => state.n),
}
export default Saver
`

// intent first, so the warning (SYG110, line 1) comes before the a11y finding (SYG703, line 5)
const PIC = `Pic.intent = ({ DOM }) => ({ GO: DOM.click('.og') })
Pic.model = { GO: (s) => s }
function Pic() {
  return (
    <div>
      <img src="a.png" />
      <button className="go">go</button>
    </div>
  )
}
export default Pic
`

describe('lifecycle', () => {
  it('initialize advertises push-only capabilities, and shutdown + exit end with 0', async () => {
    const { client, result } = await poc()
    expect(result.serverInfo.name).toBe('sygnal-check')
    expect(result.capabilities).toEqual({
      textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
      hoverProvider: true,
      codeActionProvider: { codeActionKinds: ['quickfix', 'refactor', 'refactor.rewrite', 'source.fixAll.sygnal'], resolveProvider: false },
      definitionProvider: true,
      referencesProvider: true,
      codeLensProvider: { resolveProvider: false },
      executeCommandProvider: { commands: ['sygnal.goTo'] },
      workspace: { workspaceFolders: { supported: true, changeNotifications: true } },
    })
    expect(result.capabilities.diagnosticProvider).toBeUndefined() // D305
    expect(await client.request('shutdown')).toBeNull()
    const after = await client.send('textDocument/hover', { textDocument: { uri: 'file:///x.jsx' }, position: { line: 0, character: 0 } })
    expect(after.error.code).toBe(-32600)
    client.notify('exit')
    expect(await client.server.done).toBe(0)
  })

  it('answers requests before initialize with -32002 and unknown requests with -32601', async () => {
    const client = startServer()
    cleanup.push(() => client.server.dispose())
    expect((await client.send('textDocument/hover', {})).error.code).toBe(-32002)
    await client.initialize({ rootUri: uriOf(pocFixture) })
    expect((await client.send('textDocument/diagnostic', {})).error.code).toBe(-32601)
    expect((await client.send('$/unknownRequest', {})).error.code).toBe(-32601)
  })

  it('exits when stdin ends, without exit (0 after shutdown, 1 without)', async () => {
    const a = await poc()
    const b = await poc()
    await a.client.request('shutdown') // Claude Code: shutdown, then the pipe closes (no exit)
    a.client.endInput()
    b.client.endInput()
    expect(await a.client.server.done).toBe(0)
    expect(await b.client.server.done).toBe(1)
  })

  it('ignores unknown $/ notifications and accepts $/setTrace', async () => {
    const { client, C } = await poc()
    const before = client.messages.length
    client.notify('$/setTrace', { value: 'off' })
    client.notify('$/someClientThing', { x: 1 })
    client.notify('custom/notification', {})
    const r = await client.request('textDocument/hover', { textDocument: { uri: uriOf(C) }, position: { line: 0, character: 0 } })
    expect(r).toBeNull()
    expect(client.messages.slice(before).filter(m => 'error' in m)).toEqual([])
  })

  it('answers a cancelled request with -32800', async () => {
    const { client, C } = await poc()
    client.open(C)
    await client.settle()
    const id = 777
    const p = client.send('textDocument/codeAction', {
      textDocument: { uri: uriOf(C) },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      context: { diagnostics: [], only: ['source.fixAll'] },
    }, id)
    client.notify('$/cancelRequest', { id })
    const r = await p
    expect(r.error.code).toBe(-32800)
    // cancelling an answered request is ignored
    client.notify('$/cancelRequest', { id })
    expect(await client.request('textDocument/hover', { textDocument: { uri: uriOf(C) }, position: { line: 0, character: 0 } })).toBeNull()
  })

  it('answers requests in arrival order, a slow fix-all before a fast hover', async () => {
    const { client, C } = await poc()
    client.open(C)
    await client.settle()
    const ids = []
    const orig = client.messages.length
    const a = client.send('textDocument/codeAction', { textDocument: { uri: uriOf(C) }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, context: { diagnostics: [], only: ['source.fixAll.sygnal'] } }, 'a')
    const b = client.send('textDocument/hover', { textDocument: { uri: uriOf(C) }, position: { line: 4, character: 56 } }, 'b')
    await Promise.all([a, b])
    for (const m of client.messages.slice(orig)) if ('id' in m && !m.method) ids.push(m.id)
    expect(ids).toEqual(['a', 'b'])
  })
})

describe('diagnostics', () => {
  it('publishes the PoC findings with exact ranges, CLI messages, codes, links and fixes', async () => {
    const { client, C, A, B } = await poc()
    // on startup, from disk: the three forms each have the same three findings
    for (const f of [A, B, C]) expect(client.diags(f)).toHaveLength(3)
    expect(client.diags(C).map(where)).toEqual(['5:34-5:43 SYG101', '5:55-5:62 SYG110', '6:19-6:27 SYG102'])
    const sel = client.diags(C).find(d => d.code === 'SYG110')
    expect(sel).toMatchObject({
      severity: 2,
      source: 'sygnal',
      codeDescription: { href: 'https://sygnal.js.org/reference/errors#syg110' },
      message: "Counter: selector '.incc' targets .incc, but Counter's view never renders that class, so this action never fires (did you mean '.inc'? The view renders className=\"inc\")",
    })
    expect(sel.data.fixes).toEqual([{
      title: "Change '.incc' to '.inc'",
      kind: 'quickfix',
      preferred: true,
      edits: [{ uri: uriOf(C), range: { start: { line: 4, character: 54 }, end: { line: 4, character: 61 } }, newText: "'.inc'" }],
    }])
    expect(sel.data.suppress).toEqual({ line: 4, newText: '// sygnal-ignore-next-line SYG110\n' })
  })

  it('an unsaved fix clears the findings (didChange overlay), and closing re-checks from disk', async () => {
    const { client, C } = await poc()
    const text = fs.readFileSync(C, 'utf8')
    client.open(C, text)
    await client.settle()
    client.change(C, text.replace("'.incc'", "'.inc'").replace('INCREMNT', 'INCREMENT'))
    await client.settle()
    expect(client.diags(C)).toEqual([])
    expect(client.publishes.at(-1)).toEqual({ uri: uriOf(C), diagnostics: [] })
    client.close(C)
    await client.settle()
    expect(client.diags(C)).toHaveLength(3)
  })

  it('checks at once on didSave, but debounces didChange without a save (D306)', async () => {
    const { client, C } = await poc({ server: { debounce: 60_000 } })
    const text = fs.readFileSync(C, 'utf8')
    client.open(C, text)
    await client.settle()
    const fixed = text.replace("'.incc'", "'.inc'")
    client.change(C, fixed)
    for (let i = 0; i < 5; i++) await tick()
    await new Promise(r => setTimeout(r, 50))
    expect(client.diags(C).map(d => d.code)).toContain('SYG110') // still waiting for the debounce
    client.save(C)
    await client.waitFor(() => !client.diags(C).some(d => d.code === 'SYG110'))
    expect(client.diags(C).map(d => d.code)).toEqual(['SYG101', 'SYG102'])
  })

  it('publishes only the files whose findings changed', async () => {
    const { client, C, A } = await poc()
    const n = client.publishes.length
    expect(n).toBe(3)
    client.open(C) // same text as on disk: nothing changes
    await client.settle()
    client.save(C)
    await client.settle()
    expect(client.publishes.length).toBe(n)
    const text = fs.readFileSync(A, 'utf8')
    client.open(A, text)
    client.change(A, text.replace("'.incc'", "'.inc'"))
    await client.settle()
    expect(client.publishes.slice(n).map(p => path.basename(p.uri))).toEqual(['A.tsx'])
  })

  it('coalesces rapid saves: a newer change supersedes the pending check', async () => {
    const { client, C } = await poc({ init: { trace: 'messages' } })
    const text = fs.readFileSync(C, 'utf8')
    client.open(C, text)
    await client.settle()
    const checks = () => client.messages.filter(m => m.method === 'window/logMessage' && /^\[sygnal\] checked /.test(m.params.message)).length
    const before = checks()
    for (let i = 0; i < 20; i++) {
      client.change(C, text + `\n// ${i}\n`)
      client.save(C)
    }
    client.change(C, text.replace("'.incc'", "'.inc'"), 99)
    client.save(C)
    await client.settle()
    expect(checks() - before).toBeLessThanOrEqual(3)
    expect(client.diags(C).map(d => d.code)).toEqual(['SYG101', 'SYG102'])
  })

  it('sorts each file errors first', async () => {
    const { client, file } = await project({ 'src/Pic.jsx': PIC }, { init: { initializationOptions: { a11y: 'error' } } })
    expect(client.diags(file('src/Pic.jsx')).map(d => `${d.code} ${d.severity}`)).toEqual(['SYG703 1', 'SYG110 2'])
  })

  it('hides info findings unless verbose', async () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/good/dynamic-and-suppressed.jsx'), 'utf8')
    const quiet = await project({ 'src/D.jsx': src })
    expect(quiet.client.diags(quiet.file('src/D.jsx'))).toEqual([])
    const loud = await project({ 'src/D.jsx': src }, { init: { initializationOptions: { sygnal: { verbose: true } } } })
    const list = loud.client.diags(loud.file('src/D.jsx'))
    expect(list.map(d => `${d.code} ${d.severity}`)).toEqual(['SYG110 3', 'SYG110 3', 'SYG110 3'])
  })

  it('keeps the last good findings of a file that does not parse, unchanged, and the others untouched', async () => {
    const { client, C } = await poc()
    const text = fs.readFileSync(C, 'utf8')
    client.open(C, text)
    await client.settle()
    const good = client.diags(C)
    const n = client.publishes.length
    client.change(C, text.slice(0, text.indexOf("DOM.click('") + 13)) // mid-edit: doesn't parse
    await client.settle()
    const broken = client.diags(C)
    expect(broken.filter(d => d.code !== 'SYG900')).toEqual(good)
    expect(broken.filter(d => d.code === 'SYG900').map(d => d.message)).toEqual([expect.stringMatching(/^could not parse file/)])
    expect(client.publishes.slice(n).map(p => path.basename(p.uri))).toEqual(['C.jsx']) // A and B not re-published
    // a different broken text: the same last good findings
    client.change(C, text.slice(0, 40), 3)
    await client.settle()
    expect(client.diags(C).filter(d => d.code !== 'SYG900')).toEqual(good)
    // whole again
    client.change(C, text, 4)
    await client.settle()
    expect(client.diags(C)).toEqual(good)
  })

  it("publishes a config file's findings on the config file", async () => {
    const { client, file } = await project({ 'sygnal-check.config.json': '{ "strictt": true }\n', 'src/Saver.jsx': EMIT })
    const list = client.diags(file('sygnal-check.config.json'))
    expect(list.map(where)).toEqual(['1:3-1:12 SYG900'])
    expect(list[0].message).toMatch(/unknown key 'strictt'.*did you mean 'strict'/)
  })

  it('produces nothing for a folder without Sygnal components', async () => {
    const { client } = await project({ 'src/util.js': 'export const add = (a, b) => a + b\n', 'src/broken.js': 'export const x = (' })
    expect(client.publishes).toEqual([])
  })

  it("logs a crashed rule's SYG900 (no file) instead of publishing it", async () => {
    const boom = { id: 'test-boom', run() { throw new Error('boom') } }
    coreRules.push(boom) // in-thread checks share this module instance
    cleanup.push(() => coreRules.splice(coreRules.indexOf(boom), 1))
    const { client, C } = await poc()
    expect(client.diags(C)).toHaveLength(3)
    expect([...client.diagnostics.values()].flat().filter(d => d.code === 'SYG900')).toEqual([])
    const logged = client.messages.filter(m => m.method === 'window/logMessage' && m.params.type === 1)
    expect(logged.map(m => m.params.message)).toEqual([expect.stringMatching(/^\[sygnal\] SYG900 sygnal-check rule 'test-boom' threw: boom/)])
  })

  it('checks in a worker thread by default, with the same results', async () => {
    const { client, C } = await poc({ server: { worker: true } })
    expect(client.server.usingWorker).toBe(true)
    expect(client.diags(C).map(where)).toEqual(['5:34-5:43 SYG101', '5:55-5:62 SYG110', '6:19-6:27 SYG102'])
  })
})

describe('hover', () => {
  it("shows the explain entry on a finding's range", async () => {
    const { client, C } = await poc({ init: { capabilities: { textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] } } } } })
    const sel = client.diags(C).find(d => d.code === 'SYG110')
    const h = await client.request('textDocument/hover', { textDocument: { uri: uriOf(C) }, position: { line: sel.range.start.line, character: sel.range.start.character + 2 } })
    expect(h.contents.kind).toBe('markdown')
    expect(h.contents.value).toMatch(/^\*\*SYG110: .+\*\*\n\n/)
    expect(h.contents.value).toContain('**Fix:**')
    // G-661: the URL is the link text (Helix and Neovim conceal link targets)
    expect(h.contents.value).toContain('Docs: [https://sygnal.js.org/reference/errors#syg110](https://sygnal.js.org/reference/errors#syg110)')
    expect(h.range).toEqual(sel.range)
    expect(await client.request('textDocument/hover', { textDocument: { uri: uriOf(C) }, position: { line: 0, character: 0 } })).toBeNull()
  })

  it('answers in plaintext when the client has no markdown', async () => {
    const { client, C } = await poc({ init: { capabilities: { textDocument: { hover: { contentFormat: ['plaintext'] } } } } })
    const h = await client.request('textDocument/hover', { textDocument: { uri: uriOf(C) }, position: { line: 4, character: 56 } })
    expect(h.contents.kind).toBe('plaintext')
    expect(h.contents.value).toMatch(/^SYG110: /)
  })
})

describe('G-663: capability-gated diagnostic fields', () => {
  it('omits relatedInformation and codeDescription for a client that does not advertise them', async () => {
    const { client, C } = await poc({ init: { capabilities: { textDocument: { publishDiagnostics: {} } } } })
    const ds = client.diags(C)
    expect(ds.map(d => d.code).sort()).toEqual(['SYG101', 'SYG102', 'SYG110'])
    for (const d of ds) {
      expect(d.codeDescription).toBeUndefined()
      expect(d.relatedInformation).toBeUndefined()
      expect(d.message).toMatch(/^Counter: /) // the message still stands alone (D307)
    }
  })

  it('keeps them for a client that advertises them', async () => {
    const { client, C } = await poc()
    for (const d of client.diags(C)) expect(d.codeDescription?.href).toMatch(/^https:\/\/sygnal\.js\.org\/reference\/errors#syg/)
  })
})

describe('code actions', () => {
  const ctx = (C, diagnostics, extra = {}) => ({
    textDocument: { uri: uriOf(C) },
    range: diagnostics[0]?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics, ...extra },
  })

  it('a quick fix from the finding; applying its edit clears the finding', async () => {
    const { client, C } = await poc()
    const text = fs.readFileSync(C, 'utf8')
    client.open(C, text)
    await client.settle()
    const sel = client.diags(C).find(d => d.code === 'SYG110')
    const actions = await client.request('textDocument/codeAction', ctx(C, [sel], { triggerKind: 1 }))
    expect(actions.map(a => `${a.kind} ${a.title}${a.isPreferred ? ' *' : ''}`)).toEqual([
      "quickfix Change '.incc' to '.inc' *",
      'quickfix Suppress SYG110 on this line',
    ])
    const fix = actions[0]
    expect(fix.diagnostics).toEqual([sel])
    client.change(C, applyTextEdits(text, fix.edit.changes[uriOf(C)]))
    await client.settle()
    expect(client.diags(C).map(d => d.code)).toEqual(['SYG101', 'SYG102'])
  })

  it('refactor fixes (SYG102 removal) only where refactors are allowed; context.only is honoured', async () => {
    const { client, C } = await poc()
    client.open(C)
    await client.settle()
    const unused = client.diags(C).find(d => d.code === 'SYG102')
    const all = await client.request('textDocument/codeAction', ctx(C, [unused]))
    expect(all.map(a => a.kind)).toEqual(['refactor.rewrite', 'quickfix'])
    const quick = await client.request('textDocument/codeAction', ctx(C, [unused], { only: ['quickfix'] }))
    expect(quick.map(a => a.title)).toEqual(['Suppress SYG102 on this line'])
    const refactor = await client.request('textDocument/codeAction', ctx(C, [unused], { only: ['refactor'] }))
    expect(refactor.map(a => a.title)).toEqual(["Remove the unreachable entry 'INCREMNT'"])
  })

  it('a cross-file pair carries relatedInformation into the other file', async () => {
    const parent = `import Child from './Child'
function Parent() {
  return <div><Child /></div>
}
Parent.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('SAVD') })
Parent.model = { GOT: (s) => s }
export default Parent
`
    const child = `import { event } from 'sygnal'
function Child() { return <button className="b">b</button> }
Child.intent = ({ DOM }) => ({ GO: DOM.click('.b') })
Child.model = { GO: { EVENTS: event('SAVED', () => 1) } }
export default Child
`
    const { client, file } = await project({ 'src/Parent.jsx': parent, 'src/Child.jsx': child })
    const [p] = client.diags(file('src/Parent.jsx'))
    expect(p.code).toBe('SYG105')
    expect(p.relatedInformation).toEqual([{
      location: { uri: uriOf(file('src/Child.jsx')), range: { start: { line: 3, character: 36 }, end: { line: 3, character: 43 } } },
      message: "'SAVED' is emitted here",
    }])
    const actions = await client.request('textDocument/codeAction', ctx(file('src/Parent.jsx'), [p], { only: ['quickfix'] }))
    expect(actions[0]).toMatchObject({ title: "Change 'SAVD' to 'SAVED'", isPreferred: false })
    expect(Object.keys(actions[0].edit.changes)).toEqual([uriOf(file('src/Parent.jsx'))])
  })

  it('source.fixAll.sygnal applies what --fix does, as one WorkspaceEdit, regardless of strict', async () => {
    const { client, file } = await project({ 'src/Saver.jsx': EMIT })
    const f = file('src/Saver.jsx')
    expect(client.diags(f).map(d => d.code)).toEqual(['SYG105']) // not strict: no SYG505
    client.open(f, EMIT)
    await client.settle()
    const actions = await client.request('textDocument/codeAction', ctx(f, [], { only: ['source.fixAll'], triggerKind: 2 }))
    expect(actions.map(a => `${a.kind} ${a.title}`)).toEqual(['source.fixAll.sygnal Fix all auto-fixable Sygnal problems'])
    const edits = actions[0].edit.changes[uriOf(f)]
    expect(edits).toHaveLength(1)
    const fixed = applyTextEdits(EMIT, edits)
    expect(fixed).toContain("SAVE: { EVENTS: event('SAVED', (state) => state.n) }")
    expect(fixed).toContain("import { event } from 'sygnal'")
    expect(fs.readFileSync(f, 'utf8')).toBe(EMIT) // nothing written
    // nothing left to fix: no action
    client.change(f, fixed)
    await client.settle()
    expect(await client.request('textDocument/codeAction', ctx(f, [], { only: ['source.fixAll.sygnal'] }))).toEqual([])
  })

  it('G-662: an invoked request without `only` also offers fix-all when the file has an auto-fixable finding; automatic ones never do', async () => {
    const { client, file } = await project({ 'sygnal-check.config.json': '{ "strict": true }\n', 'src/Saver.jsx': EMIT })
    const f = file('src/Saver.jsx')
    client.open(f, EMIT)
    await client.settle()
    const d = client.diags(f).find(x => x.code === 'SYG505')
    expect(d).toBeTruthy()
    const kinds = (acts) => acts.map(a => a.kind)
    const invoked = await client.request('textDocument/codeAction', ctx(f, [d], { triggerKind: 1 }))
    expect(kinds(invoked)).toContain('source.fixAll.sygnal')
    const noKind = await client.request('textDocument/codeAction', ctx(f, [d]))
    expect(kinds(noKind)).toContain('source.fixAll.sygnal')
    const automatic = await client.request('textDocument/codeAction', ctx(f, [d], { triggerKind: 2 }))
    expect(kinds(automatic)).not.toContain('source.fixAll.sygnal')
    expect(automatic.length).toBeGreaterThan(0) // its quick fixes are still offered
    // no sygnal finding in the context: nothing, even when invoked
    expect(await client.request('textDocument/codeAction', ctx(f, [], { triggerKind: 1 }))).toEqual([])
  })

  it('suppress inserts the comment above the line, in the JSX form inside JSX children', async () => {
    const { client, file } = await project({ 'src/Pic.jsx': PIC })
    const f = file('src/Pic.jsx')
    client.open(f, PIC)
    await client.settle()
    const [img, sel] = ['SYG703', 'SYG110'].map(c => client.diags(f).find(d => d.code === c))
    const sup = async (d) => (await client.request('textDocument/codeAction', ctx(f, [d], { only: ['quickfix'] }))).find(a => /^Suppress/.test(a.title))
    const a1 = await sup(img)
    expect(a1.edit.changes[uriOf(f)]).toEqual([{ range: { start: { line: 5, character: 0 }, end: { line: 5, character: 0 } }, newText: '      {/* sygnal-ignore-next-line SYG703 */}\n' }])
    let text = applyTextEdits(PIC, a1.edit.changes[uriOf(f)])
    client.change(f, text)
    await client.settle()
    expect(client.diags(f).map(d => d.code)).toEqual(['SYG110'])
    const a2 = await sup(client.diags(f)[0])
    expect(a2.edit.changes[uriOf(f)][0].newText).toBe('// sygnal-ignore-next-line SYG110\n')
    text = applyTextEdits(text, a2.edit.changes[uriOf(f)])
    client.change(f, text, 3)
    await client.settle()
    expect(client.diags(f)).toEqual([])
    expect(sel).toBeDefined()
  })

  it('answers automatic requests (triggerKind 2) with nothing to do fast with []', async () => {
    const { client, C } = await poc()
    client.open(C)
    await client.settle()
    const foreign = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, message: 'x', source: 'ts', code: 2304 }
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) {
      expect(await client.request('textDocument/codeAction', ctx(C, [], { triggerKind: 2 }))).toEqual([])
      expect(await client.request('textDocument/codeAction', ctx(C, [foreign], { triggerKind: 2 }))).toEqual([])
    }
    expect((performance.now() - t0) / 100).toBeLessThan(10)
  })

  it('drops fixes computed for an older text of the document', async () => {
    const { client, C } = await poc({ server: { debounce: 60_000 } })
    const text = fs.readFileSync(C, 'utf8')
    client.open(C, text)
    await client.settle()
    const sel = client.diags(C).find(d => d.code === 'SYG110')
    client.change(C, '\n' + text) // not re-checked yet (long debounce)
    const actions = await client.request('textDocument/codeAction', ctx(C, [sel]))
    expect(actions).toEqual([])
  })

  it('offers the --controls conversions as refactors when asked for refactors', async () => {
    const src = `function App({ state }) {
  return <div><button className="add">+</button><span>{state.n}</span></div>
}
App.initialState = { n: 0 }
App.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
App.model = { ADD: (s) => ({ ...s, n: s.n + 1 }) }
export default App
`
    const { client, file } = await project({ 'src/App.jsx': src })
    const f = file('src/App.jsx')
    client.open(f, src)
    await client.settle()
    const range = { start: { line: 4, character: 40 }, end: { line: 4, character: 40 } }
    expect(await client.request('textDocument/codeAction', { textDocument: { uri: uriOf(f) }, range, context: { diagnostics: [], triggerKind: 2 } })).toEqual([])
    const actions = await client.request('textDocument/codeAction', { textDocument: { uri: uriOf(f) }, range, context: { diagnostics: [], only: ['refactor'] } })
    expect(actions.map(a => `${a.kind} ${a.title}`)).toEqual(["refactor.rewrite Convert '.add' to the control Add"])
    const out = applyTextEdits(src, actions[0].edit.changes[uriOf(f)])
    expect(out).toContain("DOM.click(Add)")
    expect(out).toContain("controls({ Add: 'button' })")
  })
})

describe('settings', () => {
  const STRICT_CONFIG = { 'sygnal-check.config.json': '{ "strict": true }\n', 'src/Saver.jsx': EMIT }
  // EMIT's 'SAVED' event has no listener (SYG105): only the strict finding matters here
  const codes = (c, f) => c.diags(f).map(d => d.code).filter(x => x !== 'SYG105')

  it('the config file decides when the editor leaves a setting unset or null', async () => {
    const a = await project(STRICT_CONFIG)
    expect(codes(a.client, a.file('src/Saver.jsx'))).toEqual(['SYG505'])
    const b = await project(STRICT_CONFIG, { init: { initializationOptions: { strict: null }, capabilities: { workspace: { configuration: true } } }, onRequest: (m, p) => m === 'workspace/configuration' ? p.items.map(() => ({ strict: null })) : null })
    expect(codes(b.client, b.file('src/Saver.jsx'))).toEqual(['SYG505'])
  })

  it('editor settings override the config file; workspace/configuration overrides initializationOptions', async () => {
    const a = await project(STRICT_CONFIG, { init: { initializationOptions: { strict: false } } })
    expect(codes(a.client, a.file('src/Saver.jsx'))).toEqual([])
    const b = await project(STRICT_CONFIG, {
      init: { initializationOptions: { strict: false }, capabilities: { workspace: { configuration: true } } },
      onRequest: (m, p) => m === 'workspace/configuration' ? p.items.map(() => ({ strict: true })) : null,
    })
    expect(codes(b.client, b.file('src/Saver.jsx'))).toEqual(['SYG505'])
    const c = await project({ 'src/Saver.jsx': EMIT, 'src/Pic.jsx': PIC }, { init: { initializationOptions: { sygnal: { ignore: ['SYG110'], a11y: 'error', paths: ['src/Pic.jsx'] } } } })
    expect(codes(c.client, c.file('src/Pic.jsx'))).toEqual(['SYG703'])
    expect(c.client.diags(c.file('src/Pic.jsx'))[0].severity).toBe(1)
  })

  it('re-requests workspace/configuration after didChangeConfiguration and ignores its payload', async () => {
    let strict = false
    const { client, file } = await project(STRICT_CONFIG, {
      init: { capabilities: { workspace: { configuration: true, didChangeConfiguration: { dynamicRegistration: true } } } },
      onRequest: (m, p) => m === 'workspace/configuration' ? p.items.map(() => ({ strict })) : null,
    })
    const reg = client.serverRequests.find(r => r.method === 'client/registerCapability')
    expect(reg.params.registrations).toEqual([{ id: 'sygnal-configuration', method: 'workspace/didChangeConfiguration', registerOptions: { section: 'sygnal' } }])
    const f = file('src/Saver.jsx')
    expect(codes(client, f)).toEqual([])
    const asked = client.serverRequests.filter(r => r.method === 'workspace/configuration').length
    strict = true
    client.notify('workspace/didChangeConfiguration', { settings: { sygnal: { strict: false } } })
    await client.waitFor(() => codes(client, f).length === 1)
    await client.settle()
    expect(client.serverRequests.filter(r => r.method === 'workspace/configuration').length).toBe(asked + 1)
    expect(client.serverRequests.at(-1).params.items).toEqual([{ scopeUri: uriOf(path.dirname(path.dirname(f))), section: 'sygnal' }])
    expect(codes(client, f)).toEqual(['SYG505'])
  })

  it('logs invalid settings and ignores them', async () => {
    const { client, file } = await project(STRICT_CONFIG, { init: { initializationOptions: { strict: 'yes' } } })
    expect(codes(client, file('src/Saver.jsx'))).toEqual(['SYG505'])
    expect(client.messages.some(m => m.method === 'window/logMessage' && /sygnal\.strict must be a boolean/.test(m.params.message))).toBe(true)
  })
})

describe('workspace', () => {
  it('registers file watchers; created and changed files re-check, a deleted file clears', async () => {
    const { client, dir, A, B } = await poc({ init: { capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } } } })
    const reg = client.serverRequests.find(r => r.method === 'client/registerCapability')
    expect(reg.params.registrations[0]).toEqual({
      id: 'sygnal-watched-files',
      method: 'workspace/didChangeWatchedFiles',
      registerOptions: { watchers: [{ globPattern: '**/*.{js,jsx,ts,tsx,mjs,cjs}' }, { globPattern: '**/sygnal-check.config.json' }, { globPattern: '**/package.json' }] },
    })
    const D = path.join(dir, 'src', 'D.jsx')
    fs.writeFileSync(D, fs.readFileSync(path.join(dir, 'src', 'C.jsx'), 'utf8'))
    client.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uriOf(D), type: 1 }] })
    await client.settle()
    expect(client.diags(D)).toHaveLength(3)
    fs.writeFileSync(A, fs.readFileSync(A, 'utf8').replace("'.incc'", "'.inc'").replace('INCREMNT', 'INCREMENT'))
    client.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uriOf(A), type: 2 }] })
    await client.settle()
    expect(client.diags(A)).toEqual([])
    client.open(B)
    await client.settle()
    fs.rmSync(B)
    client.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uriOf(B), type: 3 }] })
    await client.settle()
    expect(client.diags(B)).toEqual([])
    expect(client.publishes.at(-1)).toEqual({ uri: uriOf(B), diagnostics: [] })
    // a config file change re-checks with the new config
    fs.writeFileSync(path.join(dir, 'sygnal-check.config.json'), '{ "ignore": ["SYG110"] }')
    client.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uriOf(path.join(dir, 'sygnal-check.config.json')), type: 1 }] })
    await client.settle()
    expect(client.diags(D).map(d => d.code)).toEqual(['SYG101', 'SYG102'])
  })

  it('without watchers, didSave re-reads the disk', async () => {
    const { client, A, C } = await poc()
    fs.writeFileSync(A, fs.readFileSync(A, 'utf8').replace("'.incc'", "'.inc'"))
    client.open(C)
    client.save(C)
    await client.settle()
    expect(client.diags(A).map(d => d.code)).toEqual(['SYG101', 'SYG102'])
  })

  it('multi-root: one project per folder, with per-folder settings', async () => {
    const a = copyFixture(pocFixture)
    const b = tempDir({ 'package.json': '{}', 'src/Saver.jsx': EMIT })
    cleanup.push(() => fs.rmSync(a, { recursive: true, force: true }), () => fs.rmSync(b, { recursive: true, force: true }))
    const client = startServer({ onRequest: (m, p) => m === 'workspace/configuration' ? p.items.map(i => i.scopeUri === uriOf(b) ? { strict: true } : {}) : null })
    cleanup.push(() => client.server.dispose())
    // workspaceFolders is read even when the client says workspaceFolders: false (Claude Code)
    await client.initialize({
      workspaceFolders: [{ uri: uriOf(a), name: 'a' }, { uri: uriOf(b), name: 'b' }],
      rootUri: uriOf(a),
      capabilities: { workspace: { workspaceFolders: false, configuration: true } },
    })
    expect(client.diags(path.join(a, 'src/C.jsx'))).toHaveLength(3)
    expect(client.diags(path.join(b, 'src/Saver.jsx')).map(d => d.code).filter(x => x !== 'SYG105')).toEqual(['SYG505'])
    // removing a folder clears its files; adding one checks it
    client.notify('workspace/didChangeWorkspaceFolders', { event: { added: [], removed: [{ uri: uriOf(b), name: 'b' }] } })
    await client.settle()
    expect(client.diags(path.join(b, 'src/Saver.jsx'))).toEqual([])
    client.notify('workspace/didChangeWorkspaceFolders', { event: { added: [{ uri: uriOf(b), name: 'b' }], removed: [] } })
    await client.settle()
    expect(client.diags(path.join(b, 'src/Saver.jsx')).map(d => d.code).filter(x => x !== 'SYG105')).toEqual(['SYG505'])
  })

  it('falls back to rootPath, then the cwd', async () => {
    const dir = copyFixture(pocFixture)
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const a = startServer()
    cleanup.push(() => a.server.dispose())
    await a.initialize({ rootPath: dir })
    expect(a.diags(path.join(dir, 'src/C.jsx'))).toHaveLength(3)
    const b = startServer({ server: { cwd: dir } })
    cleanup.push(() => b.server.dispose())
    await b.initialize({})
    expect(b.diags(path.join(dir, 'src/C.jsx'))).toHaveLength(3)
  })
})
