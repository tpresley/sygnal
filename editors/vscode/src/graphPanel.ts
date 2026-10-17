// "Sygnal: Show App Graph" (PLAN-10 E-2, D503): the app graph page of `sygnal-check --graph=html`
// in a webview panel, one per project root, kept up to date by the language server.
//
// The page: graphHtml() from the bundled sygnal-check (server/sygnal-check/src/graphView/html.js,
// loaded with import()), with `host: 'vscode'`, which adds the page's VS Code host adapter
// (graphView/vscodeHost.js: the messages, the theme, the saved state). The graph itself comes from
// the running server (`sygnal/graph`, PLAN-10 E-1), the workspace's sygnal-check or the bundled one;
// a server without the request (before sygnal-check 0.10.0) gets a message.
//
// Security: scripts on, run by a per-page nonce (the page's CSP: `default-src 'none'`, the inline
// style, the one inline script by its nonce, data:/blob: images), `localResourceRoots: []` (the
// page loads nothing), no remote content. Editor links never navigate: the adapter posts
// { type: 'open', file, line } and the file (inside the panel's root only) opens with
// showTextDocument, at the column of the first graph location on that line.
//
// Updates: the server's `sygnal/graphChanged` { root } → `sygnal/graph` again → { type: 'graph' }
// to the page, which keeps its view and selection by component key. On a server (re)start every
// open panel asks again (a new server knows no roots yet).
//
// Follow the editor: after the active editor or its cursor moves (debounced), the component whose
// span holds the cursor (graphCore.componentKeyAt) is selected in its root's panel.
//
// State: no retainContextWhenHidden. VS Code re-creates the page when the panel shows again (from
// the html set once, with the graph of that time); the page then posts `ready` and gets the latest
// graph, and restores its selection, view and search from the webview state. The serializer
// restores panels after a restart from the same state (`root`).
import * as vscode from 'vscode'
import { pathToFileURL } from 'node:url'
import type { LanguageClient } from 'vscode-languageclient/node'
import { State } from 'vscode-languageclient/node'
import {
  columnFor, componentKeyAt, makeNonce, pageMeta, panelTitle, readPageMessage, relativeInRoot, resolveInRoot,
  type GraphAnswer, type InspectGraph,
} from './graphCore'

export const VIEW_TYPE = 'sygnal.graph'
const METHOD_NOT_FOUND = -32601
const FOLLOW_MS = 150
const LOG_MAX = 500

export interface GraphLogEntry { dir: 'in' | 'out'; root: string; type: string; version?: number | null; key?: string | null; components?: number; file?: string; line?: number }

interface Panel {
  rootUri: string
  root: string
  panel: vscode.WebviewPanel
  graph: InspectGraph | null
  /** The page's graph version: counts the graphs this panel sent */
  version: number
  revealed: string | null
  disposables: vscode.Disposable[]
}

export interface GraphPanels extends vscode.Disposable {
  attach(client: LanguageClient): void
  /** The command: the graph of `target`'s root (default: the active editor's, else the workspace folder's). */
  show(target?: vscode.Uri): Promise<string | undefined>
  /** For the tests: the open panels, the message log, and a webview message as if the page sent it. */
  panels(): Array<{ root: string; version: number; components: number; visible: boolean }>
  log(): GraphLogEntry[]
  receive(rootUri: string, message: unknown): Promise<void>
}

type HtmlModule = { graphHtml(graph: unknown, meta: Record<string, unknown>): string }

export function startGraphPanels(ctx: vscode.ExtensionContext, getClient: () => LanguageClient | undefined, ready: () => Promise<void>, output: vscode.LogOutputChannel): GraphPanels {
  const panels = new Map<string, Panel>() // root URI (as the server spells it) → panel
  const entries: GraphLogEntry[] = []
  const note = (e: GraphLogEntry) => { entries.push(e); if (entries.length > LOG_MAX) entries.splice(0, entries.length - LOG_MAX) }
  let htmlModule: Promise<HtmlModule> | undefined
  let lastColumn: vscode.ViewColumn = vscode.ViewColumn.One
  let followTimer: ReturnType<typeof setTimeout> | undefined

  const loadHtml = () => htmlModule ??= import(pathToFileURL(ctx.asAbsolutePath('server/sygnal-check/src/graphView/html.js')).href) as Promise<HtmlModule>

  function post(p: Panel, message: { type: string; [k: string]: unknown }) {
    const e: GraphLogEntry = { dir: 'out', root: p.rootUri, type: message.type }
    if (message.type === 'graph') Object.assign(e, { version: message.version, components: (message.graph as InspectGraph).components.length })
    if (message.type === 'reveal') e.key = message.key as string
    note(e)
    void p.panel.webview.postMessage(message)
  }

  async function request(params: Record<string, unknown>): Promise<GraphAnswer | undefined> {
    const c = getClient()
    if (!c?.isRunning()) { void vscode.window.showWarningMessage('Sygnal: the language server is not running.'); return }
    try {
      return await c.sendRequest<GraphAnswer>('sygnal/graph', params)
    } catch (err) {
      const e = err as { code?: number; message?: string }
      if (e?.code === METHOD_NOT_FOUND) {
        void vscode.window.showWarningMessage('Sygnal: the app graph needs sygnal-check 0.10.0 or later in the workspace (npm i -D sygnal-check@latest), or no workspace copy so the bundled one runs.')
      } else {
        output.error(`sygnal/graph: ${e?.message ?? err}`)
        void vscode.window.showWarningMessage(`Sygnal: no app graph: ${e?.message ?? err}`)
      }
    }
  }

  async function setHtml(p: Panel) {
    const { graphHtml } = await loadHtml()
    p.panel.webview.html = graphHtml(p.graph, pageMeta(p.root, p.rootUri, p.version, makeNonce()))
  }

  /** A newer answer: to the page when its graph differs (the page's version is the panel's own count: a restarted server counts from 1 again). */
  function update(p: Panel, a: GraphAnswer) {
    if (!a.graph || JSON.stringify(a.graph) === JSON.stringify(p.graph)) return
    p.graph = a.graph
    p.version++
    post(p, { type: 'graph', graph: a.graph, version: p.version })
  }

  async function refresh(p: Panel) {
    const c = getClient()
    if (!c?.isRunning()) return
    try {
      const a = await c.sendRequest<GraphAnswer>('sygnal/graph', { root: p.rootUri })
      if (panels.get(p.rootUri) === p) update(p, a)
    } catch (err) { output.warn(`sygnal/graph for ${p.root}: ${String((err as Error)?.message ?? err)}`) }
  }

  async function openFile(p: Panel, file: string, line: number) {
    const abs = resolveInRoot(p.root, file)
    if (!abs) { output.warn(`app graph: ignored a link outside ${p.root}: ${file}`); return }
    const pos = new vscode.Position(line - 1, columnFor(p.graph, file, line) - 1)
    await vscode.window.showTextDocument(vscode.Uri.file(abs), { viewColumn: lastColumn, selection: new vscode.Range(pos, pos), preview: false })
  }

  async function receive(rootUri: string, message: unknown) {
    const p = panels.get(rootUri)
    const m = readPageMessage(message)
    if (!p || !m) return
    note({ dir: 'in', root: rootUri, type: m.type,
      ...(m.type === 'ready' || m.type === 'applied' ? { version: m.version } : {}),
      ...(m.type === 'applied' ? { components: m.components } : {}),
      ...(m.type === 'revealed' ? { key: m.selected } : {}),
      ...(m.type === 'open' ? { file: m.file, line: m.line } : {}) })
    if (m.type === 'ready') {
      // a page made from older html: the latest graph, and the editor's component
      if (p.graph && m.version !== p.version) post(p, { type: 'graph', graph: p.graph, version: p.version })
      p.revealed = null
      follow(0)
    } else if (m.type === 'open') {
      await openFile(p, m.file, m.line)
    }
  }

  /** A panel for an answer: the existing one for its root, or a new one (or `restored`, from the serializer). */
  async function present(a: GraphAnswer, restored?: vscode.WebviewPanel): Promise<Panel | undefined> {
    const existing = panels.get(a.root)
    if (existing && !restored) {
      existing.panel.reveal(undefined, true)
      update(existing, a)
      return existing
    }
    const root = vscode.Uri.parse(a.root).fsPath
    if (!a.graph) {
      restored?.dispose()
      void vscode.window.showInformationMessage(`Sygnal: no source files to graph in ${root}.`)
      return
    }
    const options = { enableScripts: true, localResourceRoots: [] as vscode.Uri[], enableCommandUris: false }
    const panel = restored ?? vscode.window.createWebviewPanel(VIEW_TYPE, panelTitle(root), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { ...options, enableFindWidget: false, retainContextWhenHidden: false })
    if (restored) { panel.webview.options = options; panel.title = panelTitle(root) }
    const p: Panel = { rootUri: a.root, root, panel, graph: a.graph, version: 1, revealed: null, disposables: [] }
    panels.set(a.root, p)
    p.disposables.push(
      panel.webview.onDidReceiveMessage(m => { void receive(p.rootUri, m) }),
      panel.onDidDispose(() => {
        if (panels.get(p.rootUri) === p) panels.delete(p.rootUri)
        for (const d of p.disposables) d.dispose()
      }),
    )
    await setHtml(p)
    return p
  }

  async function show(target?: vscode.Uri): Promise<string | undefined> {
    await ready()
    const c = getClient()
    let params: Record<string, unknown> | undefined
    const doc = target ?? vscode.window.activeTextEditor?.document.uri
    if (doc?.scheme === 'file' && c) params = { uri: c.code2ProtocolConverter.asUri(doc) }
    else {
      const folders = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file')
      const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Show the app graph of' })
      if (!folder) return
      params = { root: c ? c.code2ProtocolConverter.asUri(folder.uri) : folder.uri.toString() }
    }
    const a = await request(params)
    if (!a) return
    const p = await present(a)
    if (p) follow(0)
    return p?.rootUri
  }

  /** Select the active editor's component in its root's panel (debounced). */
  function follow(ms = FOLLOW_MS) {
    clearTimeout(followTimer)
    followTimer = setTimeout(() => {
      const e = vscode.window.activeTextEditor
      if (!e || e.document.uri.scheme !== 'file') return
      for (const p of panels.values()) {
        const rel = relativeInRoot(p.root, e.document.uri.fsPath)
        if (!rel) continue
        const key = componentKeyAt(p.graph, rel, e.selection.active.line + 1)
        if (!key || key === p.revealed) continue
        p.revealed = key
        post(p, { type: 'reveal', key })
      }
    }, ms)
  }

  let perClient: vscode.Disposable[] = []
  const subs: vscode.Disposable[] = [
    vscode.window.onDidChangeActiveTextEditor(e => { if (e?.viewColumn) lastColumn = e.viewColumn; follow() }),
    vscode.window.onDidChangeTextEditorSelection(() => follow()),
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
        const root = (state as { root?: unknown } | undefined)?.root
        if (typeof root !== 'string') { panel.dispose(); return }
        await ready()
        const c = getClient()
        let a: GraphAnswer | undefined
        try { a = c?.isRunning() ? await c.sendRequest<GraphAnswer>('sygnal/graph', { root }) : undefined } catch { /* below */ }
        if (!a) { panel.dispose(); return }
        await present(a, panel)
      },
    }),
  ]
  if (vscode.window.activeTextEditor?.viewColumn) lastColumn = vscode.window.activeTextEditor.viewColumn

  return {
    attach(client) {
      for (const d of perClient) d.dispose()
      perClient = [
        client.onNotification('sygnal/graphChanged', (params: { root?: string }) => {
          const p = typeof params?.root === 'string' ? panels.get(params.root) : undefined
          if (p) void refresh(p)
        }),
        client.onDidChangeState(e => { if (e.newState === State.Running) for (const p of panels.values()) void refresh(p) }),
      ]
    },
    show,
    panels: () => [...panels.values()].map(p => ({ root: p.rootUri, version: p.version, components: p.graph?.components.length ?? 0, visible: p.panel.visible })),
    log: () => entries.slice(),
    receive,
    dispose() {
      clearTimeout(followTimer)
      for (const p of [...panels.values()]) p.panel.dispose()
      for (const d of [...subs, ...perClient]) d.dispose()
    },
  }
}
