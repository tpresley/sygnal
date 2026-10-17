# Spike: an interactive HTML view of the sygnal-check app graph

Question: can `sygnal-check` turn the app graph (`--graph`) into a good-looking, interactive web page
that opens in the default browser? What should it show to be useful?

**Plan:** the user accepted the recommendations on 2026-10-16; the work is [PLAN-10](../../PLAN-10.md).

Answer: yes. The prototype here works on every example app with **no change to graph.js and no new
dependency**. The spike also found data gaps that make the picture wrong in places (see *Data gaps*).
Fix those before or with the feature.

## Files

| File | What it is |
|---|---|
| `template.html` | The page: vanilla JS + inline SVG, its own layout code, light/dark theme. 64 KB (19 KB gzipped), no CDN, works offline |
| `render.mjs` | Prototype CLI: runs `graph()`, inlines the JSON into the template, writes the file, `--open` opens it |
| `fixture/src/` | A small shop app with planted bugs (unreachable model entries, selectors not in the view, an unselected event, a Switchable child with its own `initialState`, an agent tool whose schema is a plain object) |
| `out/*.html` | Generated pages: fixture, kanban, getting-started, plan5-showcase (43 components), ai-showcase (31) |

```bash
node dev-plans/research/graph-viz/render.mjs examples/kanban/src --open
```

## What the prototype does

- **Canvas**: components as cards (name, `file:line`, counts of actions, state keys and events, an AI
  badge, a diagnostics pill). Edges show what renders what (plain, Collection `[from]`, Switchable),
  EVENTS emit → select (purple), and context provider → reader (cyan, resolved to the nearest
  ancestor that provides the field). Pan, zoom, fit.
- **Layout**: a hand-written layered layout (longest path, barycenter ordering) for each connected tree,
  with trees grouped into boxes by directory. This handles showcase apps with many roots. It is
  readable up to about 50 components. Past about 150, it would need ELK or collapsible clusters.
- **Health sidebar**: diagnostics grouped by code (titles from `explanations.json`), plus checks only the
  whole graph shows: context read with no provider, events nobody emits or selects (when no SYG105),
  rendered components that weren't scanned, and the **AI agent surface** (which components expose tools
  and which tools ask the user first). Clicking an item selects the component and pans to it.
- **Detail panel**: the component's diagnostics (with fix and docs link), its parents and children,
  actions as *trigger → name → sinks* (behavior actions such as `chat.*` collapsed under the behavior),
  state, calculated fields, context, EVENTS, DOM inputs with ✓/✗/?, ELEMENT commands, timers, uses,
  and the agent tools. Each file link opens the editor (`vscode://`, `cursor://`, `windsurf://`, `idea://`).
- **Trace**: click an event, a context field, an action or a state key, and everything involved lights up.
- **Search** across component names, actions, state keys, events, selectors and codes (`/` to focus).
- **Export**: SVG, graph JSON, Copy as Mermaid.

## Data gaps found (graph.js)

1. **View-only components are missing.** Only functions with statics become nodes. In plan5-showcase,
   10 rendered components (`Greeting`, `Total`, `Score` in `Scoreboard.jsx`; `Home`, `TaskPage`, … in
   `Tasks.jsx`) are not in the graph. In the fixture, `Shop` is missing, so `ProductCard` shows up as
   a root and the tree is cut in two. The prototype draws these as dashed "not scanned" nodes, but the
   graph should emit them (for example `viewOnly: true`).
2. **Package components aren't labelled.** `Toaster` from `sygnal/ui` looks the same as a missing file.
   Add `external: 'sygnal/ui'`.
3. **Links use names, not ids.** `children`, `events.emitters` and `events.selectors` hold names.
   ai-showcase has eight components called `Chat`, so the page has to guess by path. Add the target `id`.
4. **Only components have line numbers.** Actions, model entries, selectors and child usages have none,
   so click-to-code only reaches the component. Add `line` to them. This also helps the LSP and MCP.
5. **`PARENT` has no receiver.** `TaskCard` sends `DELETE → PARENT`, but the parent's
   `CHILD.select(TaskCard)` link isn't recorded, so the arrow can't be drawn.
6. **The app entry isn't marked.** Components passed to `run()` aren't flagged, so showcases look like
   30 separate roots. Marking entries would let the page put the real app first.
7. (Nice to have) **Which state keys an action writes.** For `{ ...state, cart }` reducers this is
   statically knowable. It would answer "who writes `state.cart`?", the most common question when
   reading an unfamiliar Sygnal app.

## Recommendations

1. **Ship `sygnal-check --graph=html`** (alias `--viz`): write the page to the OS temp dir and open it.
   Add `--out <file>` (writes without opening unless `--open` is also given). Never open when `CI` is
   set or stdout is not a TTY. Keep the template as a plain file in `sygnal-check/src/`. No build step,
   and `@babel/parser` stays the only dependency. Tests: the inlining (`</script>` in data), and one
   headless smoke test in `browser-tests/`.
2. **Fix gaps 1–4 first.** They make the picture correct, and `--graph`, MCP `graph` and the LSP
   benefit too.
3. **Then make it live, which matters more than the HTML itself.** A static file goes stale after the
   next edit. `--graph=html --watch` serves the page (`node:http` + SSE), reuses the LSP's incremental
   project, and pushes a new graph on save while keeping zoom and selection. This is what turns it from
   a one-off report into something people keep open.
4. **Use the renderer in more places**, since it only consumes the InspectGraph JSON:
   - VS Code: a *Sygnal: Show App Graph* webview. Clicking goes to code natively and it updates on save.
     This is probably where people would use it most.
   - Devtools panel: feed it runtime `inspect()` (same schema, `source: 'runtime'`) and overlay live
     state values, action counts, and a flash when an action fires.
5. **Add `--graph=mermaid`** for READMEs and PR descriptions (GitHub renders it). The prototype already
   has Copy as Mermaid, so this costs little.
6. Later: **`--graph=html --base <ref>`** to colour components, actions and events added or removed
   on a branch, as a review aid.

Not recommended: loading a graph library from a CDN (breaks offline use, and some setups block it with
a CSP), or bundling React Flow / Cytoscape into sygnal-check
(D209: no bundled third-party code; adds hundreds of KB for a layout the hand-written one already
handles at real app sizes).
