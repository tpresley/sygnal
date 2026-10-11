// G-666 and G-665: the language server's project roots (src/lsp/roots.js) and what it says about
// files it doesn't check, through createLspServer() with the in-memory client (lsp-helpers.js).
// The fallback root (a plain workspace folder) is the one every other lsp*.vtest.js file uses.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { startServer, tempDir, uriOf, applyTextEdits } from './lsp-helpers.js'
import { createRoots, isSygnalDir, ownedBy, looksLikeSygnal } from '../src/lsp/roots.js'

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* already gone */ }
  }
})

// SYG101 (GO has no model entry) and SYG102 (GOO is never triggered)
const ONE = `import { event } from 'sygnal'

function One({ state }) {
  return <button className="go">{state.n}</button>
}
One.initialState = { n: 0 }
One.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
One.model = { GOO: (s) => ({ ...s, n: s.n + 1 }) }
export default One
`
// clean by default; SYG505 (emit() in a model) only under strict
const TWO = `import { emit } from 'sygnal'

function Two({ state }) {
  return <button className="save">{state.n}</button>
}
Two.initialState = { n: 0 }
Two.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Two.model = {
  SAVE: emit('SAVED', (state) => state.n),
}
export default Two
`
// a handled action, for navigation, code lens and rename
const NAV = `function Nav({ state }) {
  return <div className="box"><button className="go">{state.n}</button></div>
}
Nav.initialState = { n: 0 }
Nav.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Nav.model = { GO: (s) => ({ ...s, n: s.n + 1 }) }
export default Nav
`
const SYGNAL_DEP = (name) => JSON.stringify({ name, private: true, dependencies: { sygnal: '^6.0.0' } })

/**
 * A workspace like a monorepo: a root package.json that doesn't depend on sygnal, apps/one (a
 * package.json depending on sygnal, src/), apps/two (only a config: strict, paths ["."]).
 */
function monorepo(extra = {}) {
  return tempDir({
    'package.json': JSON.stringify({ name: 'mono', private: true, devDependencies: { typescript: '^5' } }),
    'apps/one/package.json': SYGNAL_DEP('one'),
    'apps/one/src/One.jsx': ONE,
    'apps/two/sygnal-check.config.json': JSON.stringify({ strict: true, paths: ['.'] }),
    'apps/two/app.jsx': TWO,
    ...extra,
  })
}

async function start(dir, { init = {}, onRequest, caps = {} } = {}) {
  const client = startServer({ onRequest })
  cleanup.push(() => client.server.dispose(), () => fs.rmSync(dir, { recursive: true, force: true }))
  await client.initialize({ workspaceFolders: [{ uri: uriOf(dir), name: 'ws' }], capabilities: caps, ...init })
  const file = (rel) => path.join(dir, rel)
  const codes = (rel) => client.diags(file(rel)).map(d => d.code)
  const shown = () => client.messages.filter(m => m.method === 'window/showMessage').map(m => m.params.message)
  const logged = (re) => client.messages.filter(m => m.method === 'window/logMessage' && re.test(m.params.message)).map(m => m.params.message)
  const openFile = async (rel, text) => { client.open(file(rel), text); await client.settle() }
  return { dir, client, file, codes, shown, logged, openFile }
}

/** The 0-based position of `needle` in `text`, plus `offset` characters. */
const posIn = (text, needle, offset = 0) => {
  const i = text.indexOf(needle) + offset
  const before = text.slice(0, i)
  return { line: before.split('\n').length - 1, character: i - (before.lastIndexOf('\n') + 1) }
}

describe('roots.js', () => {
  it('the rule: a config file, a package.json depending on sygnal / sygnal-check or with the key', () => {
    const dir = tempDir({
      'a/sygnal-check.config.json': '{}',
      'b/package.json': SYGNAL_DEP('b'),
      'c/package.json': JSON.stringify({ devDependencies: { 'sygnal-check': '^0.5.0' } }),
      'd/package.json': JSON.stringify({ peerDependencies: { sygnal: '*' } }),
      'e/package.json': JSON.stringify({ 'sygnal-check': { strict: true } }),
      'f/package.json': JSON.stringify({ dependencies: { react: '^19' } }),
      'g/package.json': '{ not json',
      'h/x.js': '',
    })
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const verdicts = Object.fromEntries('abcdefgh'.split('').map(d => [d, isSygnalDir(path.join(dir, d))]))
    expect(verdicts).toEqual({ a: true, b: true, c: true, d: true, e: true, f: false, g: false, h: false })
  })

  it('rootOf: the nearest root up to the folder, else the folder; never inside node_modules or a dot directory', () => {
    const dir = monorepo({
      'apps/one/node_modules/lib/package.json': SYGNAL_DEP('lib'),
      'apps/one/node_modules/lib/x.js': '',
      'apps/.hidden/package.json': SYGNAL_DEP('hidden'),
      'apps/.hidden/x.js': '',
      'tools/x.js': '',
    })
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const roots = createRoots()
    const r = (rel) => path.relative(dir, roots.rootOf(path.join(dir, rel), dir)) || '.'
    expect(r('apps/one/src/One.jsx')).toBe('apps/one')
    expect(r('apps/two/app.jsx')).toBe('apps/two')
    expect(r('apps/one/node_modules/lib/x.js')).toBe('apps/one')
    expect(r('apps/.hidden/x.js')).toBe('.')
    expect(r('tools/x.js')).toBe('.')
    expect(roots.rootOf('/elsewhere/x.js', dir)).toBeNull()
    expect(roots.hasNested(dir)).toBe(true)
    expect(roots.hasNested(path.join(dir, 'apps/one'))).toBe(false)
    // ownedBy: a root's files less those of the roots nested in it
    const owned = ownedBy(dir)
    expect(owned(path.join(dir, 'tools/x.js'))).toBe(true)
    expect(owned(path.join(dir, 'apps/one/src/One.jsx'))).toBe(false)
  })

  it('looksLikeSygnal: an import from sygnal (or a subpath), or component statics', () => {
    expect(looksLikeSygnal(`import { run } from 'sygnal'`)).toBe(true)
    expect(looksLikeSygnal(`import { Dialog } from "sygnal/ui"`)).toBe(true)
    expect(looksLikeSygnal(`App.model = { GO: s => s }`)).toBe(true)
    expect(looksLikeSygnal(`import React from 'react'\nexport const x = 1`)).toBe(false)
    expect(looksLikeSygnal(`if (App.model == null) {}`)).toBe(false)
  })
})

describe('nested project roots (G-666)', () => {
  it('each app is its own project: its own config, paths and findings; nothing before a file of it is opened', async () => {
    const { client, codes, openFile, logged, dir } = await start(monorepo(), { init: { trace: 'messages' } })
    // the workspace folder isn't a Sygnal project and holds nested ones: nothing checked yet
    expect(client.publishes).toEqual([])
    expect(logged(/holds nested Sygnal projects/)).toHaveLength(1)
    await openFile('apps/one/src/One.jsx')
    expect(codes('apps/one/src/One.jsx')).toEqual(['SYG101', 'SYG102'])
    expect(codes('apps/two/app.jsx')).toEqual([]) // not opened: apps/two isn't checked yet
    await openFile('apps/two/app.jsx')
    // apps/two's config: strict (SYG505) and paths ["."] (no src/)
    expect(codes('apps/two/app.jsx').filter(c => c !== 'SYG105')).toEqual(['SYG505'])
    // apps/one's findings are untouched by apps/two's check, and not strict (no config)
    expect(codes('apps/one/src/One.jsx')).toEqual(['SYG101', 'SYG102'])
    expect(logged(/project root .*apps[\\/]one$/)).toHaveLength(1)
    // a change in one root re-checks that root only
    const n = client.publishes.length
    client.change(path.join(dir, 'apps/one/src/One.jsx'), ONE.replace('GOO:', 'GO:'))
    await client.settle()
    expect(codes('apps/one/src/One.jsx')).toEqual([])
    expect(client.publishes.slice(n).map(p => path.relative(dir, new URL(p.uri).pathname))).toEqual(['apps/one/src/One.jsx'])
  })

  it('a root keeps being checked after its last document closes (watched-file changes refresh it)', async () => {
    const { client, codes, openFile, file } = await start(monorepo())
    await openFile('apps/one/src/One.jsx')
    client.close(file('apps/one/src/One.jsx'))
    await client.settle()
    expect(codes('apps/one/src/One.jsx')).toEqual(['SYG101', 'SYG102'])
    fs.writeFileSync(file('apps/one/src/One.jsx'), ONE.replace('GOO:', 'GO:'))
    client.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uriOf(file('apps/one/src/One.jsx')), type: 2 }] })
    await client.settle()
    expect(codes('apps/one/src/One.jsx')).toEqual([])
  })

  it('a root whose files are inside another root: each file is checked by its nearest root only', async () => {
    // the outer app checks "." (so its paths cover the inner app's folder too)
    const dir = tempDir({
      'package.json': SYGNAL_DEP('outer'),
      'sygnal-check.config.json': JSON.stringify({ paths: ['.'] }),
      'Outer.jsx': ONE.replaceAll('One', 'Outer'),
      'inner/sygnal-check.config.json': JSON.stringify({ strict: true, paths: ['.'] }),
      'inner/Inner.jsx': TWO.replaceAll('Two', 'Inner'),
    })
    const { codes, openFile, client } = await start(dir)
    // the folder is a Sygnal project: checked at startup, without the inner app's files
    expect(codes('Outer.jsx')).toEqual(['SYG101', 'SYG102'])
    expect(client.publishes.map(p => path.basename(new URL(p.uri).pathname))).toEqual(['Outer.jsx'])
    await openFile('inner/Inner.jsx')
    expect(codes('inner/Inner.jsx').filter(c => c !== 'SYG105')).toEqual(['SYG505'])
  })

  it('workspace/configuration per root: scopeUri is the root, its settings override its config file', async () => {
    const dir = monorepo()
    const one = path.join(dir, 'apps/one')
    const two = path.join(dir, 'apps/two')
    const { client, codes, openFile } = await start(dir, {
      caps: { workspace: { configuration: true } },
      // apps/one: ignore SYG102; apps/two: strict off (its config says strict)
      onRequest: (m, p) => m === 'workspace/configuration'
        ? p.items.map(i => i.scopeUri === uriOf(one) ? { ignore: ['SYG102'] } : i.scopeUri === uriOf(two) ? { strict: false } : null)
        : null,
    })
    await openFile('apps/one/src/One.jsx')
    await openFile('apps/two/app.jsx')
    expect(codes('apps/one/src/One.jsx')).toEqual(['SYG101'])
    expect(codes('apps/two/app.jsx').filter(c => c !== 'SYG105')).toEqual([])
    const scopes = client.serverRequests.filter(m => m.method === 'workspace/configuration').flatMap(m => m.params.items.map(i => i.scopeUri))
    expect(scopes).toEqual([uriOf(one), uriOf(two)])
    // didChangeConfiguration asks again for every checked root
    client.notify('workspace/didChangeConfiguration', { settings: {} })
    await client.settle()
    const last = client.serverRequests.filter(m => m.method === 'workspace/configuration').at(-1)
    expect(last.params.items.map(i => i.scopeUri)).toEqual([uriOf(one), uriOf(two)])
  })

  it('a config added at runtime: the roots are detected again (watched files, or the next didOpen)', async () => {
    const dir = monorepo({ 'apps/three/app.jsx': TWO.replaceAll('Two', 'Three'), 'apps/three/Other.jsx': NAV })
    const { client, codes, openFile, file, shown } = await start(dir, { caps: { window: { showMessage: {} } } })
    // apps/three is no project: its root is the workspace folder, whose paths (src) match nothing
    await openFile('apps/three/app.jsx')
    expect(codes('apps/three/app.jsx')).toEqual([])
    expect(shown()).toEqual([`sygnal-check found no source files in src for ${path.basename(dir)}; set "paths" in sygnal-check.config.json.`])
    fs.writeFileSync(file('apps/three/sygnal-check.config.json'), JSON.stringify({ strict: true, paths: ['.'] }))
    client.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uriOf(file('apps/three/sygnal-check.config.json')), type: 1 }] })
    await client.settle()
    expect(codes('apps/three/app.jsx').filter(c => c !== 'SYG105')).toEqual(['SYG505'])
    // and removed again: the file goes back to the fallback root, its findings clear
    fs.rmSync(file('apps/three/sygnal-check.config.json'))
    client.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: uriOf(file('apps/three/sygnal-check.config.json')), type: 3 }] })
    await client.settle()
    expect(codes('apps/three/app.jsx')).toEqual([])
    // without watchers (Claude Code): the next didOpen detects a config written since
    fs.writeFileSync(file('apps/three/sygnal-check.config.json'), JSON.stringify({ strict: true, paths: ['.'] }))
    await openFile('apps/three/Other.jsx')
    expect(codes('apps/three/app.jsx').filter(c => c !== 'SYG105')).toEqual(['SYG505'])
  })

  it('the fallback root: a plain folder is checked at startup as before', async () => {
    const dir = tempDir({ 'package.json': '{ "name": "plain" }', 'src/One.jsx': ONE })
    const { codes, client } = await start(dir)
    expect(codes('src/One.jsx')).toEqual(['SYG101', 'SYG102'])
    expect(client.messages.filter(m => m.method === 'window/showMessage')).toEqual([])
  })

  it('a single folder sent by a client that says workspaceFolders: false (Claude Code)', async () => {
    const dir = monorepo()
    const { codes, openFile, shown, client } = await start(dir, {
      caps: { workspace: { configuration: true, workspaceFolders: false }, textDocument: { synchronization: { didSave: true } } },
    })
    await openFile('apps/one/src/One.jsx')
    expect(codes('apps/one/src/One.jsx')).toEqual(['SYG101', 'SYG102'])
    // an edit saved at once, as Claude Code does
    client.change(path.join(dir, 'apps/one/src/One.jsx'), ONE.replace('GOO:', 'GO:'))
    client.save(path.join(dir, 'apps/one/src/One.jsx'))
    await client.settle()
    expect(codes('apps/one/src/One.jsx')).toEqual([])
    expect(shown()).toEqual([])
  })

  it('a file outside every workspace folder stays unchecked', async () => {
    const outside = tempDir({ 'package.json': SYGNAL_DEP('x'), 'src/One.jsx': ONE })
    cleanup.push(() => fs.rmSync(outside, { recursive: true, force: true }))
    const { client } = await start(monorepo())
    client.open(path.join(outside, 'src/One.jsx'))
    await client.settle()
    expect(client.diags(path.join(outside, 'src/One.jsx'))).toEqual([])
  })
})

describe('requests in a nested root', () => {
  const setup = async (caps = {}) => {
    const s = await start(monorepo({ 'apps/one/src/Nav.jsx': NAV }), { caps })
    await s.openFile('apps/one/src/Nav.jsx')
    const uri = uriOf(s.file('apps/one/src/Nav.jsx'))
    return { ...s, uri }
  }

  it('definition: intent GO → model GO', async () => {
    const { client, uri } = await setup()
    const locs = await client.request('textDocument/definition', { textDocument: { uri }, position: posIn(NAV, 'GO: DOM') })
    expect(locs.map(l => [l.uri, l.range.start])).toEqual([[uri, posIn(NAV, 'GO: (s)')]])
  })

  it('completion: the view classes in a DOM selector', async () => {
    const { client, uri } = await setup()
    const text = NAV.replace("DOM.click('.go')", "DOM.click('.')")
    client.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text }] })
    const list = await client.request('textDocument/completion', { textDocument: { uri }, position: posIn(text, "DOM.click('.", 12) })
    expect(list.items.map(i => i.label)).toEqual(['.box', '.go'])
  })

  it('code lens: on the intent key', async () => {
    const { client, uri } = await setup()
    const lenses = await client.request('textDocument/codeLens', { textDocument: { uri } })
    expect(lenses.map(l => l.command.title)).toContain('handled by model.GO · STATE')
  })

  it('rename: an action in the nested root', async () => {
    const { client, uri } = await setup()
    const edit = await client.request('textDocument/rename', { textDocument: { uri }, position: posIn(NAV, 'GO: DOM'), newName: 'START' })
    const out = applyTextEdits(NAV, edit.changes[uri])
    expect(out).toContain("START: DOM.click('.go')")
    expect(out).toContain('START: (s) =>')
  })
})

describe('files that are not checked (G-665)', () => {
  const extra = {
    'apps/one/scripts/Extra.jsx': `import { run } from 'sygnal'\nexport const go = () => run(() => null)\n`,
    'apps/one/scripts/More.jsx': `import { run } from 'sygnal'\nexport const more = 1\n`,
    'apps/one/scripts/util.js': `export const plain = 1\n`,
    'apps/one/tests/One.test.jsx': `import { renderComponent } from 'sygnal'\n`,
    'apps/one/vite.config.js': `import sygnal from 'sygnal/vite'\nexport default { plugins: [sygnal()] }\n`,
    'apps/one/node_modules/lib/index.jsx': `import { run } from 'sygnal'\n`,
    'apps/one/tools/plain.js': `export const plain = 1\n`,
    'apps/four/package.json': SYGNAL_DEP('four'),
    'apps/four/app.jsx': ONE.replaceAll('One', 'Four'),
  }

  it('outside paths: one message per root + directory, not per keystroke; plus a log line', async () => {
    const { client, openFile, shown, logged, file } = await start(monorepo(extra), { caps: { window: { showMessage: {} } } })
    await openFile('apps/one/scripts/Extra.jsx')
    const message = `apps/one/scripts/Extra.jsx isn't checked: it's outside sygnal-check's paths (src) for apps/one. Add its folder to "paths" in sygnal-check.config.json.`
    expect(shown()).toEqual([message])
    expect(client.messages.find(m => m.method === 'window/showMessage').params.type).toBe(3)
    expect(logged(/isn't checked/)).toEqual([`[sygnal] ${message}`])
    client.change(file('apps/one/scripts/Extra.jsx'), `import { run } from 'sygnal'\nexport const go = 2\n`)
    client.save(file('apps/one/scripts/Extra.jsx'))
    await client.settle()
    await openFile('apps/one/scripts/More.jsx') // the same directory
    expect(shown()).toEqual([message])
  })

  it('no message for test files, config files, node_modules or files that are not Sygnal source', async () => {
    const { openFile, shown } = await start(monorepo(extra), { caps: { window: { showMessage: {} } } })
    for (const rel of ['apps/one/tests/One.test.jsx', 'apps/one/vite.config.js', 'apps/one/node_modules/lib/index.jsx', 'apps/one/tools/plain.js', 'apps/one/src/One.jsx']) await openFile(rel)
    expect(shown()).toEqual([])
  })

  it('paths that match no source file: one message per root', async () => {
    const { client, openFile, shown, file } = await start(monorepo(extra), { caps: { window: { showMessage: {} } } })
    await openFile('apps/four/app.jsx')
    expect(shown()).toEqual(['sygnal-check found no source files in src for apps/four; set "paths" in sygnal-check.config.json.'])
    client.change(file('apps/four/app.jsx'), ONE.replaceAll('One', 'Four') + '\n')
    await client.settle()
    expect(shown()).toHaveLength(1)
  })

  it('a client without window capabilities (Claude Code): logged only', async () => {
    const { openFile, shown, logged } = await start(monorepo(extra), { caps: { workspace: { configuration: true, workspaceFolders: false } } })
    await openFile('apps/one/scripts/Extra.jsx')
    await openFile('apps/four/app.jsx')
    expect(shown()).toEqual([])
    expect(logged(/isn't checked|found no source files/)).toHaveLength(2)
  })
})
