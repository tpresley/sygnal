#!/usr/bin/env node
// summarize.mjs <tap log.jsonl> [--caps <out.json>]: what a client did with the Sygnal server, from
// an lsp-tap.mjs log: client info and the capabilities that matter to the server, the methods each
// side sent, the answers to the server's requests (registerCapability, workspace/configuration),
// code action contexts (whether `data` came back), and how the session ended.
// --caps writes { clientInfo, capabilities } of the initialize request (the captures/ files).
import fs from 'node:fs'

const [file, flag, capsOut] = process.argv.slice(2)
const log = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l))
const msgs = log.filter(l => l.msg)
const ins = msgs.filter(l => l.dir === 'in')
const outs = msgs.filter(l => l.dir === 'out')
const init = ins.find(l => l.msg.method === 'initialize')?.msg
const c = init?.params?.capabilities || {}
if (flag === '--caps' && capsOut) {
  fs.writeFileSync(capsOut, JSON.stringify({ clientInfo: init?.params?.clientInfo, capabilities: c }, null, 2) + '\n')
}
const count = (arr) => arr.reduce((m, { msg }) => {
  const k = msg.method ?? (msg.error ? '(error response)' : '(response)')
  m[k] = (m[k] || 0) + 1
  return m
}, {})
const answer = (req) => ins.find(l => !l.msg.method && l.msg.id === req.msg.id)
const serverRequests = outs.filter(l => l.msg.method && l.msg.id !== undefined).map(r => {
  const a = answer(r)
  return { t: r.t, method: r.msg.method, params: r.msg.params, answeredAfterMs: a ? a.t - r.t : null, result: a?.msg.result, error: a?.msg.error }
})
const codeActions = ins.filter(l => l.msg.method === 'textDocument/codeAction').map(l => {
  const ctx = l.msg.params.context || {}
  const resp = outs.find(o => o.msg.id === l.msg.id && !o.msg.method)
  return {
    only: ctx.only, triggerKind: ctx.triggerKind,
    diagnostics: (ctx.diagnostics || []).map(d => `${d.code}${d.data ? ' +data' : ''}${d.codeDescription ? ' +codeDescription' : ''}${d.relatedInformation ? ' +related' : ''}`),
    answered: Array.isArray(resp?.msg.result) ? resp.msg.result.map(a => a.title) : resp?.msg.error,
  }
})
const hovers = ins.filter(l => l.msg.method === 'textDocument/hover').map(l => {
  const resp = outs.find(o => o.msg.id === l.msg.id && !o.msg.method)
  return { position: l.msg.params.position, kind: resp?.msg.result?.contents?.kind ?? null }
})
const summary = {
  clientInfo: init?.params?.clientInfo,
  rootUri: init?.params?.rootUri,
  workspaceFolders: init?.params?.workspaceFolders,
  initializationOptions: init?.params?.initializationOptions,
  trace: init?.params?.trace,
  caps: {
    'textDocument.publishDiagnostics': c.textDocument?.publishDiagnostics ?? null,
    'textDocument.diagnostic (pull)': c.textDocument?.diagnostic ?? null,
    'textDocument.hover.contentFormat': c.textDocument?.hover?.contentFormat ?? null,
    'textDocument.codeAction': c.textDocument?.codeAction ?? null,
    'textDocument.synchronization': c.textDocument?.synchronization ?? null,
    'workspace.configuration': c.workspace?.configuration ?? null,
    'workspace.didChangeConfiguration': c.workspace?.didChangeConfiguration ?? null,
    'workspace.didChangeWatchedFiles': c.workspace?.didChangeWatchedFiles ?? null,
    'workspace.workspaceFolders': c.workspace?.workspaceFolders ?? null,
    'workspace.workspaceEdit': c.workspace?.workspaceEdit ?? null,
    'general.positionEncodings': c.general?.positionEncodings ?? null,
    'window.workDoneProgress': c.window?.workDoneProgress ?? null,
  },
  clientSent: count(ins),
  serverSent: count(outs),
  serverRequests,
  watchedFileEvents: ins.filter(l => l.msg.method === 'workspace/didChangeWatchedFiles').map(l => l.msg.params.changes.map(ch => `${ch.type} ${ch.uri.split('/').slice(-2).join('/')}`)),
  workspaceFolderChanges: ins.filter(l => l.msg.method === 'workspace/didChangeWorkspaceFolders').map(l => l.msg.params.event),
  codeActions,
  hovers,
  end: log.filter(l => l.event || ['shutdown', 'exit'].includes(l.msg?.method)).slice(-4).map(l => l.event ? { t: l.t, event: l.event, code: l.code, signal: l.signal } : { t: l.t, method: l.msg.method }),
}
console.log(JSON.stringify(summary, null, 2))
