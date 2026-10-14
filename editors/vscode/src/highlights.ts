// Highlights (0.4.0): the server's tokens for Sygnal's wiring (`sygnal/highlights`: action names,
// EVENTS types, intent selectors, the view tokens they target, selected child components) drawn as
// editor decorations. Not LSP semantic tokens: VS Code asks only one semantic token provider per
// document (the first of the highest-scored group that answers), so ours would replace
// TypeScript's semantic highlighting. The client passes `initializationOptions.semanticTokens:
// false` (the server then offers no provider) and `highlightsChanged: true`. Decorations layer over
// TypeScript's colors; theirs are theme colors (`sygnal.highlight.*` in contributes.colors) that a
// theme or `workbench.colorCustomizations` can set. `sygnal.highlights: false` is read by the
// server (empty tokens).
//
// Refresh: on the server's `sygnal/highlightsChanged` (after a check that changed the folder's
// highlights, and after the first), when an editor becomes visible, and when the client starts.
// A stale index answers null: the decorations shown stay (VS Code moves them with the edits).
import * as vscode from 'vscode'
import { State, type LanguageClient } from 'vscode-languageclient/node'

interface Token { line: number; character: number; length: number; type: string; modifiers: string[] }

const STYLES: Record<string, vscode.DecorationRenderOptions> = {
  action: { color: new vscode.ThemeColor('sygnal.highlight.action'), backgroundColor: new vscode.ThemeColor('sygnal.highlight.actionBackground'), borderRadius: '3px', fontWeight: '600' },
  actionUnhandled: { color: new vscode.ThemeColor('sygnal.highlight.action'), backgroundColor: new vscode.ThemeColor('sygnal.highlight.actionBackground'), borderRadius: '3px', textDecoration: 'underline wavy' },
  event: { color: new vscode.ThemeColor('sygnal.highlight.event'), fontStyle: 'italic' },
  selectorMissing: { color: new vscode.ThemeColor('sygnal.highlight.missing'), textDecoration: 'line-through' },
  selectorUnverified: { color: new vscode.ThemeColor('sygnal.highlight.unverified'), textDecoration: 'underline dashed' },
  selector: { color: new vscode.ThemeColor('sygnal.highlight.target'), textDecoration: 'underline dotted' },
  target: { color: new vscode.ThemeColor('sygnal.highlight.target'), backgroundColor: new vscode.ThemeColor('sygnal.highlight.targetBackground'), borderRadius: '3px' },
  child: { color: new vscode.ThemeColor('sygnal.highlight.child'), textDecoration: 'underline' },
}

const styleOf = (t: Token): string | null => {
  switch (t.type) {
    case 'sygnalAction': return t.modifiers.includes('unhandled') ? 'actionUnhandled' : 'action'
    case 'sygnalEvent': return 'event'
    case 'sygnalSelector': return t.modifiers.includes('untargeted') ? 'selectorMissing' : t.modifiers.includes('unverified') ? 'selectorUnverified' : 'selector'
    case 'sygnalTarget': return 'target'
    case 'sygnalChild': return 'child'
  }
  return null
}

export interface Highlights extends vscode.Disposable {
  /** Wire a new client (each server start): its notification, and a refresh once it runs. */
  attach(client: LanguageClient): void
}

export function startHighlights(getClient: () => LanguageClient | undefined): Highlights {
  const types = new Map(Object.entries(STYLES).map(([k, v]) => [k, vscode.window.createTextEditorDecorationType({ ...v, rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed })]))
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  async function refresh(editor: vscode.TextEditor) {
    const c = getClient()
    if (!c?.isRunning()) return
    const version = editor.document.version
    let tokens: Token[] | null
    try {
      tokens = await c.sendRequest<Token[] | null>('sygnal/highlights', { textDocument: { uri: editor.document.uri.toString() } })
    } catch { return }
    if (!tokens || editor.document.version !== version) return // stale: keep what is shown
    const byStyle = new Map<string, vscode.Range[]>([...types.keys()].map(k => [k, []]))
    for (const t of tokens) {
      const s = styleOf(t)
      if (s) byStyle.get(s)!.push(new vscode.Range(t.line, t.character, t.line, t.character + t.length))
    }
    for (const [k, t] of types) editor.setDecorations(t, byStyle.get(k)!)
  }

  const schedule = (uri: vscode.Uri, ms = 50) => {
    const key = uri.toString()
    clearTimeout(timers.get(key))
    timers.set(key, setTimeout(() => {
      timers.delete(key)
      for (const e of vscode.window.visibleTextEditors) if (e.document.uri.toString() === key) void refresh(e)
    }, ms))
  }

  const all = () => { for (const e of vscode.window.visibleTextEditors) schedule(e.document.uri) }
  const subs = [
    vscode.window.onDidChangeVisibleTextEditors(es => { for (const e of es) schedule(e.document.uri) }),
  ]
  let perClient: vscode.Disposable[] = []
  return {
    attach(client) {
      for (const d of perClient) d.dispose()
      perClient = [
        client.onNotification('sygnal/highlightsChanged', all),
        client.onDidChangeState(e => { if (e.newState === State.Running) all() }),
      ]
    },
    dispose() {
      for (const d of [...subs, ...perClient]) d.dispose()
      for (const t of types.values()) t.dispose()
      for (const t of timers.values()) clearTimeout(t)
    },
  }
}
