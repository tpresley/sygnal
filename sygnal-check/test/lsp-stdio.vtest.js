// PLAN-7 L-2: `sygnal-check lsp` as a child process on stdio.
//   - one raw round trip through the binary (Content-Length frames written by hand);
//   - protocol conformance: driven by vscode-languageserver-protocol (exact-pinned dev
//     dependency, tests only) over the child's stdio, as an editor would, with the initialize
//     capabilities VS Code 1.138 and Claude Code 2.1.287 really sent (0-S2's captures).
import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import * as lsp from 'vscode-languageserver-protocol/node'
import { createReader, createWriter } from '../src/lsp/protocol.js'
import { copyFixture, pocFixture, pkgRoot, repo, uriOf, applyTextEdits, where } from './lsp-helpers.js'

const bin = path.join(pkgRoot, 'bin/sygnal-check.js')
const captures = path.join(repo, 'dev-plans/research/p7-spikes/0-S2/captures')
const capture = (name) => JSON.parse(fs.readFileSync(path.join(captures, name), 'utf8'))

const cleanup = []
afterEach(() => {
  for (const f of cleanup.splice(0)) {
    try { f() } catch { /* gone */ }
  }
})

function spawnServer(cwd) {
  const child = spawn(process.execPath, [bin, 'lsp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (c) => { stderr += c })
  const exited = new Promise(resolve => child.on('exit', (code) => resolve(code)))
  cleanup.push(() => child.kill())
  return { child, exited, stderr: () => stderr }
}

describe('stdio', () => {
  it('a raw round trip through `node bin/sygnal-check.js lsp`', async () => {
    const dir = copyFixture(pocFixture)
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const { child, exited } = spawnServer(dir)
    const write = createWriter(child.stdin)
    const got = []
    const waiters = []
    createReader(child.stdout, {
      onMessage: (m) => {
        got.push(m)
        for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m) }
      },
    })
    const next = (pred) => new Promise(resolve => {
      const hit = got.find(pred)
      if (hit) resolve(hit); else waiters.push({ pred, resolve })
    })
    const C = path.join(dir, 'src/C.jsx')
    write({ id: 1, method: 'initialize', params: { processId: process.pid, rootUri: null, capabilities: {} } }) // no folders: the cwd
    const init = await next(m => m.id === 1)
    expect(init.result.capabilities.hoverProvider).toBe(true)
    write({ method: 'initialized', params: {} })
    const pub = await next(m => m.method === 'textDocument/publishDiagnostics' && m.params.uri === uriOf(C))
    expect(pub.params.diagnostics.map(where)).toEqual(['5:34-5:43 SYG101', '5:55-5:62 SYG110', '6:19-6:27 SYG102'])
    write({ id: 2, method: 'textDocument/hover', params: { textDocument: { uri: uriOf(C) }, position: { line: 4, character: 56 } } })
    const hover = await next(m => m.id === 2)
    expect(hover.result.contents.value).toMatch(/SYG110/)
    write({ id: 3, method: 'shutdown' })
    expect((await next(m => m.id === 3)).result).toBeNull()
    write({ method: 'exit' })
    expect(await exited).toBe(0)
  }, 20_000)
})

describe('protocol conformance (vscode-languageserver-protocol)', () => {
  function connect(cwd) {
    const proc = spawnServer(cwd)
    const conn = lsp.createProtocolConnection(new lsp.StreamMessageReader(proc.child.stdout), new lsp.StreamMessageWriter(proc.child.stdin))
    const diagnostics = new Map()
    const publishWaiters = []
    conn.onNotification(lsp.PublishDiagnosticsNotification.type, (p) => {
      diagnostics.set(p.uri, p.diagnostics)
      for (const w of [...publishWaiters]) if (w.pred()) { publishWaiters.splice(publishWaiters.indexOf(w), 1); w.resolve() }
    })
    const logs = []
    conn.onNotification(lsp.LogMessageNotification.type, (p) => logs.push(p))
    const requests = []
    conn.onRequest(lsp.RegistrationRequest.type, (p) => { requests.push(['register', p]); return null })
    conn.onRequest(lsp.ConfigurationRequest.type, (p) => { requests.push(['configuration', p]); return p.items.map(() => ({ strict: null, verbose: false })) })
    conn.listen()
    cleanup.push(() => conn.dispose())
    const until = (pred) => pred() ? Promise.resolve() : new Promise(resolve => publishWaiters.push({ pred, resolve }))
    return { ...proc, conn, diagnostics, logs, requests, until }
  }

  it('VS Code 1.138 capabilities: lifecycle, registration, configuration, diagnostics, hover, code actions, cancellation', async () => {
    const dir = copyFixture(pocFixture)
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const { conn, diagnostics, requests, until, exited } = connect(dir)
    const C = path.join(dir, 'src/C.jsx')
    const uri = uriOf(C)
    const vscode = capture('vscode-1.138-initialize-capabilities.json')
    const init = await conn.sendRequest(lsp.InitializeRequest.type, {
      processId: process.pid,
      clientInfo: vscode.clientInfo,
      rootUri: uriOf(dir),
      workspaceFolders: [{ uri: uriOf(dir), name: 'fixture' }],
      capabilities: vscode.capabilities,
      initializationOptions: {},
      trace: 'off',
    })
    expect(init.capabilities.textDocumentSync).toEqual({ openClose: true, change: lsp.TextDocumentSyncKind.Full, save: { includeText: false } })
    expect(init.capabilities.codeActionProvider.codeActionKinds).toContain(lsp.CodeActionKind.SourceFixAll + '.sygnal')
    await conn.sendNotification(lsp.InitializedNotification.type, {})
    await until(() => diagnostics.get(uri)?.length === 3)
    // dynamic registration and per-folder configuration (0-S2)
    const regs = requests.filter(r => r[0] === 'register').flatMap(r => r[1].registrations.map(x => x.method))
    expect(regs.sort()).toEqual(['workspace/didChangeConfiguration', 'workspace/didChangeWatchedFiles'])
    expect(requests.find(r => r[0] === 'configuration')[1].items).toEqual([{ scopeUri: uriOf(dir), section: 'sygnal' }])
    // VS Code sends $/setTrace repeatedly: accepted silently
    await conn.sendNotification(lsp.SetTraceNotification.type, { value: 'off' })

    const text = fs.readFileSync(C, 'utf8')
    await conn.sendNotification(lsp.DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'javascriptreact', version: 1, text } })
    const sel = diagnostics.get(uri).find(d => d.code === 'SYG110')
    expect(sel.codeDescription.href).toBe('https://sygnal.js.org/reference/errors#syg110')

    const hover = await conn.sendRequest(lsp.HoverRequest.type, { textDocument: { uri }, position: { line: sel.range.start.line, character: sel.range.start.character + 1 } })
    expect(lsp.MarkupContent.is(hover.contents)).toBe(true)
    expect(hover.contents.kind).toBe(lsp.MarkupKind.Markdown)

    const automatic = await conn.sendRequest(lsp.CodeActionRequest.type, { textDocument: { uri }, range: sel.range, context: { diagnostics: [], triggerKind: lsp.CodeActionTriggerKind.Automatic } })
    expect(automatic).toEqual([])
    const actions = await conn.sendRequest(lsp.CodeActionRequest.type, { textDocument: { uri }, range: sel.range, context: { diagnostics: [sel], triggerKind: lsp.CodeActionTriggerKind.Invoked } })
    for (const a of actions) expect(lsp.CodeAction.is(a)).toBe(true)
    const fix = actions.find(a => a.isPreferred)
    expect(fix.kind).toBe(lsp.CodeActionKind.QuickFix)
    const fixed = applyTextEdits(text, fix.edit.changes[uri])
    await conn.sendNotification(lsp.DidChangeTextDocumentNotification.type, { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] })
    await conn.sendNotification(lsp.DidSaveTextDocumentNotification.type, { textDocument: { uri } })
    await until(() => !diagnostics.get(uri).some(d => d.code === 'SYG110'))
    expect(diagnostics.get(uri).map(d => d.code)).toEqual(['SYG101', 'SYG102'])

    // a cancelled request is answered with RequestCancelled (-32800)
    const source = new lsp.CancellationTokenSource()
    const pending = conn.sendRequest(lsp.CodeActionRequest.type, { textDocument: { uri }, range: sel.range, context: { diagnostics: [], only: [lsp.CodeActionKind.SourceFixAll] } }, source.token)
    source.cancel()
    await expect(pending).rejects.toMatchObject({ code: lsp.LSPErrorCodes.RequestCancelled })

    // an unknown request: MethodNotFound
    await expect(conn.sendRequest('sygnal/unknown', {})).rejects.toMatchObject({ code: lsp.ErrorCodes.MethodNotFound })

    await conn.sendRequest(lsp.ShutdownRequest.type)
    await conn.sendNotification(lsp.ExitNotification.type)
    expect(await exited).toBe(0)
  }, 30_000)

  it('Claude Code 2.1.287 capabilities: workspaceFolders false but sent, didSave with each edit, shutdown then the pipe closes', async () => {
    const dir = copyFixture(pocFixture)
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    const { conn, child, diagnostics, until, exited } = connect(dir)
    const claude = capture('claude-code-2.1.287-initialize-capabilities.json')
    expect(claude.capabilities.workspace.workspaceFolders).toBe(false)
    const C = path.join(dir, 'src/C.jsx')
    const uri = uriOf(C)
    await conn.sendRequest(lsp.InitializeRequest.type, {
      processId: process.pid,
      clientInfo: claude.clientInfo,
      rootUri: uriOf(dir),
      workspaceFolders: [{ uri: uriOf(dir), name: path.basename(dir) }],
      capabilities: claude.capabilities,
      initializationOptions: {},
    })
    await conn.sendNotification(lsp.InitializedNotification.type, {})
    await conn.sendNotification(lsp.DidChangeConfigurationNotification.type, { settings: {} })
    await until(() => diagnostics.get(uri)?.length === 3)
    // the Edit tool: the file is written, then didOpen/didChange with the full text and didSave
    const text = fs.readFileSync(C, 'utf8').replace('INCREMNT', 'INCREMENT')
    fs.writeFileSync(C, text)
    await conn.sendNotification(lsp.DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'javascriptreact', version: 1, text } })
    await conn.sendNotification(lsp.DidSaveTextDocumentNotification.type, { textDocument: { uri } })
    await until(() => diagnostics.get(uri)?.length === 1)
    expect(diagnostics.get(uri).map(d => `${d.code} ${d.severity}`)).toEqual(['SYG110 2'])
    await conn.sendRequest(lsp.ShutdownRequest.type)
    child.stdin.end() // no exit notification
    expect(await exited).toBe(0)
  }, 30_000)
})
