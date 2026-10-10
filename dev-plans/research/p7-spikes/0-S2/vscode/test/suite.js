// Runs inside VS Code (extensionTestsPath). Drives the editor and records what the editor sees;
// the server's own log (SYGNAL_LSP_LOG) records what the client sent.
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function until(fn, ms = 10000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(100) } }
const shape = (d) => ({ code: d.code, source: d.source, severity: d.severity, message: d.message.slice(0, 60),
  range: `${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character}`,
  related: (d.relatedInformation || []).length })

exports.run = async function run() {
  const out = {}
  const step = (k, v) => { out[k] = v; fs.writeFileSync(process.env.RESULTS, JSON.stringify(out, null, 2)) }
  const [fa, fb] = vscode.workspace.workspaceFolders
  step('workspaceFolders', vscode.workspace.workspaceFolders.map(f => f.name))
  const uriC = vscode.Uri.joinPath(fa.uri, 'src', 'C.jsx')
  const doc = await vscode.workspace.openTextDocument(uriC)
  const editor = await vscode.window.showTextDocument(doc)
  const ext = vscode.extensions.getExtension('sygnal-spike.sygnal-0s2-probe')
  await ext.activate()

  const diags = await until(() => { const d = vscode.languages.getDiagnostics(uriC); return d.length ? d : null })
  await sleep(1500) // let push and pull both land
  const all = vscode.languages.getDiagnostics(uriC)
  step('diagnosticsC', all.map(shape))
  // diagnostics for files the client never opened (push only reaches them; pull asks per open document)
  const uriA = vscode.Uri.joinPath(fa.uri, 'src', 'A.tsx')
  const uriB2 = vscode.Uri.joinPath(fb.uri, 'src', 'C.jsx')
  step('diagnosticsUnopened', { A_tsx: vscode.languages.getDiagnostics(uriA).length, folderB_C_jsx: vscode.languages.getDiagnostics(uriB2).length })

  const sel = all.find(d => (d.code?.value ?? d.code) === 'SYG110')
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uriC, sel.range.start.translate(0, 2))
  step('hover', hovers.map(h => h.contents.map(c => (c.value ?? String(c)).slice(0, 80))))
  const qf = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uriC, sel.range)
  step('codeActions', qf.map(a => ({ title: a.title, kind: a.kind?.value, preferred: a.isPreferred })))
  const fixAll = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uriC, new vscode.Range(0, 0, 0, 0), 'source.fixAll')
  step('fixAllActions', fixAll.map(a => ({ title: a.title, kind: a.kind?.value })))

  // rapid unsaved edits: provoke $/cancelRequest of a pending pull (server delays pulls)
  for (let i = 0; i < 4; i++) { await editor.edit(e => e.insert(new vscode.Position(6, 0), `// edit ${i}\n`)); await sleep(30) }
  await sleep(2000)
  // fix the bugs in the unsaved buffer
  const text = doc.getText().replace("'.incc'", "'.inc'").replace('INCREMNT', 'INCREMENT')
  await editor.edit(e => e.replace(new vscode.Range(0, 0, doc.lineCount, 0), text))
  const cleared = await until(() => vscode.languages.getDiagnostics(uriC).filter(d => d.source === 'sygnal').length === 0 ? true : null, 5000)
  step('afterUnsavedFix', { cleared: !!cleared, remaining: vscode.languages.getDiagnostics(uriC).filter(d => d.source === 'sygnal').map(shape) })

  // a file created on disk (outside the editor) in folder B: does didChangeWatchedFiles arrive?
  fs.writeFileSync(path.join(fb.uri.fsPath, 'src', 'D.jsx'), "function D() { return <div className=\"x\" /> }\nD.intent = ({ DOM }) => ({ GO: DOM.click('.y') })\nD.model = { GO: (s) => s }\nexport default D\n")
  await sleep(2500)
  const uriD = vscode.Uri.joinPath(fb.uri, 'src', 'D.jsx')
  step('newFileOnDisk', { diagnosticsForD: vscode.languages.getDiagnostics(uriD).map(shape) })

  // a settings change: didChangeConfiguration? workspace/configuration again?
  await vscode.workspace.getConfiguration('sygnal').update('strict', false, vscode.ConfigurationTarget.Workspace)
  await sleep(1500)
  step('done', true)
}
