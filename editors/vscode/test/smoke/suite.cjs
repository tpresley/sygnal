// Runs inside VS Code (extensionTestsPath). Drives the editor through the extension and records
// each step in $RESULTS; any failed check throws, which fails runTests().
const fs = require('node:fs')
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
// a provider request VS Code cancels (a newer request superseded it while the server was busy,
// as on a slow CI runner) is retried, as an editor would ask again
async function request(what, fn, ms = 15000) {
  return until(what, async () => {
    try { return await fn() } catch (err) { if (/Canceled/.test(String(err?.message ?? err))) return null; throw err }
  }, ms)
}
const codeOf = (d) => String(d.code?.value ?? d.code)
const sygnal = (uri) => vscode.languages.getDiagnostics(uri).filter(d => d.source === 'sygnal')
const shape = (d) => ({ code: codeOf(d), range: [d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character], message: d.message.slice(0, 70) })
const byCode = (a, b) => a.code.localeCompare(b.code)

exports.run = async function run() {
  const out = { scenario: process.env.SCENARIO, steps: {} }
  const step = (k, v) => { out.steps[k] = v; fs.writeFileSync(process.env.RESULTS, JSON.stringify(out, null, 2)) }
  try {
    const scenarios = { bundled: bundledScenario, workspace: workspaceScenario, features: require('./features.cjs').featuresScenario }
    await scenarios[process.env.SCENARIO](step)
    out.ok = true
  } catch (err) {
    out.ok = false
    out.error = String(err?.stack ?? err)
    throw err
  } finally {
    fs.writeFileSync(process.env.RESULTS, JSON.stringify(out, null, 2))
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

/** The fixture's three findings on C.jsx, with the CLI's ranges. */
async function expectThreeFindings(uriC, step, key) {
  const expected = JSON.parse(process.env.EXPECTED_C).sort(byCode)
  const got = await until('the three findings on C.jsx', () => { const d = sygnal(uriC); return d.length >= 3 ? d : null })
  await sleep(300)
  const all = sygnal(uriC).map(shape).sort(byCode)
  step(key, all)
  assert.deepEqual(all.map(d => d.code), ['SYG101', 'SYG102', 'SYG110'])
  assert.deepEqual(all.map(({ code, range }) => ({ code, range })), expected)
  return got
}

async function bundledScenario(step) {
  const [fa, fb] = vscode.workspace.workspaceFolders
  const uriC = vscode.Uri.joinPath(fa.uri, 'src', 'C.jsx')
  const { doc, editor } = await open(uriC)
  const api = await activate()
  step('activated', { choice: api.choice()?.source, reason: api.choice()?.reason })

  // 1. the PoC's three findings, with ranges
  await expectThreeFindings(uriC, step, 'findingsC')

  // 2. the status bar names the bundled copy (the workspace copy in folder c is too old), told once
  const st = api.status()
  step('status', { ...st, upgradeNotices: api.upgradeNotices() })
  assert.equal(st.visible, true)
  assert.match(st.text, /Sygnal/)
  assert.match(st.tooltip, /sygnal-check \S+ bundled with the extension/)
  assert.match(st.tooltip, /sygnal-check 0\.3\.0 has no language server/)
  assert.equal(api.choice().source, 'bundled')
  assert.equal(api.choice().reason, 'too-old')
  assert.equal(api.upgradeNotices(), 1)

  // 3. hover on SYG110 shows its explanation
  const syg110 = sygnal(uriC).find(d => codeOf(d) === 'SYG110')
  const hovers = await request('the hover on SYG110', () => vscode.commands.executeCommand('vscode.executeHoverProvider', uriC, syg110.range.start.translate(0, 2)))
  const hoverText = hovers.flatMap(h => h.contents.map(c => c.value ?? String(c))).join('\n')
  step('hover', hoverText.slice(0, 300))
  assert.match(hoverText, /SYG110/)
  assert.match(hoverText, /Fix/)

  // 4. the preferred quick fix for SYG110 clears it (unsaved buffer)
  const actions = await request('the quick fixes for SYG110', () => vscode.commands.executeCommand('vscode.executeCodeActionProvider', uriC, syg110.range, vscode.CodeActionKind.QuickFix.value))
  step('quickFixes', actions.map(a => ({ title: a.title, kind: a.kind?.value, preferred: !!a.isPreferred })))
  const preferred = actions.filter(a => a.isPreferred && a.kind?.value === 'quickfix')
  assert.equal(preferred.length, 1, 'one preferred fix for SYG110')
  assert.ok(await vscode.workspace.applyEdit(preferred[0].edit))
  assert.match(doc.getText(), /DOM\.click\('\.inc'\)/)
  await until('SYG110 to clear', () => !sygnal(uriC).some(d => codeOf(d) === 'SYG110'))
  step('afterQuickFix', { dirty: doc.isDirty, remaining: sygnal(uriC).map(shape) })
  assert.deepEqual(sygnal(uriC).map(codeOf).sort(), ['SYG101', 'SYG102'])

  // 5. folder-level sygnal.strict: a/S.jsx gets SYG505, b/S.jsx (no setting) nothing
  const uriSa = vscode.Uri.joinPath(fa.uri, 'src', 'S.jsx')
  const uriSb = vscode.Uri.joinPath(fb.uri, 'src', 'S.jsx')
  await until('SYG505 on a/S.jsx', () => sygnal(uriSa).some(d => codeOf(d) === 'SYG505'))
  await until('folder b checked', () => sygnal(vscode.Uri.joinPath(fb.uri, 'src', 'C.jsx')).length >= 3)
  step('strictPerFolder', { a: sygnal(uriSa).map(shape), b: sygnal(uriSb).map(shape) })
  assert.deepEqual(sygnal(uriSb), [])

  // 6. Sygnal: Fix All in File rewrites SYG505 to the object form with event()
  const s = await open(uriSa)
  const changed = await vscode.commands.executeCommand('sygnal.fixAll')
  step('fixAll', { changed, text: s.doc.getText().split('\n')[7] })
  assert.equal(changed, true)
  assert.match(s.doc.getText(), /event\('SAVED'/)
  await until('SYG505 to clear after Fix All', () => sygnal(uriSa).length === 0)

  // 7. Sygnal: Explain Code… (given a code, it skips the picker)
  const explained = await vscode.commands.executeCommand('sygnal.explainCode', 'SYG110')
  const md = explained.getText()
  step('explain', md.split('\n').slice(0, 3))
  assert.match(md, /^# SYG110: /)
  assert.match(md, /## Fix/)
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')

  // 8. Sygnal: Restart Server: a new client, and the findings come back
  const before = api.client()
  await vscode.commands.executeCommand('sygnal.restartServer')
  const after = api.client()
  assert.ok(after && after !== before, 'a new client')
  assert.ok(after.isRunning(), 'running after restart')
  await open(uriC)
  await until('findings after restart', () => sygnal(uriC).length >= 2)
  step('restart', { running: after.isRunning(), findingsC: sygnal(uriC).map(shape) })
  assert.match(api.status().tooltip, /bundled with the extension/)
  assert.equal(api.upgradeNotices(), 1, 'the upgrade notice is shown once')

  // 9. Show Output runs
  await vscode.commands.executeCommand('sygnal.showOutput')
  step('showOutput', true)
  void editor
}

async function workspaceScenario(step) {
  const [f] = vscode.workspace.workspaceFolders
  const uriC = vscode.Uri.joinPath(f.uri, 'src', 'C.jsx')
  await open(uriC)
  const api = await activate()
  await expectThreeFindings(uriC, step, 'findingsC')
  const st = api.status()
  step('status', { ...st, choice: api.choice(), upgradeNotices: api.upgradeNotices() })
  assert.equal(api.choice().source, 'workspace')
  assert.match(st.tooltip, /from the workspace/)
  assert.equal(api.upgradeNotices(), 0)
}
