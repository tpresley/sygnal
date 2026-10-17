/**
 * The app graph page as one self-contained HTML file (PLAN-10 V-1, D500): `sygnal-check --graph=html`.
 *
 *   graphHtml(graph, meta?) → string
 *     graph  an InspectGraph (static or runtime)
 *     meta   { title?, subtitle?, root? (absolute project root, for editor links), editor?
 *              ('vscode' | 'cursor' | 'windsurf' | 'idea' | 'none': the default editor link),
 *              select? (a component name or id to select on load), codes? (code → title; by
 *              default the titles from explanations.json of the codes in the graph; every title
 *              when live), live? ({ events, version }: `--graph=html --watch` (PLAN-10 W-1) adds
 *              liveHost.js, which follows that SSE stream, and `connect-src 'self'` to the CSP),
 *              host? ('vscode': the VS Code panel (PLAN-10 E-2) adds vscodeHost.js, which talks to
 *              the extension; with it `rootUri` and `version`), nonce? (the inline script runs by
 *              this nonce instead of 'unsafe-inline': a webview's CSP), appData? ({ channel }:
 *              sygnal/vite's dev route (PLAN-10 P-2) adds liveData.js, the "Live data" overlay of the
 *              open app tabs, which answer on that same-origin BroadcastChannel) }
 *
 * No build step: the files in this directory are read and concatenated at run time.
 *   - page.css goes into one <style>.
 *   - The pure modules (model.js, layout.js, mermaid.js, runtime.js, groups.js, groupLayout.js,
 *     views.js, canvas.js) and page.js are ES modules made only of
 *     top-level declarations and no imports. Each is inlined as a function body: the `export`
 *     keywords are dropped and its exports are copied onto one namespace object (`V`), so the same
 *     file runs in Node (tests, the CLI's Mermaid) and in the page. inlineModule() refuses a file
 *     that doesn't fit (an import, a default or list export, `</script` or `<!--`).
 *   - The graph and meta go into <script type="application/json"> elements, with `<`, U+2028 and
 *     U+2029 escaped (so `</script>` or `<!--` in a name or message can't end the element).
 * A Content-Security-Policy meta allows only the inline style and script: the page loads nothing
 * and can't connect anywhere (`default-src 'none'`).
 */
import fs from 'node:fs'

const read = (name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const MODULES = ['model.js', 'layout.js', 'mermaid.js', 'runtime.js', 'groups.js', 'groupLayout.js', 'views.js', 'canvas.js', 'page.js']

/** JSON safe inside a <script> element (and in JavaScript source). */
export function inlineJson(value) {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** One module's source as a function body that copies its exports onto `V`. */
export function inlineModule(source, name = 'module') {
  if (/^\s*import[\s{*'"]/m.test(source)) throw new Error(`graphView/${name}: inlined modules can't import`)
  if (/^export\s+(default\b|\{|\*)/m.test(source)) throw new Error(`graphView/${name}: only \`export function|const|let|class\` declarations can be inlined`)
  if (/<\/script|<!--/i.test(source)) throw new Error(`graphView/${name}: contains '</script' or '<!--', which would break the inline <script>`)
  const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1])
  const body = source.replace(/^export\s+/gm, '')
  return `// ── ${name} ──\n;(function (V) {\n'use strict'\n${body}\nfor (const [k, v] of Object.entries({ ${names.join(', ')} })) { if (k in V) throw new Error('graphView: ' + k + ' is exported twice'); V[k] = v }\n})(V)\n`
}

let cached = null
function assets() {
  if (cached) return cached
  const css = read('page.css')
  if (/<\/style/i.test(css)) throw new Error("graphView/page.css: contains '</style'")
  cached = {
    css,
    js: MODULES.map(m => inlineModule(read(m), m)).join('\n'),
    live: inlineModule(read('liveHost.js'), 'liveHost.js'),
    liveData: inlineModule(read('liveData.js'), 'liveData.js'),
    vscode: inlineModule(read('vscodeHost.js'), 'vscodeHost.js'),
  }
  return cached
}

/** The page's stylesheet and inlined modules ({ css, js }): the devtools panel's App graph loads them as files (devtools/build.mjs, P-1). */
export const pageAssets = () => assets()

let titles = null
function codeTitles(graph, all = false) {
  if (!titles) {
    try {
      titles = new Map(JSON.parse(fs.readFileSync(new URL('../../explanations.json', import.meta.url), 'utf8')).map(e => [e.code, e.title]))
    } catch (_) { titles = new Map() }
  }
  if (all) return Object.fromEntries([...titles].sort((a, b) => a[0] < b[0] ? -1 : 1))
  const used = new Set()
  for (const c of graph.components || []) for (const d of c.diagnostics || []) used.add(d.code)
  for (const d of graph.diagnostics || []) used.add(d.code)
  return Object.fromEntries([...used].sort().filter(c => titles.has(c)).map(c => [c, titles.get(c)]))
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'"
// live mode: the page also reads its update stream from the server it came from
const LIVE_CSP = CSP + "; connect-src 'self'"

export function graphHtml(graph, meta = {}) {
  const { css, js: pageJs, live, liveData, vscode } = assets()
  const vscodeHost = meta.host === 'vscode'
  const js = pageJs + (meta.live ? '\n' + live : '') + (meta.appData ? '\n' + liveData : '') + (vscodeHost ? '\n' + vscode : '')
  // a host that updates the graph gets every code title (later graphs may add codes)
  const m = { ...meta, title: meta.title || 'app', codes: meta.codes ?? codeTitles(graph, !!meta.live || vscodeHost) }
  if (m.root) m.root = String(m.root).replace(/\\/g, '/')
  const nonce = meta.nonce
  delete m.nonce
  if (nonce !== undefined && !/^[A-Za-z0-9+/_=-]{16,}$/.test(String(nonce))) throw new Error('graphHtml: the nonce must be 16 or more base64 characters')
  let csp = meta.live ? LIVE_CSP : CSP
  if (nonce) csp = csp.replace("script-src 'unsafe-inline'", `script-src 'nonce-${nonce}'`)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="generator" content="sygnal-check --graph=html">${meta.live ? '\n<link rel="icon" href="data:,">' : ''}
<title>${escHtml(m.title)} · Sygnal app graph</title>
<style>
${css}</style>
</head>
<body>
<header>
  <button type="button" class="iconbtn" id="side-btn" aria-controls="side" aria-expanded="false" aria-label="Components and health">☰</button>
  <div class="brand"><div class="logo" aria-hidden="true">S</div><h1 id="title" style="font-size:inherit;margin:0"></h1><small id="subtitle"></small></div>
  <div class="search" role="search">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="m11 11 4 4"/></svg>
    <input id="q" type="search" role="combobox" aria-expanded="false" aria-controls="results" aria-autocomplete="list" placeholder="Find a component, action, state key, event…" aria-label="Find a component, action, state key, event, selector or code (/)" autocomplete="off" spellcheck="false">
    <span class="count" id="qcount" aria-hidden="true"></span>
    <div class="results" id="results" role="listbox" aria-label="Search results" hidden></div>
  </div>
  <div class="spacer"></div>
  <div class="toggles" role="group" aria-label="Overlays">
    <button type="button" class="toggle" id="t-events" aria-pressed="true" title="EVENTS edges"><span class="sw" style="background:var(--ev)"></span><span class="lbl">EVENTS</span><span class="sr-only">edges</span></button>
    <button type="button" class="toggle" id="t-context" aria-pressed="true" title="Context edges"><span class="sw" style="background:var(--ctx)"></span><span class="lbl">Context</span><span class="sr-only">edges</span></button>
    <button type="button" class="toggle" id="t-parent" aria-pressed="true" title="PARENT edges (child → parent's CHILD.select)"><span class="sw" style="background:var(--par)"></span><span class="lbl">PARENT</span><span class="sr-only">edges</span></button>
    <button type="button" class="toggle" id="t-labels" aria-pressed="false" title="All edge labels"><span class="lbl">All labels</span><span class="sr-only">edge labels</span><span class="sw" style="background:var(--muted)"></span></button>
  </div>
  <div class="menu">
    <button type="button" class="iconbtn" id="menu-btn" aria-haspopup="true" aria-expanded="false" aria-controls="menu" aria-label="More">⋯</button>
    <div class="menu-pop" id="menu">
      <button type="button" id="m-svg">Download SVG</button>
      <button type="button" id="m-json">Download graph JSON</button>
      <button type="button" id="m-mermaid">Copy as Mermaid</button>
      <hr>
      <label>Open files in <select id="editor"><option value="vscode">VS Code</option><option value="cursor">Cursor</option><option value="windsurf">Windsurf</option><option value="idea">JetBrains</option><option value="none">(don't link)</option></select></label>
      <button type="button" id="m-theme">Toggle light / dark</button>
      <hr>
      <div class="keys"><kbd>/</kbd> search · <kbd>F</kbd> fit · <kbd>Esc</kbd> clear<br><kbd>Tab</kbd> to the graph, <kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> follow edges, <kbd>Enter</kbd> select</div>
    </div>
  </div>
</header>

<aside class="side" id="side" aria-label="Summary, health and components">
  <div class="sec"><div class="stats" id="stats"></div></div>
  <section class="sec" aria-labelledby="h-health"><h2 id="h-health">Health</h2><div id="health"></div></section>
  <nav class="sec" aria-labelledby="h-comps"><h2 id="h-comps">Components</h2><div id="tree"></div></nav>
</aside>

<main>
  <svg id="svg" role="group" aria-label="App graph. Tab to a component, arrow keys follow the edges, Enter selects.">
    <defs>
      <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="var(--edge)"/></marker>
      <marker id="ah-coll" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="var(--k-coll)"/></marker>
      <marker id="ah-switch" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="var(--k-switch)"/></marker>
      <marker id="ah-ev" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="var(--ev)"/></marker>
      <marker id="ah-ctx" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><circle cx="5" cy="5" r="4" fill="var(--ctx)"/></marker>
      <marker id="ah-parent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="var(--par)"/></marker>
      <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--grid)"/></pattern>
    </defs>
    <rect id="bgrect" width="100%" height="100%" fill="url(#dots)"/>
    <g id="vp"><g id="clusters"></g><g id="edges" aria-hidden="true"></g><g id="labels" aria-hidden="true"></g><g id="nodes"></g><g id="hl-layer" aria-hidden="true" pointer-events="none"></g></g>
  </svg>
  <canvas id="cv" aria-hidden="true" hidden></canvas>
  <div class="canvasbar">
    <div class="seg" role="group" aria-label="View"><button type="button" id="v-graph" aria-pressed="true">Graph</button><button type="button" id="v-events" aria-pressed="false">EVENTS table</button></div>
    <div class="fmenu"><button type="button" class="iconbtn" id="filter-btn" aria-haspopup="true" aria-expanded="false" aria-controls="filters">Filters <span class="fcount" id="filter-n"></span></button><div class="menu-pop" id="filters" role="group" aria-label="Filters"></div></div>
    <span class="tierinfo" id="tierinfo"></span>
  </div>
  <nav class="crumbs" id="crumbs" aria-label="Focus"></nav>
  <canvas id="minimap" width="400" height="272" role="img" aria-label="Minimap: the whole drawing and the part on screen" hidden></canvas>
  <section class="view" id="events-view" aria-label="EVENTS table" hidden><div class="viewbar"><b>EVENTS</b><input id="ev-q" type="search" placeholder="Filter by type or component" aria-label="Filter the EVENTS table" autocomplete="off" spellcheck="false"><span id="ev-n" class="unk"></span></div><table class="evtable" id="evtable"></table></section>
  <div class="trace" id="trace" role="status"></div>
  <div class="legend" id="legend" aria-hidden="true">
    <span><i></i>renders</span>
    <span><i style="border-top:2px dashed var(--k-coll)"></i>Collection</span>
    <span><i style="border-top:2px dotted var(--k-switch)"></i>Switchable</span>
    <span class="lg-layout" hidden><i style="border-top:2px dashed var(--k-root)"></i>Vike layout → page</span>
    <span><i style="border-color:var(--ev)"></i>EVENTS emit → select</span>
    <span><i style="border-top:2px dashed var(--ctx)"></i>context provides → reads</span>
    <span><i style="border-top:2px dashed var(--par)"></i>PARENT child → parent</span>
  </div>
  <div class="zoombar" role="group" aria-label="Zoom"><button type="button" id="zin" aria-label="Zoom in">+</button><button type="button" id="zout" aria-label="Zoom out">−</button><button type="button" id="zfit" aria-label="Fit (F)">⤢</button></div>
</main>

<aside class="detail" id="detail" aria-labelledby="dtitle" aria-hidden="true"><div class="detail-inner" id="dinner"></div></aside>
<div class="toast" id="toast" role="status"></div>
<div class="sr-only" id="status" aria-live="polite"></div>

<script type="application/json" id="graph-data">${inlineJson(graph)}</script>
<script type="application/json" id="graph-meta">${inlineJson(m)}</script>
<script${nonce ? ` nonce="${nonce}"` : ''}>
(() => {
'use strict'
const V = {}
${js}
const read = (id) => JSON.parse(document.getElementById(id).textContent), META = read('graph-meta')
const api = V.mountPage(V, read('graph-data'), META)
if (META.appData && V.mountLiveData) V.mountLiveData(V, api, read('graph-data'), META)
if (META.live && V.mountLive) V.mountLive(V, api, read('graph-data'), META)
if (META.host === 'vscode' && V.mountVscode) V.mountVscode(V, api, read('graph-data'), META)
})()
</script>
</body>
</html>
`
}
