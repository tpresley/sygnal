// Scenario "features" (0.2.0), run by suite.cjs inside VS Code: completions, go to definition /
// references, code lens and rename, through VS Code's own commands (what the editor's UI calls),
// and the raw LSP answers where VS Code's conversion hides a detail (annotations, versions).
// Workspace (run.mjs): the kanban example with its tests, the PoC fixture's C.jsx, Flow.jsx and
// Listener.jsx; the bundled sygnal-check.
const assert = require('node:assert/strict')
const vscode = require('vscode')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function until(what, fn, ms = 15000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(100)
  }
}
async function open(uri) {
  const doc = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(doc)
  return { doc, editor }
}
async function activate() {
  const ext = vscode.extensions.getExtension('sygnal.sygnal')
  assert.ok(ext, 'the extension sygnal.sygnal is installed')
  const api = await ext.activate()
  await api.ready()
  return api
}

/** The position of `needle` (its `nth` occurrence) in doc, `at` characters into it. */
function posOf(doc, needle, at = 0, nth = 0) {
  const text = doc.getText()
  let i = -1
  for (let n = 0; n <= nth; n++) { i = text.indexOf(needle, i + 1); if (i < 0) throw new Error(`'${needle}' not in ${doc.uri.path}`) }
  return doc.positionAt(i + at)
}
const lineOf = (doc, needle, nth = 0) => posOf(doc, needle, 0, nth).line
const fileOf = (uri) => (typeof uri === 'string' ? uri : uri.path).split('/').pop()
/** Location | LocationLink → { file, line, character }. */
const loc = (l) => {
  const uri = l.targetUri ?? l.uri
  const r = l.targetSelectionRange ?? l.targetRange ?? l.range
  return { file: fileOf(uri), line: r.start.line, character: r.start.character }
}
// Sygnal's completion items, told from TypeScript's and the word-based ones by their detail
const SYGNAL_DETAIL = /view|intent action|EVENTS type|model action|built-in action|next\(\) target/
const sygnalItems = (list) => (list?.items ?? []).filter(i => SYGNAL_DETAIL.test(i.detail ?? ''))
const labelOf = (i) => typeof i.label === 'string' ? i.label : i.label.label

async function replaceAll(doc, text) {
  const edit = new vscode.WorkspaceEdit()
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text)
  assert.ok(await vscode.workspace.applyEdit(edit))
}
async function insertAt(doc, position, text) {
  const edit = new vscode.WorkspaceEdit()
  edit.insert(doc.uri, position, text)
  assert.ok(await vscode.workspace.applyEdit(edit))
}
/** The edits of a vscode.WorkspaceEdit as { file, line, character, newText }. */
const editsOf = (we) => we.entries().flatMap(([uri, edits]) => edits.map(e => ({ file: fileOf(uri), line: e.range.start.line, character: e.range.start.character, newText: e.newText })))
const lspPos = (p) => ({ line: p.line, character: p.character })

exports.featuresScenario = async function featuresScenario(step) {
  const [f] = vscode.workspace.workspaceFolders
  const src = (name) => vscode.Uri.joinPath(f.uri, 'src', name)
  const uriFlow = src('Flow.jsx')
  const { doc } = await open(uriFlow)
  const api = await activate()
  const client = api.client()
  step('activated', { choice: api.choice()?.source })
  // the first check is in when Flow has its lenses
  await until('the first check (Flow lenses)', async () => {
    const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uriFlow, 50)
    return lenses?.some(l => /handled by/.test(l.command?.title ?? ''))
  }, 30000)
  const original = doc.getText()
  const complete = (position, trigger) => vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uriFlow, position, trigger)
  const lspRename = (uri, position, newName) => client.sendRequest('textDocument/rename', { textDocument: { uri: uri.toString() }, position: lspPos(position), newName })
  const lspPrepare = (uri, position) => client.sendRequest('textDocument/prepareRename', { textDocument: { uri: uri.toString() }, position: lspPos(position) })
  const rename = (uri, position, name) => vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, position, name)

  // ---- 1. completions (unsaved edits of Flow.jsx, restored after)
  // a selector after `.`: only the view's classes
  await insertAt(doc, new vscode.Position(lineOf(doc, '  RESET: EVENTS.select('), 0), "  PICK: DOM.click('.\n")
  let at = posOf(doc, "PICK: DOM.click('.", "PICK: DOM.click('.".length)
  let items = sygnalItems(await complete(at, '.'))
  step('completion.class', items.map(i => `${labelOf(i)} (${i.detail})`))
  assert.deepEqual(items.map(labelOf).sort(), ['.count', '.primary', '.save'])
  // after `#`: only ids
  await replaceAll(doc, doc.getText().replace("PICK: DOM.click('.", "PICK: DOM.click('#"))
  at = posOf(doc, "PICK: DOM.click('#", "PICK: DOM.click('#".length)
  items = sygnalItems(await complete(at, '#'))
  step('completion.id', items.map(i => `${labelOf(i)} (${i.detail})`))
  assert.deepEqual(items.map(labelOf).sort(), ['#flow-root', '#name'])
  // a model key: the intent action with no model entry (PICK, once a check has seen it), as a snippet
  await replaceAll(doc, doc.getText().replace("PICK: DOM.click('#\n", "PICK: DOM.click('#name'),\n"))
  await insertAt(doc, new vscode.Position(lineOf(doc, '  RESET: (state, _data, next)'), 0), '  \n')
  at = new vscode.Position(lineOf(doc, '  RESET: (state, _data, next)') - 1, 2)
  const pick = await until('PICK as a model-key completion', async () => sygnalItems(await complete(at)).find(i => labelOf(i) === 'PICK'))
  items = sygnalItems(await complete(at))
  step('completion.modelKey', { labels: items.map(labelOf), detail: pick.detail, snippet: pick.insertText?.value ?? pick.insertText })
  assert.ok(pick.insertText instanceof vscode.SnippetString, 'a snippet')
  assert.match(pick.insertText.value, /^PICK: \(/)
  assert.match(pick.detail, /intent action · Flow \(no model entry\)/)
  assert.ok(!items.some(i => labelOf(i) === 'SAVE' || labelOf(i) === 'RESET'), 'handled actions are not offered')
  // EVENTS.select(': the types emitted in the project (Flow's, Listener's, kanban's)
  await replaceAll(doc, doc.getText().replace('  \n  RESET: (state, _data, next)', '  RESET: (state, _data, next)'))
  await insertAt(doc, new vscode.Position(lineOf(doc, '  RESET: EVENTS.select('), 0), "  HEAR: EVENTS.select('\n")
  at = posOf(doc, "HEAR: EVENTS.select('", "HEAR: EVENTS.select('".length)
  items = sygnalItems(await complete(at, "'"))
  step('completion.events', items.map(i => `${labelOf(i)} (${i.detail})`))
  for (const t of ['FLOW_SAVED', 'FLOW_RESET', 'DELETE_LANE', 'MOVE_LANE_LEFT']) assert.ok(items.some(i => labelOf(i) === t), `EVENTS type ${t}`)
  // a plain JSX string: nothing from Sygnal (the server answers null)
  at = posOf(doc, 'title="plain', 'title="pl'.length)
  const raw = await client.sendRequest('textDocument/completion', { textDocument: { uri: uriFlow.toString() }, position: lspPos(at) })
  items = sygnalItems(await complete(at))
  step('completion.plainString', { server: raw, sygnalItems: items.length })
  assert.ok(raw == null || (Array.isArray(raw) ? raw : raw.items).length === 0)
  assert.equal(items.length, 0)
  await replaceAll(doc, original)
  await doc.save()

  // ---- 2. go to definition / references
  const def = (uri, position) => vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position)
  const refs = (uri, position) => vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position)
  const intentSave = posOf(doc, '  SAVE: DOM.click', 3)
  const modelSave = posOf(doc, '  SAVE: { STATE', 3)
  let got = (await until('definition intent → model', async () => { const d = await def(uriFlow, intentSave); return d?.some(l => loc(l).line === modelSave.line) && d })).map(loc)
  step('definition.intentToModel', got)
  got = (await def(uriFlow, modelSave)).map(loc)
  step('definition.modelToIntent', got)
  assert.ok(got.some(l => l.file === 'Flow.jsx' && l.line === intentSave.line), 'model key → intent key')
  // a selector's class → the view element rendering it
  got = (await def(uriFlow, posOf(doc, "DOM.click('.save')", "DOM.click('.s".length))).map(loc)
  step('definition.selectorToView', got)
  assert.ok(got.some(l => l.file === 'Flow.jsx' && l.line === lineOf(doc, 'className="save primary"')), 'selector → view element')
  // references on an EVENTS type, across files (Listener.jsx is not open)
  got = (await refs(uriFlow, posOf(doc, "event('FLOW_SAVED'", "event('FL".length))).map(loc)
  step('references.events', got)
  assert.ok(got.some(l => l.file === 'Flow.jsx'))
  assert.ok(got.some(l => l.file === 'Listener.jsx'))
  // and kanban's DELETE_LANE (selected in RootComponent, emitted in LaneComponent, not open)
  const root = await open(src('RootComponent.jsx'))
  got = (await refs(root.doc.uri, posOf(root.doc, "EVENTS.select('DELETE_LANE')", "EVENTS.select('DE".length))).map(loc)
  step('references.kanban', got)
  assert.ok(got.some(l => l.file === 'LaneComponent.jsx') && got.some(l => l.file === 'RootComponent.jsx'))
  await vscode.window.showTextDocument(doc)

  // ---- 3. code lens
  const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uriFlow, 50)
  const lensAt = (line) => lenses.filter(l => l.range.start.line === line).map(l => l.command)
  step('codeLens', lenses.map(l => ({ line: l.range.start.line, title: l.command?.title, command: l.command?.command })))
  const onIntent = lensAt(intentSave.line)
  const onModel = lensAt(modelSave.line)
  assert.ok(onIntent.some(c => /^handled by model\.SAVE/.test(c.title)), 'a lens on the intent key')
  assert.ok(onModel.some(c => /^triggered by .*intent/.test(c.title) && /next from RESET/.test(c.title)), 'a lens on the model key')
  const clickable = onIntent.find(c => c.command)
  assert.equal(clickable.command, 'sygnal.showReferences')
  await vscode.commands.executeCommand(clickable.command, ...(clickable.arguments ?? []))
  step('codeLens.click', { command: clickable.command, argumentTypes: (clickable.arguments ?? []).map(a => Array.isArray(a) ? 'array' : typeof a) })
  await vscode.commands.executeCommand('closeReferenceSearch')

  // ---- 4. rename an action across intent / model / next()
  let we = await rename(uriFlow, intentSave, 'STORE')
  let edits = editsOf(we)
  step('rename.action', edits)
  assert.equal(edits.length, 3)
  assert.ok(edits.every(e => e.file === 'Flow.jsx' && e.newText === 'STORE'))
  assert.ok(await vscode.workspace.applyEdit(we))
  assert.match(doc.getText(), /STORE: DOM\.click/)
  assert.match(doc.getText(), /STORE: \{ STATE/)
  assert.match(doc.getText(), /next\('STORE'\)/)
  await doc.save()

  // ---- 5. unsaved buffer: a next('RESET') typed but not saved is renamed too
  await insertAt(doc, new vscode.Position(lineOf(doc, '  RESET: (state, _data, next)'), 0), "  AGAIN: (state, _data, next) => { next('RESET'); return state },\n")
  await insertAt(doc, new vscode.Position(lineOf(doc, '  RESET: EVENTS.select('), 0), "  AGAIN: DOM.click('#name'),\n")
  assert.ok(doc.isDirty)
  we = await rename(uriFlow, posOf(doc, '  RESET: EVENTS', 3), 'CLEAR_ALL')
  edits = editsOf(we)
  step('rename.unsaved', edits)
  assert.ok(edits.some(e => e.line === lineOf(doc, "next('RESET'); return state") && e.newText === 'CLEAR_ALL'), 'the unsaved next() is renamed')
  assert.equal(edits.length, 3)
  await replaceAll(doc, doc.getText().split('\n').filter(l => !l.includes('AGAIN')).join('\n'))
  await doc.save()

  // ---- 6. a refusal (a built-in): Sygnal's message, then VS Code falls through to TypeScript's rename
  await vscode.window.showTextDocument(root.doc)
  const boot = posOf(root.doc, 'BOOTSTRAP:', 3)
  const refusal = await lspPrepare(root.doc.uri, boot).then(r => ({ ok: r }), e => ({ code: e.code, message: e.message }))
  step('rename.refusal.server', refusal)
  assert.equal(refusal.code, -32803)
  assert.match(refusal.message, /BOOTSTRAP is built in/)
  const ts = await rename(root.doc.uri, boot, 'START').then(w => ({ edits: editsOf(w) }), e => ({ error: String(e?.message ?? e) }))
  step('rename.refusal.fallthrough', ts)
  assert.ok(ts.edits && ts.edits.length >= 1 && ts.edits.every(e => e.newText === 'START'), "TypeScript's rename answers")

  // ---- 7. the prepare range on a string's contents: from the opening quote, inside, the closing quote
  const quote = posOf(root.doc, "EVENTS.select('MOVE_LANE_RIGHT')", 'EVENTS.select('.length)
  const contents = [quote.character + 1, quote.character + 1 + 'MOVE_LANE_RIGHT'.length]
  const range = (r) => r && { range: [r.range.start.character, r.range.end.character], placeholder: r.placeholder }
  const prepared = {}
  for (const [name, p] of [['openingQuote', quote], ['inside', quote.translate(0, 3)], ['closingQuote', quote.translate(0, "'MOVE_LANE_RIGHT".length)]]) {
    prepared[name] = {
      server: await lspPrepare(root.doc.uri, p).then(range, e => ({ error: e.message })),
      vscode: await vscode.commands.executeCommand('vscode.prepareRename', root.doc.uri, p).then(range, e => ({ error: String(e?.message ?? e) })),
    }
  }
  step('rename.prepare', { contents, ...prepared })
  assert.deepEqual(prepared.inside.server?.range, contents)
  assert.deepEqual(prepared.inside.vscode?.range, contents)

  // ---- 8. a file not opened yet: version null edits, which VS Code applies
  const flowSaved = posOf(doc, "event('FLOW_SAVED'", "event('FL".length)
  const lsp = await lspRename(uriFlow, flowSaved, 'FLOW_STORED')
  step('rename.unopened.lsp', lsp.documentChanges.map(c => ({ file: fileOf(c.textDocument.uri), version: c.textDocument.version, edits: c.edits.length })))
  const listenerChange = lsp.documentChanges.find(c => c.textDocument.uri.endsWith('Listener.jsx'))
  assert.ok(listenerChange, 'Listener.jsx is edited')
  assert.equal(listenerChange.textDocument.version, null)
  assert.ok(!vscode.workspace.textDocuments.some(d => d.uri.path.endsWith('Listener.jsx')), 'Listener.jsx is not open')
  we = await rename(uriFlow, flowSaved, 'FLOW_STORED')
  const applied = await vscode.workspace.applyEdit(we)
  const listener = await vscode.workspace.openTextDocument(src('Listener.jsx'))
  step('rename.unopened.applied', { applied, listener: listener.getText().split('\n').find(l => l.includes('EVENTS.select')) })
  assert.equal(applied, true)
  assert.match(listener.getText(), /EVENTS\.select\('FLOW_STORED'\)/)
  assert.match(doc.getText(), /event\('FLOW_STORED'/)
  await vscode.workspace.saveAll(false)

  // ---- 9. a rename touching test files: annotated edits that need confirmation (the refactor preview)
  const lane = await open(src('LaneComponent.jsx'))
  const startEdit = posOf(lane.doc, '  START_EDIT:  DOM.dblclick', 3)
  const annotated = await lspRename(lane.doc.uri, startEdit, 'BEGIN_EDIT')
  const groups = {}
  for (const c of annotated.documentChanges) {
    for (const e of c.edits) {
      const k = `${fileOf(c.textDocument.uri)}:${e.annotationId ?? '-'}`
      groups[k] = (groups[k] ?? 0) + 1
    }
  }
  step('rename.tests.lsp', { groups, changeAnnotations: annotated.changeAnnotations })
  assert.equal(annotated.changeAnnotations?.test?.needsConfirmation, true)
  assert.ok(Object.keys(groups).some(k => /\.test\.js:test$/.test(k)), 'test-file edits carry the test annotation')
  assert.ok(Object.keys(groups).includes('LaneComponent.jsx:-'), 'code edits are not annotated')
  // the edit as the rename provider hands it to VS Code (vscode-languageclient's conversion keeps
  // the annotations as needsConfirmation metadata): applying it opens the refactor preview, and
  // the edit waits there; discarding it applies nothing
  const pending = vscode.workspace.applyEdit(await client.protocol2CodeConverter.asWorkspaceEdit(annotated))
  let settled = false
  pending.then(() => { settled = true }, () => { settled = true })
  await sleep(2500)
  const waited = !settled
  if (waited) await vscode.commands.executeCommand('refactorPreview.discard')
  const result = await pending
  step('rename.tests.preview', { waitedForConfirmation: waited, applied: result, stillStartEdit: /START_EDIT/.test(lane.doc.getText()) })
  assert.equal(waited, true, 'the refactor preview held the edit')
  assert.equal(result, false)
  assert.match(lane.doc.getText(), /START_EDIT/)
  // through vscode.executeDocumentRenameProvider: the same edits, test files included (this
  // command's WorkspaceEdit carries no metadata, so it isn't applied here: it would skip the preview)
  we = await rename(lane.doc.uri, startEdit, 'BEGIN_EDIT')
  const files = [...new Set(editsOf(we).map(e => e.file))]
  step('rename.tests.vscode', { files, edits: editsOf(we).length })
  assert.deepEqual(files.sort(), ['LaneComponent.jsx', 'LaneComponent.test.js'])
  assert.equal(editsOf(we).length, Object.values(groups).reduce((a, b) => a + b, 0))
}
