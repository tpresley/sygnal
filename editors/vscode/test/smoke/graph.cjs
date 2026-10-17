// Scenario "graph" (PLAN-10 E-2), run by suite.cjs inside VS Code: "Sygnal: Show App Graph" on
// sygnal-check's graph-shop fixture (bundled sygnal-check). The webview's DOM isn't reachable from
// here, so the page's side is read from the extension's message log (api.graph().log()): the page
// posts `ready` only once its script ran under the panel's CSP, `applied` once it drew a graph the
// extension sent, `revealed` with the component it selected.
const assert = require('node:assert/strict')
const path = require('node:path')
const vscode = require('vscode')

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function until(what, fn, ms = 20000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(100)
  }
}

const EXTRA = `

function Extra({ state }) {
  return <div className="extra">{state.n}</div>
}
Extra.initialState = { n: 0 }
Extra.intent = ({ DOM }) => ({ BUMP: DOM.click('.extra') })
Extra.model = { BUMP: (s) => ({ ...s, n: s.n + 1 }) }
`

exports.graphScenario = async function graphScenario(step) {
  const expected = JSON.parse(process.env.EXPECTED_GRAPH) // { components, cartLine } from the CLI's graph
  const [folder] = vscode.workspace.workspaceFolders
  const cartUri = vscode.Uri.joinPath(folder.uri, 'src', 'Cart.jsx')
  const cart = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(cartUri))
  const ext = vscode.extensions.getExtension('sygnal.sygnal')
  const api = await ext.activate()
  await api.ready()
  const g = api.graph()
  const log = (pred) => g.log().filter(pred)

  // 1. the command opens a panel for the root, and the page runs and says so
  const root = await vscode.commands.executeCommand('sygnal.showGraph')
  step('graph.root', root)
  assert.equal(vscode.Uri.parse(root).fsPath, folder.uri.fsPath)
  const ready = await until('the page to say ready', () => log(e => e.dir === 'in' && e.type === 'ready')[0])
  step('graph.ready', ready)
  assert.equal(ready.version, 1)
  assert.deepEqual(g.panels().map(p => ({ components: p.components, visible: p.visible })), [{ components: expected.components, visible: true }])

  // 2. follows the editor: the cursor in Cart selects Cart in the panel
  const cartKey = 'src/Cart.jsx#Cart'
  cart.selection = new vscode.Selection(expected.cartLine + 1, 2, expected.cartLine + 1, 2)
  const revealed = await until('Cart selected in the panel', () => log(e => e.dir === 'in' && e.type === 'revealed' && e.key === cartKey)[0])
  step('graph.revealed', revealed)
  assert.ok(log(e => e.dir === 'out' && e.type === 'reveal' && e.key === cartKey).length >= 1)

  // 3. the same root again: the same panel
  const again = await vscode.commands.executeCommand('sygnal.showGraph', cartUri)
  assert.equal(again, root)
  assert.equal(g.panels().length, 1)

  // 4. an unsaved edit that adds a component: sygnal/graphChanged → the new graph → drawn
  await cart.edit(b => b.insert(cart.document.lineAt(cart.document.lineCount - 1).range.end, EXTRA))
  const applied = await until('the new graph drawn', () => log(e => e.dir === 'in' && e.type === 'applied' && e.components === expected.components + 1)[0])
  step('graph.applied', applied)
  assert.equal(applied.version, 2)
  const sent = log(e => e.dir === 'out' && e.type === 'graph')
  step('graph.sent', sent)
  assert.deepEqual(sent.map(e => [e.version, e.components]), [[2, expected.components + 1]])
  // the cursor in the new component follows too
  const extraLine = cart.document.getText().split('\n').findIndex(l => l.startsWith('function Extra'))
  cart.selection = new vscode.Selection(extraLine + 2, 0, extraLine + 2, 0)
  await until('Extra selected in the panel', () => log(e => e.dir === 'in' && e.type === 'revealed' && e.key === 'src/Cart.jsx#Extra')[0])

  // 5. a link from the page opens the file at its line (and the column of the graph's location there)
  await g.receive(root, { type: 'open', file: 'src/Header.jsx', line: expected.headerAction.line })
  const ed = await until('Header.jsx open', () => vscode.window.activeTextEditor?.document.uri.fsPath.endsWith(path.join('src', 'Header.jsx')) && vscode.window.activeTextEditor)
  step('graph.opened', { line: ed.selection.active.line, character: ed.selection.active.character })
  assert.equal(ed.selection.active.line, expected.headerAction.line - 1)
  assert.equal(ed.selection.active.character, expected.headerAction.column - 1)
  // nothing outside the root
  await g.receive(root, { type: 'open', file: '../outside.jsx', line: 1 })
  await sleep(300)
  assert.ok(vscode.window.activeTextEditor.document.uri.fsPath.endsWith(path.join('src', 'Header.jsx')))

  // 6. closing the panel forgets it; the command makes a new one (Cart.jsx reverted first: no save prompt)
  await vscode.window.showTextDocument(cart.document)
  await vscode.commands.executeCommand('workbench.action.files.revert')
  assert.equal(cart.document.isDirty, false)
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await until('the panel closed', () => g.panels().length === 0)
  await vscode.commands.executeCommand('sygnal.showGraph', cartUri)
  await until('a new page ready', () => log(e => e.dir === 'in' && e.type === 'ready').length === 2)
  step('graph.reopened', g.panels())
  assert.equal(g.panels().length, 1)
}
