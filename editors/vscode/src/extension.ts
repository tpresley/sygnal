// The Sygnal extension (PLAN-7 V-1): runs `sygnal-check lsp` with vscode-languageclient.
//
// Activation: `workspaceContains:**/sygnal-check.config.json`, or opening a JS/TS file. On
// activation it looks for Sygnal (a sygnal-check config file, or a package.json that depends on
// sygnal / sygnal-check); without one it stays idle (no server) and watches for one to appear.
//
// Server: the workspace's own node_modules/sygnal-check when it has the language server, else the
// copy bundled in the extension (D301); see resolve.ts. It runs on VS Code's own Node
// (process.execPath with ELECTRON_RUN_AS_NODE) over stdio. No synchronize.fileEvents: the server
// registers its watchers and didChangeConfiguration itself (0-S2).
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { LanguageClient, State, TransportKind, type LanguageClientOptions, type ServerOptions } from 'vscode-languageclient/node'
import { chooseServer, describeChoice, packageFileUsesSygnal, type ServerChoice } from './resolve'

const LANGUAGES = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact']
const EXCLUDE = '**/node_modules/**'

let client: LanguageClient | undefined
let choice: ServerChoice | undefined
let output: vscode.LogOutputChannel
let status: vscode.StatusBarItem
let ctx: vscode.ExtensionContext
let starting: Promise<void> | undefined
let detectWatchers: vscode.Disposable[] = []
let upgradeNotices = 0

/** What the tests read (returned from activate). */
export interface SygnalApi {
  client(): LanguageClient | undefined
  choice(): ServerChoice | undefined
  status(): { text: string; tooltip: string; visible: boolean }
  upgradeNotices(): number
  ready(): Promise<void>
}

export async function activate(context: vscode.ExtensionContext): Promise<SygnalApi> {
  ctx = context
  output = vscode.window.createOutputChannel('Sygnal', { log: true })
  status = vscode.window.createStatusBarItem('sygnal.status', vscode.StatusBarAlignment.Right, 100)
  status.name = 'Sygnal'
  status.command = 'sygnal.showOutput'
  let statusVisible = false
  const show = (v: boolean) => { statusVisible = v; v ? status.show() : status.hide() }
  context.subscriptions.push(output, status,
    vscode.commands.registerCommand('sygnal.restartServer', () => restart(show)),
    vscode.commands.registerCommand('sygnal.showOutput', () => output.show(true)),
    vscode.commands.registerCommand('sygnal.explainCode', explainCode),
    vscode.commands.registerCommand('sygnal.fixAll', fixAll),
    vscode.workspace.onDidChangeWorkspaceFolders(() => restart(show)),
    vscode.workspace.onDidGrantWorkspaceTrust(() => restart(show)),
    { dispose: () => disposeDetectWatchers() },
  )
  starting = startIfSygnal(show)
  await starting
  return {
    client: () => client,
    choice: () => choice,
    status: () => ({ text: status.text, tooltip: String(status.tooltip ?? ''), visible: statusVisible }),
    upgradeNotices: () => upgradeNotices,
    ready: async () => { await starting; if (client && !client.isRunning()) await client.start() },
  }
}

export async function deactivate(): Promise<void> {
  disposeDetectWatchers()
  await stopClient()
}

function folderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath)
}

/** Whether the workspace uses Sygnal. Cheap: folder roots first, then a bounded search. */
async function workspaceUsesSygnal(): Promise<boolean> {
  const folders = folderPaths()
  for (const f of folders) {
    if (fs.existsSync(path.join(f, 'sygnal-check.config.json'))) return true
    if (packageFileUsesSygnal(path.join(f, 'package.json'))) return true
  }
  if (!folders.length) return false
  if ((await vscode.workspace.findFiles('**/sygnal-check.config.json', EXCLUDE, 1)).length) return true
  const pkgs = await vscode.workspace.findFiles('**/package.json', EXCLUDE, 50)
  return pkgs.some(uri => packageFileUsesSygnal(uri.fsPath))
}

function disposeDetectWatchers() {
  for (const d of detectWatchers) d.dispose()
  detectWatchers = []
}

/** Starts the server when the workspace uses Sygnal; otherwise watches for it to start using it. */
async function startIfSygnal(show: (v: boolean) => void): Promise<void> {
  disposeDetectWatchers()
  if (!(await workspaceUsesSygnal())) {
    output.info('No Sygnal project in this workspace (no sygnal-check.config.json, no package.json depending on sygnal): idle.')
    show(false)
    const recheck = () => { if (!client) { starting = startIfSygnal(show) } }
    for (const glob of ['**/sygnal-check.config.json', '**/package.json']) {
      const w = vscode.workspace.createFileSystemWatcher(glob, false, false, true)
      w.onDidCreate(recheck); w.onDidChange(recheck)
      detectWatchers.push(w)
    }
    return
  }
  await startClient(show)
}

async function startClient(show: (v: boolean) => void): Promise<void> {
  const bundledDir = ctx.asAbsolutePath(path.join('server', 'sygnal-check'))
  try {
    choice = chooseServer(folderPaths(), bundledDir, { trusted: vscode.workspace.isTrusted })
  } catch (err) {
    output.error(String((err as Error)?.message ?? err))
    status.text = '$(error) Sygnal'
    status.tooltip = `Sygnal: ${String((err as Error)?.message ?? err)}`
    show(true)
    return
  }
  const described = describeChoice(choice)
  output.info(`Using ${described}`)
  status.text = choice.source === 'workspace' ? '$(check) Sygnal' : '$(package) Sygnal'
  status.tooltip = `Sygnal: ${described}. Click for the output.`
  show(true)
  if (choice.reason === 'too-old') notifyUpgrade(choice)

  const run = {
    command: process.execPath,
    args: [choice.bin, 'lsp'],
    transport: TransportKind.stdio,
    options: { cwd: choice.folder ?? folderPaths()[0], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
  }
  const serverOptions: ServerOptions = { run, debug: run }
  const clientOptions: LanguageClientOptions = {
    documentSelector: LANGUAGES.map(language => ({ scheme: 'file', language })),
    outputChannel: output,
    traceOutputChannel: output,
    // No synchronize: the server registers file watchers and didChangeConfiguration dynamically,
    // and asks for the `sygnal` section per folder with workspace/configuration.
  }
  client = new LanguageClient('sygnal', 'Sygnal', serverOptions, clientOptions)
  client.onDidChangeState(e => {
    if (e.newState === State.Stopped && status) status.text = '$(warning) Sygnal'
    else if (e.newState === State.Running && choice) status.text = choice.source === 'workspace' ? '$(check) Sygnal' : '$(package) Sygnal'
  })
  try {
    await client.start()
  } catch (err) {
    output.error(`The Sygnal language server failed to start: ${String((err as Error)?.stack ?? err)}`)
    status.text = '$(error) Sygnal'
  }
}

async function stopClient(): Promise<void> {
  const c = client
  client = undefined
  if (!c) return
  try { if (c.state !== State.Stopped) await c.stop(2000) } catch (err) { output?.warn(`stop: ${String(err)}`) }
  try { await c.dispose(2000) } catch { /* already stopped */ }
}

async function restart(show: (v: boolean) => void): Promise<void> {
  await starting
  starting = (async () => {
    await stopClient()
    output.info('Restarting the Sygnal language server')
    await startIfSygnal(show)
  })()
  await starting
}

/** Once per workspace and old version: the workspace copy can't run the server. */
function notifyUpgrade(c: ServerChoice) {
  const key = `sygnal.upgradeNotice:${c.old?.dir}@${c.old?.version}`
  if (ctx.workspaceState.get(key)) return
  void ctx.workspaceState.update(key, true)
  upgradeNotices++
  void vscode.window.showInformationMessage(
    `This workspace has sygnal-check ${c.old?.version}, which has no language server (it needs 0.4.0 or later). ` +
    `Sygnal is using the sygnal-check ${c.version} bundled with the extension. To use the project's version, ` +
    'upgrade it: npm i -D sygnal-check@latest.',
    'Show Output',
  ).then(pick => { if (pick) output.show(true) })
}

interface Explanation { code: string; title: string; severity: string; strict?: boolean; reportedBy?: string[]; explanation: string; fix: string; docsUrl?: string }

const WHO: Record<string, string> = { runtime: 'the Sygnal runtime', 'dev-entry': "the 'sygnal/diagnostics' dev checks", static: 'sygnal-check', retired: 'retired' }

function loadExplanations(): Explanation[] {
  const dirs = [choice?.dir, ctx.asAbsolutePath(path.join('server', 'sygnal-check'))].filter(Boolean) as string[]
  for (const dir of dirs) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dir, 'explanations.json'), 'utf8'))
      if (Array.isArray(list) && list.length) return list
    } catch { /* try the next copy */ }
  }
  return []
}

/** The markdown shown for one explanation (also what the tests compare). */
export function explanationMarkdown(e: Explanation): string {
  const who = (e.reportedBy ?? []).map(r => WHO[r] ?? r).join(', ') + (e.strict ? ' (strict mode)' : '')
  const url = e.docsUrl ?? `https://sygnal.js.org/reference/errors#${e.code.toLowerCase()}`
  return [
    `# ${e.code}: ${e.title}`, '',
    `**Severity:** ${e.severity}${who ? `  \n**Reported by:** ${who}` : ''}`, '',
    e.explanation, '',
    '## Fix', '',
    e.fix, '',
    `[${url}](${url})`, '',
  ].join('\n')
}

async function explainCode(code?: string): Promise<vscode.TextDocument | undefined> {
  const list = loadExplanations()
  if (!list.length) { void vscode.window.showWarningMessage('Sygnal: no explanations found (explanations.json).'); return }
  let entry = typeof code === 'string' ? list.find(e => e.code === code.toUpperCase()) : undefined
  if (!entry) {
    const picked = await vscode.window.showQuickPick(
      list.map(e => ({ label: e.code, description: e.title, detail: `${e.severity}${e.strict ? ', strict mode' : ''}`, e })),
      { placeHolder: 'Explain a Sygnal diagnostic code', matchOnDescription: true },
    )
    if (!picked) return
    entry = picked.e
  }
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: explanationMarkdown(entry) })
  try {
    await vscode.commands.executeCommand('markdown.showPreview', doc.uri)
  } catch {
    await vscode.window.showTextDocument(doc, { preview: true })
  }
  return doc
}

/** Applies the server's `source.fixAll.sygnal` action to the active file. Returns whether it changed. */
async function fixAll(uri?: vscode.Uri): Promise<boolean> {
  const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri
  if (!target) return false
  if (!client) { void vscode.window.showWarningMessage('Sygnal: the language server is not running.'); return false }
  const doc = await vscode.workspace.openTextDocument(target)
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
    'vscode.executeCodeActionProvider', target, new vscode.Range(0, 0, doc.lineCount, 0), 'source.fixAll.sygnal') ?? []
  const action = actions.find(a => a.kind && vscode.CodeActionKind.SourceFixAll.append('sygnal').contains(a.kind))
  if (!action) { void vscode.window.setStatusBarMessage('Sygnal: nothing to fix in this file', 3000); return false }
  let changed = false
  if (action.edit) changed = await vscode.workspace.applyEdit(action.edit)
  if (action.command) await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments ?? []))
  return changed
}
