/**
 * The VS Code host adapter (PLAN-10 E-2, D503): what the page gets inside the VS Code extension's
 * webview panel ("Sygnal: Show App Graph"). html.js inlines it only when `meta.host === 'vscode'`
 * (see model.js for the inlining rules: top-level `export` declarations, no imports).
 *
 *   linkTarget(href, root) → { file, line } | null     (pure, tested in Node)
 *     The page's editor links are `vscode://file/<abs>:<line>` (page.js editorHref with the editor
 *     'vscode'). In the panel a click on one becomes a message: `file` relative to `root` (the
 *     absolute project root, '/'-separated, as META.root), never a path outside it.
 *   themeOf(bodyClasses) → 'light' | 'dark'           VS Code's body classes (vscode-light, …)
 *   VSCODE_CSS                                         the page's tokens as VS Code theme variables
 *   mountVscode(V, api, graph, META)
 *     api    mountPage()'s API (setGraph keeps the view, selection, trace and search by key;
 *            setView restores a saved view)
 *     META   { root, rootUri, version, host: 'vscode' }
 *
 * Messages (webview → extension, through acquireVsCodeApi().postMessage):
 *   { type: 'ready', version }                     once mounted (the page may hold an old graph:
 *                                                  the panel's html is set once, and VS Code
 *                                                  re-creates the page from it after hiding it)
 *   { type: 'open', file, line }                   an editor link was clicked
 *   { type: 'applied', version, components }       a graph message was applied (or was current)
 *   { type: 'revealed', key, selected }            after a reveal message
 * Messages (extension → webview, window 'message' events):
 *   { type: 'graph', graph, version }              a newer graph: setGraph() when the version differs
 *   { type: 'reveal', key }                        select the component with that key (follow the
 *                                                  active editor); nothing when it isn't in the graph
 *
 * State: the selection (by key), the view and the search text go to the webview state
 * (setState) after each interaction, debounced, and come back when VS Code re-creates the page
 * (the panel doesn't keep its context while hidden) or restores it after a restart; `rootUri`
 * goes with them, for the extension's panel serializer.
 *
 * Theme: the page's surface and text tokens map to VS Code's theme variables (VSCODE_CSS); its
 * own light or dark set follows VS Code's theme kind for the rest (kinds, sinks, overlays), and
 * the page's light / dark toggle, editor choice and downloads (which a webview can't save) are
 * hidden.
 */

const LINK_PREFIX = 'vscode://file'

export function linkTarget(href, root) {
  if (typeof href !== 'string' || !href.startsWith(LINK_PREFIX) || typeof root !== 'string' || !root) return null
  let rest
  try { rest = decodeURI(href.slice(LINK_PREFIX.length)) } catch (_) { return null }
  const m = /^(.*):(\d+)$/.exec(rest)
  if (!m) return null
  let abs = m[1]
  if (/^\/[A-Za-z]:\//.test(abs)) abs = abs.slice(1) // vscode://file/C:/x → C:/x
  const base = root.replace(/\\/g, '/').replace(/\/?$/, '/')
  if (!abs.startsWith(base)) return null
  const file = abs.slice(base.length)
  if (!file || file.split('/').includes('..')) return null
  return { file, line: Math.max(1, Number(m[2])) }
}

export function themeOf(bodyClasses) {
  const list = Array.from(bodyClasses || [])
  return list.includes('vscode-light') || list.includes('vscode-high-contrast-light') ? 'light' : 'dark'
}

// (the page's own value stays for the tokens VS Code has nothing for: kinds, sinks, overlays, grid)
export const VSCODE_CSS = `
:root[data-host="vscode"] {
  --bg: var(--vscode-editor-background);
  --panel: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --card: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  --ink: var(--vscode-editor-foreground, var(--vscode-foreground));
  --muted: var(--vscode-descriptionForeground);
  --line: var(--vscode-panel-border, var(--vscode-widget-border, var(--vscode-editorGroup-border)));
  --accent: var(--vscode-textLink-foreground);
  --accent-soft: var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-selectionBackground));
  --err: var(--vscode-errorForeground);
  --warn: var(--vscode-editorWarning-foreground);
  --info: var(--vscode-editorInfo-foreground);
  --err-soft: var(--vscode-inputValidation-errorBackground, transparent);
  --warn-soft: var(--vscode-inputValidation-warningBackground, transparent);
  --chip: var(--vscode-textBlockQuote-background, var(--vscode-editorWidget-background));
}
:root[data-host="vscode"] body { font-family: var(--vscode-font-family); }
:root[data-host="vscode"] code, :root[data-host="vscode"] .mono { font-family: var(--vscode-editor-font-family); }
:root[data-host="vscode"] :focus-visible { outline-color: var(--vscode-focusBorder); }
:root[data-host="vscode"] .search input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-color: var(--vscode-input-border, var(--line)); }
`

export function mountVscode(V, api, graph, META) {
  const doc = document
  // eslint-disable-next-line no-undef
  const host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null
  if (!host) return null
  const root = doc.documentElement
  root.dataset.host = 'vscode'
  const style = doc.createElement('style')
  style.textContent = VSCODE_CSS
  doc.head.appendChild(style)
  const setTheme = () => { root.dataset.theme = themeOf(doc.body.classList) }
  setTheme()
  new MutationObserver(setTheme).observe(doc.body, { attributes: true, attributeFilter: ['class'] })

  // what a webview can't do, or the panel does itself: the theme toggle, downloads, the editor choice
  for (const id of ['m-theme', 'm-svg', 'm-json']) { const b = doc.getElementById(id); if (b) b.hidden = true }
  const editor = doc.getElementById('editor')
  if (editor) { editor.value = 'vscode'; const label = editor.closest('label'); if (label) label.hidden = true }

  // editor links → the extension opens the file (capture: before the page and VS Code's own link handling)
  doc.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null
    if (!a) return
    const t = V.linkTarget(a.getAttribute('href'), META.root)
    if (!t) return
    e.preventDefault()
    e.stopPropagation()
    host.postMessage({ type: 'open', file: t.file, line: t.line })
  }, true)

  let version = META.version ?? null
  const q = doc.getElementById('q')
  function save() {
    host.setState({ root: META.rootUri, version, selected: api.selectedKey, view: api.view, query: q ? q.value : '' })
  }
  let saveTimer = 0
  const later = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 150) }
  for (const ev of ['click', 'keyup', 'wheel', 'pointerup', 'input']) doc.addEventListener(ev, later, { passive: true })

  // restore what the last page showed (same root)
  const saved = host.getState()
  if (saved && saved.root === META.rootUri) {
    const id = saved.selected != null ? api.model.byKey.get(saved.selected) : null
    if (id != null) api.select(id, { keepView: true })
    if (q && saved.query) { q.value = saved.query; q.dispatchEvent(new Event('input')) }
    if (saved.view) api.setView(saved.view)
  }

  addEventListener('message', (e) => {
    const m = e.data
    if (!m || typeof m !== 'object') return
    if (m.type === 'graph' && m.graph && Array.isArray(m.graph.components)) {
      if (m.version !== version) { api.setGraph(m.graph); version = m.version; later() }
      host.postMessage({ type: 'applied', version, components: api.model.comps.length })
    } else if (m.type === 'reveal' && typeof m.key === 'string') {
      const id = api.model.byKey.get(m.key)
      if (id != null && api.selectedKey !== m.key) { api.select(id, { pan: true }); later() }
      host.postMessage({ type: 'revealed', key: m.key, selected: api.selectedKey })
    }
  })
  host.postMessage({ type: 'ready', version })
  const handle = { get version() { return version }, save }
  window.__sygnalVscode = handle
  return handle
}
