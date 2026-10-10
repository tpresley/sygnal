// node analyze.mjs <log.jsonl> [--caps out.json]: summarises what a client sent to the 0-S2 server.
import fs from 'node:fs'

const [file, flag, capsOut] = process.argv.slice(2)
const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l))
const ins = lines.filter(l => l.dir === 'in').map(l => ({ t: l.t, ...l.msg }))
const outs = lines.filter(l => l.dir === 'out').map(l => ({ t: l.t, ...l.msg }))
const count = (arr) => arr.reduce((m, x) => { const k = x.method ?? `(response ${x.id})`; m[k] = (m[k] || 0) + 1; return m }, {})
const init = ins.find(m => m.method === 'initialize')
const c = init?.params.capabilities || {}
if (flag === '--caps' && capsOut) fs.writeFileSync(capsOut, JSON.stringify({ clientInfo: init?.params.clientInfo, capabilities: c }, null, 2))

const first = (pred) => ins.find(pred)
const ca = ins.filter(m => m.method === 'textDocument/codeAction')
const caDiags = ca.flatMap(m => m.params.context.diagnostics.filter(d => d.source === 'sygnal'))
const respTo = (idPrefix) => ins.filter(m => m.method === undefined && String(m.id).startsWith(idPrefix))
const outReq = (method) => outs.filter(m => m.method === method && m.id !== undefined)
const responseFor = (req) => ins.find(m => m.method === undefined && m.id === req.id)

const summary = {
  start: lines.find(l => l.event === 'start'),
  clientInfo: init?.params.clientInfo,
  processId: init?.params.processId,
  locale: init?.params.locale,
  rootUri: init?.params.rootUri, rootPath: init?.params.rootPath,
  workspaceFolders: init?.params.workspaceFolders,
  initializationOptions: init?.params.initializationOptions,
  trace: init?.params.trace,
  caps: {
    publishDiagnostics: c.textDocument?.publishDiagnostics ?? null,
    pullDiagnostics: c.textDocument?.diagnostic ?? null,
    workspaceDiagnosticsRefresh: c.workspace?.diagnostics ?? null,
    didChangeWatchedFiles: c.workspace?.didChangeWatchedFiles ?? null,
    configuration: c.workspace?.configuration ?? null,
    didChangeConfiguration: c.workspace?.didChangeConfiguration ?? null,
    workspaceFolders: c.workspace?.workspaceFolders ?? null,
    hoverContentFormat: c.textDocument?.hover?.contentFormat ?? null,
    codeAction: c.textDocument?.codeAction ?? null,
    synchronization: c.textDocument?.synchronization ?? null,
    general: c.general ?? null,
    window: c.window ?? null,
    topLevelKeys: Object.keys(c),
    textDocumentKeys: Object.keys(c.textDocument || {}),
    workspaceKeys: Object.keys(c.workspace || {}),
  },
  receivedMethods: count(ins),
  sentMethods: count(outs),
  firstMessageAt: ins[0]?.t, initializedAt: first(m => m.method === 'initialized')?.t,
  firstDidOpenAt: first(m => m.method === 'textDocument/didOpen')?.t,
  didOpen: ins.filter(m => m.method === 'textDocument/didOpen').map(m => ({ t: m.t, uri: m.params.textDocument.uri.split('/').slice(-3).join('/'), languageId: m.params.textDocument.languageId })),
  didChange: ins.filter(m => m.method === 'textDocument/didChange').map(m => ({ t: m.t, uri: m.params.textDocument.uri.split('/').slice(-2).join('/'), v: m.params.textDocument.version, changes: m.params.contentChanges.length, full: !m.params.contentChanges[0]?.range })),
  didSave: ins.filter(m => m.method === 'textDocument/didSave').map(m => ({ t: m.t, uri: m.params.textDocument.uri.split('/').slice(-2).join('/') })),
  pulls: ins.filter(m => m.method === 'textDocument/diagnostic').map(m => ({ t: m.t, id: m.id, uri: m.params.textDocument.uri.split('/').slice(-3).join('/'), identifier: m.params.identifier, previousResultId: m.params.previousResultId })),
  cancels: lines.filter(l => l.event === 'cancel'),
  watchedFileEvents: ins.filter(m => m.method === 'workspace/didChangeWatchedFiles').map(m => ({ t: m.t, changes: m.params.changes.map(ch => ({ type: ch.type, uri: ch.uri.split('/').slice(-3).join('/') })) })),
  registerCapability: outReq('client/registerCapability').map(r => ({ response: responseFor(r) })),
  configurationRequests: outReq('workspace/configuration').map(r => ({ t: r.t, items: r.params.items, response: responseFor(r)?.result ?? responseFor(r)?.error })),
  didChangeConfiguration: ins.filter(m => m.method === 'workspace/didChangeConfiguration').map(m => ({ t: m.t, params: m.params })),
  refreshRequests: outReq('workspace/diagnostic/refresh').map(r => ({ t: r.t, response: responseFor(r) ? 'answered' : 'unanswered' })),
  codeActions: ca.map(m => ({ t: m.t, only: m.params.context.only, triggerKind: m.params.context.triggerKind, sygnalDiagnostics: m.params.context.diagnostics.filter(d => d.source === 'sygnal').length })),
  codeActionDiagnosticSample: caDiags[0] ?? null,
  dataSurvives: caDiags.length ? caDiags.every(d => d.data?.probe === 'data-roundtrip') : null,
  codeDescriptionSurvives: caDiags.length ? caDiags.every(d => !!d.codeDescription?.href) : null,
  relatedInfoSurvives: caDiags.length ? caDiags.every(d => d.relatedInformation?.length) : null,
  hovers: ins.filter(m => m.method === 'textDocument/hover').length,
  unhandled: lines.filter(l => l.event === 'unhandled').map(l => l.method),
  notes: lines.filter(l => l.event === 'note'),
  stderr: lines.filter(l => l.event === 'stderr').map(l => `${l.t}ms ${l.text}`),
  end: lines.filter(l => l.event === 'exit' || l.event === 'stdin-end').map(l => `${l.t}ms ${l.event}`),
}
console.log(JSON.stringify(summary, null, 2))
