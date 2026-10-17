# PLAN-10: An interactive view of the app graph (`sygnal-check --graph=html`)

**Goal:**
- Show a Sygnal app's structure as an interactive page: components, what renders what, EVENTS,
  context, actions, state, DOM inputs, the AI agent surface and the diagnostics, with click-to-code.
- Make the graph data complete enough that the picture is right: view-only and package components,
  ids on every link, source lines, `PARENT` receivers, entries, and the state keys actions write.
- One renderer, several hosts:
  - the CLI page (`--graph=html`), a self-contained file opened in the default browser;
  - a live page that updates on save (`--watch`);
  - a VS Code panel;
  - the devtools panel, fed by the runtime `inspect()` with live state.
- Stay usable on large apps. Phase 0 researches how (collapsing, grouping, other views) before the
  viewer is built for it.

**Release:**
- **sygnal-check minor** (0.10.0) for the data fixes, `--graph=html`, `--graph=mermaid`; another
  minor for `--watch` and `--base` if they land later.
- **VS Code extension minor** for the panel.
- **sygnal minor** only if the runtime `inspect()` gains fields or the devtools panel changes
  (P10-Q6). Core bytes: 0.

**Status:**
- Research done (2026-10-16): the spike in
  [`research/graph-viz/`](research/graph-viz/README.md) built a working page from the unchanged
  graph and found the data gaps listed in §1.1. The user accepted all of its recommendations on
  2026-10-16 (D500–D507) and asked for research into large apps (S-1).
- Questions answered 2026-10-16 (D508–D514); Phase 0 started 2026-10-16. Tracker: [`PLAN-10-status.md`](PLAN-10-status.md).

**Branches:**
- integration: `plan10-integration`, cut from `main`;
- subagent branches: `p10-*`;
- spikes: `exp/p10-*`.

**IDs:**
- items S- (spikes and research), A- (graph data), V- (the viewer), C- (CLI), W- (live mode),
  E- (editor), P- (devtools panel), X- (diagnostics), T- (testing), D- (docs);
- questions P10-Q1…;
- decisions and gaps use a **reserved block, D500–D549 and G-800–G-849**. The global sequence ended
  at D319 / G-666 (PLAN-7); PLAN-8 holds D400–D449 / G-700–G-749 and PLAN-9 D450–D499 / G-750–G-799.

**Inputs** (subagents read the relevant ones before an item):
- [`research/graph-viz/README.md`](research/graph-viz/README.md): what the spike built and found.
- `research/graph-viz/template.html`: the page (model building, layered layout, health list, detail
  panel, trace, search, export). V-1 starts from it.
- `research/graph-viz/render.mjs`: the prototype CLI; `research/graph-viz/fixture/src/`: the shop
  fixture with planted bugs; `research/graph-viz/out/`: pages for 5 apps.
- Existing code:
  - `sygnal-check/src/graph.js` (`buildGraph`, the InspectGraph serializer), `graphText.js`,
    `schema/inspect.schema.json`, `model/project.js` (`sources`, `componentForFunction`),
    `model/view.js` (child usages), `model/intent.js` (`CHILD.select`), `cache.js`;
  - `sygnal-check/src/lsp/` (the server's incremental project and watchers), `src/mcp.js`
    (the `graph` tool);
  - `src/extra/diagnostics/checks/inspect.ts` (runtime `inspect()`), `devtools/panel.js`
    (`_renderGraph`, the per-component MVI view), `src/extra/devtools.ts`;
  - `src/vite/plugin.ts` (already runs sygnal-check in dev);
  - `editors/vscode/src/extension.ts`.

**Invariants:**
- **One graph format.** Every host renders InspectGraph JSON (`source: 'static'` or `'runtime'`).
  New fields are additive at `version: 1` unless P10-Q4 decides otherwise.
- **The page is one self-contained file**: no CDN, no network, no server needed to view it. It works
  offline and from `file://`.
- **No new runtime dependencies in sygnal-check** (D209; `@babel/parser` stays the only one) unless
  the user approves one on S-1's numbers.
- **The page never runs app code** and never shows source text beyond names, selectors, messages
  and paths already in the graph.
- **Live mode listens on loopback only**, behind a random token, and serves only the page and its
  update stream.
- **0 bytes** for apps: nothing here ships in `sygnal`'s app bundles. Devtools code stays in the
  dev entries.
- **Everything the page computes from the graph is testable in Node** (model, layout, health,
  Mermaid); the DOM layer stays thin.

**Words:**
- "the graph": InspectGraph JSON;
- "the page": the generated HTML viewer;
- "a host": where the page runs (a browser tab, the VS Code webview, the devtools panel);
- "an island": a set of components connected by render edges;
- "a cluster": islands grouped by directory (or by the S-1 grouping);
- "an overlay": the EVENTS, context and `PARENT` edges drawn over the render tree;
- "the health list": diagnostics grouped by code, plus the checks only the whole graph shows.

---

## 0. Decisions already made (2026-10-16)

| # | Decision |
|---|---|
| D500 | **Build the view into sygnal-check as `--graph=html`**: one self-contained page written to the temp dir and opened in the default browser; `--out <file>` writes without opening unless `--open` is given; never open when `CI` is set or stdout is not a TTY (user, accepting the spike) |
| D501 | **Fix the graph data gaps first** (A-1…A-6), before the viewer ships; they also improve `--graph`, MCP `graph` and the LSP (user, accepting the spike) |
| D502 | **Live mode**: `--graph=html --watch` serves the page and pushes a new graph on save, keeping zoom and selection (user, accepting the spike) |
| D503 | **One renderer, several hosts**: the CLI page, a VS Code panel, and the devtools panel on the runtime `inspect()` (user, accepting the spike) |
| D504 | **`--graph=mermaid`** for READMEs and PR descriptions, from the same code as the page's Copy as Mermaid (user, accepting the spike) |
| D505 | **`--graph=html --base <ref>`**: colour what a branch added, removed or changed (user, accepting the spike; a later phase) |
| D506 | **No graph library from a CDN, and no bundled React Flow / Cytoscape** (D209). A lazily loaded optional dependency (e.g. ELK) only with the user's approval on S-1's numbers (user, accepting the spike) |
| D507 | **Research large-app strategies before building them** (S-1: collapsing and grouping hierarchies, focus views, other layouts); the user decides on the results (user, 2026-10-16) |
| D508 | **P10-Q1**: `--graph=html` / `--graph=mermaid` only, no `--viz` (user, 2026-10-16) |
| D509 | **P10-Q2**: the OS temp dir, path printed; `--out` to keep a file (user, 2026-10-16) |
| D510 | **P10-Q3**: no new `llms.txt` line; the skill mentions the page (user, 2026-10-16) |
| D511 | **P10-Q4**: new fields additive at `version: 1`, all optional (user, 2026-10-16) |
| D512 | **P10-Q5**: graph-wide checks become rules (SYG170–179) only when measured clean on the examples and docs samples (user, 2026-10-16) |
| D513 | **P10-Q6**: sygnal-check 0.10.0 after Phase 1; live mode, VS Code panel and devtools tab in later minors; sygnal only if `inspect()` or devtools change (user, 2026-10-16) |
| D514 | **P10-Q7**: no large real app supplied: S-1 uses the synthetic corpus and all examples together (user, 2026-10-16) |

## 1. Scope

### 1.0 Spikes and research (S), Phase 0

**S-1 Large apps** (D507; the main research item)
- **Question:** what keeps the page readable and fast at 200, 500 and 2,000 components, and with
  hundreds of event types? The spike's layout is readable to about 50 components.
- **Corpora:**
  - a synthetic generator (`research/graph-viz/large/gen.mjs`): N components with realistic
    depth and fan-out, Collections and Switchables, view-only leaves, EVENTS between distant
    components, context providers, duplicate names in different directories, and diagnostics;
    seeded, so runs repeat;
  - all `examples/` scanned together (one real, many-rooted graph);
  - any larger Sygnal app the user can point to (P10-Q7).
- **Strategies to try**, each as a switch in one experimental page so they can be compared:
  1. **Collapsible subtrees**: a node folds its descendants into a `+N` badge; auto-fold below a
     depth or above a node count; the overlays re-route to the folded node with counts.
  2. **Collapsible clusters**: directory (or feature) groups fold to one summary card with
     aggregated counts; edges between folded groups bundle into one edge with a count. Compare
     grouping by directory, by entry (each `run()` root's tree), and by detected communities
     (EVENTS and render edges together).
  3. **Focus mode**: show only the selected component's ancestors up to the entry, its children
     to depth 1–2, and its EVENTS / context / `PARENT` peers, with breadcrumbs; everything else
     hidden or faded.
  4. **Semantic zoom**: at low zoom, clusters render as labelled blobs with counts and cards
     disappear; cards and labels appear as you zoom in.
  5. **Bus nodes for EVENTS**: one node per event type (emitters → type → selectors) instead of
     every emitter × selector pair; compare edge counts and readability.
  6. **Views that are not node-link diagrams**: an outline tree (file-explorer style) beside the
     detail panel; an icicle or treemap sized by actions or state keys; an emitter × event × selector
     matrix for the EVENTS bus; a Sankey for event flow.
  7. **Filters**: by directory, kind, "only problems", "hide view-only leaves", "hide behavior
     actions", "AI surface only".
  8. **Layout engines**: the spike's own layered layout, `d3-hierarchy` tidy tree (small), dagre and
     ELK (layered, with compound nodes); run in a Web Worker for the big ones. Measure layout time,
     edge crossings, total area, and bytes added to the page.
  9. **Rendering**: SVG against canvas at 500 / 2,000 nodes (frame time while panning and
     zooming); a minimap.
  10. **Layout stability** (needed by W-1): how much nodes move when one component is added; pinned
      positions; animating the change.
- **Measure** for each strategy and size: time to first paint, frame time on pan/zoom, page size,
  edge crossings, and a task check: how long to answer five fixed questions ("who handles
  `NAVIGATE`?", "where does `Checkout` get `currency`?", "which components can an agent change?",
  "what renders `CartLine`?", "which components have errors?") by a person, and by an agent
  driving the page through the browser tools.
- **Output:** `research/graph-viz/large-apps.md` with the numbers, screenshots, and a recommended
  default set (for example: clusters folded above N, focus mode on select, bus nodes for EVENTS,
  the outline view always available). The user decides; it becomes a D-number, and V-4 builds it.

**S-2 Runtime graphs in the renderer** (D503)
- Load a runtime `inspect()` graph (`source: 'runtime'`, instances with `parentId`) into the
  spike's page. Note what differs from the static graph: many instances per component, real
  `parentId`s, state values, recent actions.
- **Output:** the mapping (instances grouped `×N` under one card, or one card per instance) and the
  fields the page needs from `inspect()`, recorded in the tracker. Feeds P-1 and A-8.

**S-3 Live transport** (D502; design only)
- The update path for `--watch`: `fs.watch` (recursive on macOS, Windows and Linux with Node ≥ 20)
  against the LSP's watcher code; reuse of `cache.js` and the LSP's incremental project; debounce;
  how the page applies a new graph without a reload (diff by id, keep positions, animate).
- Also: whether `sygnal/vite` should serve the same page at a dev route (`/__sygnal/graph`), since
  it already runs sygnal-check in dev, and what that adds (the runtime overlay on the same origin).
- **Output:** the W-1 / W-2 design in the tracker.

### 1.1 Graph data (A), Phase 1 (D501)

Each item adds fields to `graph.js` and `schema/inspect.schema.json`, shows them in
`graphText.js`, and gets a fixture test (T-3).

**A-1 View-only components** (P1)
- A function rendered as a component tag but with no statics is not a node today. Emit it:
  `viewOnly: true`, with the same `kind` rules as other components.
- Spike evidence: plan5-showcase has 10 rendered components missing (`Greeting`, `Total`, `Score`
  in `Scoreboard.jsx`; `Home`, `TaskPage`, … in `Tasks.jsx`); in the fixture, `Shop` is missing, so
  `ProductCard` shows as a root.
- Include the child usage's `state` lens when it's a literal (`<Greeting state="host" />`).

**A-2 Package components** (P1)
- A component tag imported from a package (`Toaster` from `sygnal/ui`, a `fromReact` /
  `defineWidget` tag) becomes a node with `external: '<specifier>'` (or a field on the child entry;
  decided in Phase 0 as a D-number), so the page can tell it apart from a file outside the scanned
  paths.
- Widgets: mark `widget: true` (PLAN-5 W-1) where the definition is visible.

**A-3 Ids on links** (P1)
- `children[]` entries get the target's `id`; `events[type].emitters` / `.selectors` get parallel
  id lists (names stay for compatibility); diagnostics get the component `id`.
- Resolution uses the import the usage actually refers to (`componentForFunction`), not the name.
  Spike evidence: ai-showcase has eight components called `Chat`.

**A-4 Source locations** (P1)
- `line` / `column` on: intent actions (the property), model entries, selectors, child usages,
  EVENTS emit and select sites, context entries, controls, commands, timers, agent actions.
- Lets the page, the LSP and MCP clients jump to the exact place, not just the component.

**A-5 `PARENT` receivers** (P1)
- Record each `CHILD.select(Child)` in an intent: `childSelects: [{ child, id, actions, line }]`
  (the parent's intent actions it feeds). With the child's `PARENT` sinks, the page can draw
  child → parent edges. The model already knows `CHILD.select` for the grandchild rule (SYG for
  "selects a component it doesn't render").

**A-6 Entries** (P1)
- `entry: true` on components passed to `run()`, `mount` / `hydrate`, `defineElement`, and the Vike
  and Astro page conventions the checker already recognises; `entry: 'unknown'` handling for
  showcase-style apps that pick a component at run time.
- Lets the page put the real app first and treat other roots as secondary.

**A-7 State writes and reads** (P2)
- Per action, `writes: ['cart']` when the reducer is analyzable (object spread with literal keys,
  the `set` / `toggle` reducers, behaviors with known slices), else `null`.
- Per component, `stateReads` from the view where the access is literal (`state.cart.length`).
- Answers "who writes `state.cart`?" and "who shows it?".

**A-8 Schema, text, MCP and runtime parity** (P1)
- `inspect.schema.json` and the TypeScript `InspectGraph` type get every new field.
- `graphText.js` shows view-only and external components, `PARENT` links and entries.
- The MCP `graph` tool description lists the new fields.
- A trigger kind `behavior` for behavior actions dispatched inside the behavior (today
  `unknown`, which the spike showed as "never").
- The runtime `inspect()` fills the same fields where it can cheaply (ids on links, entry,
  `viewOnly`), per S-2.

### 1.2 The viewer (V)

**V-1 The renderer module** (P1)
- `sygnal-check/src/graphView/`: `model.js` (resolve, edges, health), `layout.js`, `mermaid.js`
  (pure, Node-testable), `page.css`, `page.js` (the DOM layer), and `html.js`, which inlines them
  with the graph into one file. Start from the spike's `template.html`.
- Inlining escapes `<`, U+2028 and U+2029 in the data (T-1).
- No build step: the files are read and concatenated at run time.

**V-2 Use the new data** (P1, after A-1…A-6)
- View-only components as lighter cards; external components with their package; ghost cards only
  for names that really don't resolve.
- `PARENT` edges as a third overlay; line-level links in the detail panel; entries first in the
  layout and the component list.
- Health list: drop the derived checks the diagnostics already cover (the spike's dedupe), keep
  "context read with no provider", "rendered but not scanned" and the AI surface.

**V-3 Runtime graphs** (P2, after S-2)
- Render `source: 'runtime'` graphs: instances grouped `×N`, the live `parentId` tree, state values
  in the detail panel. Used by P-1.

**V-4 Large-app strategies** (P1–P2, after S-1's decision)
- Build the strategies the user picks from S-1, with defaults chosen by graph size.

**V-5 Accessibility and polish** (P1)
- Keyboard: Tab to the canvas, arrow keys move along edges, Enter selects, `/` search, `F` fit,
  Esc clears; the outline list is the screen-reader view.
- `prefers-reduced-motion`; contrast checked in both themes; the layout works at 900 px wide.
- Editor link choice remembered (`vscode`, `cursor`, `windsurf`, `idea`, none), with
  `--editor <name>` to set the default.

**V-6 Diff rendering** (P3, for C-4)
- Added, removed and changed components, actions, events and edges coloured; a "changes only"
  filter.

### 1.3 CLI (C)

**C-1 `--graph=html`** (P1, D500)
- `--graph` keeps printing text; `--graph --json` keeps JSON. `--graph=html|mermaid|json|text`
  selects a format.
- `--graph=html` writes `<tmpdir>/sygnal-graph-<project>.html`, prints the path, and opens it
  (`open` / `xdg-open` / `start`). `--out <file>` writes there without opening unless `--open`.
  No opening when `CI` is set, stdout is not a TTY, or `--no-open` is given.
- Title from `package.json` `name`; the project root embedded for editor links.
- `--strict`, `--a11y`, the config file and `ignore` apply as for `--graph`.

**C-2 `--graph=mermaid`** (P1, D504)
- `flowchart TD` with render edges (Collection / Switchable labelled) and EVENTS edges dotted;
  `--events=false` to leave them out. Same code as the page's Copy as Mermaid (V-1 `mermaid.js`).

**C-3 `--base <ref>`** (P3, D505)
- Build the base graph from `git show <ref>:<path>` through `buildProject`'s `sources` map (no
  checkout), match components by file and name (ids contain line numbers), and render with V-6.
  Also `--graph --json --base` prints the diff as JSON for CI comments.

### 1.4 Live mode (W), after S-3

**W-1 `--graph=html --watch`** (P2, D502)
- A `node:http` server on 127.0.0.1, a random port and a random token in the URL; the page plus an
  SSE stream; recheck on change (debounced, incremental through `cache.js`); the page applies the
  new graph in place, keeping zoom, selection and positions (S-1 item 10), and marks what changed.
- Exits on Ctrl-C; prints the URL; opens it once.

**W-2 The `sygnal/vite` dev route** (P3, if S-3 recommends it)
- Serve the live page at `/__sygnal/graph` from the dev server (the plugin already runs
  sygnal-check), so a Vite user gets it without a second process, on the same origin as the app
  (which P-2 can use).

### 1.5 Editor (E)

**E-1 LSP `sygnal/graph`** (P2)
- A custom request returning the graph for a root from the server's incremental project, and a
  notification when it changes. Reuses the worker thread.

**E-2 VS Code: "Sygnal: Show App Graph"** (P2, D503)
- A webview panel with the V-1 page (CSP with a nonce, no remote content). Links go through
  `postMessage` to `vscode.window.showTextDocument`, not `vscode://` URLs. Updates on E-1's
  notification. Follows the active editor: the component under the cursor is selected. Colours
  from the VS Code theme variables.
- The extension bundles sygnal-check already, so no new dependency.

### 1.6 Devtools panel (P)

**P-1 An app graph tab** (P2, after S-2 and V-3)
- In `devtools/panel.js`, an app-level Graph view using the V-1 renderer on the runtime
  `inspect()`: instances `×N`, live state in the detail panel, a flash on a node when one of its
  actions runs (devtools already records actions), mounted / unmounted.
- The existing per-component MVI tab stays.

**P-2 Static + runtime together** (P3, if W-2 ships)
- With the dev route on the same origin, overlay runtime data on the static graph: components not
  mounted shown faded, action counts on the static cards.

### 1.7 Diagnostics (X)

**X-1 Graph-wide checks as rules** (P2, if P10-Q5 says yes)
- Candidates from the health list, as sygnal-check rules (and so in the LSP):
  - a context field read with no ancestor providing it (SYG170);
  - a child sending `PARENT` that no parent `CHILD.select`s (SYG171);
  - a component reachable from no entry (SYG172, info).
- Each is measured on the examples and the docs samples first: a rule ships only with no false
  positives there. Providers or parents outside the scanned paths make a finding `info`.

### 1.8 Testing (T)

**T-1 Unit tests** (`sygnal-check/test/*.vtest.js`)
- `model.js`: name resolution, ghost nodes, event pairs, context provider lookup, health dedupe.
- `layout.js`: no overlapping cards, deterministic output, islands and clusters.
- `html.js`: the inlining escapes (`</script>`, `<!--`, U+2028); `mermaid.js` snapshots.
- CLI: `--out`, `--open`, `--no-open`, no opening under `CI` (the opener injected and asserted).

**T-2 Browser smoke** (`browser-tests/`)
- Load the generated page for the shop fixture: N cards rendered, select a card, search, trace an
  event, toggle overlays, no console errors. Chromium in `npm test`; Firefox and WebKit opt-in.

**T-3 Graph data fixtures**
- The shop fixture moves to `sygnal-check/test/fixtures/graph-shop/` and grows a case per A-item
  (view-only child, `sygnal/ui` import, duplicate names, `CHILD.select`, `run()` entry, spread
  reducers).

**T-4 Size and speed** (warn-only)
- The page for a 500-component synthetic graph renders in under 1 s in Chromium; page template
  size reported in the tracker.

### 1.9 Docs (D)

**D-1 A docs page: the app graph** (P1)
- `guide/app-graph.md` (or a section of `guide/diagnostics.md`): `--graph`, `--graph=html`,
  `--graph=mermaid`, `--watch`, the VS Code panel; screenshots; what each overlay means; the health
  list.
- Optionally a generated page for an example embedded in the docs (built at docs build time).

**D-2 Updates**
- `sygnal-check/README.md`, the VS Code README, `integration/agents.md` (the MCP `graph` fields),
  `reference/types.md` (InspectGraph), `skills/sygnal-dev/SKILL.md`, `llms.txt` (one line at most,
  P10-Q3), CHANGELOGs.

### 1.10 Not doing

- An editor inside the page (dragging to rewire components, editing state). The page is read-only.
- A hosted service or uploading graphs anywhere.
- An MCP App rendering of the page in chat clients. A good later candidate (the `graph` tool
  exists, and MCP Apps are proven in `examples/mcp-app`), but out of scope here.
- A React Flow / Cytoscape based viewer (D506).

## 2. Phases

| Phase | Items | Exit |
|---|---|---|
| 0 | Cut `plan10-integration`; `PLAN-10-status.md`; S-1, S-2, S-3; confirm the §4 reservations; P10-Q1…Q7 answered | The user's decision on S-1 recorded as a D-number |
| 1 | A-1…A-6, A-8, V-1, V-2, V-5, C-1, C-2, T-1, T-2, T-3, D-1; V-4 for the strategies S-1 marks as defaults | Full gate and sygnal-check tests green; the page correct on every example (no ghost cards except real unresolved names) |
| 2 | A-7, V-3, V-4 (rest), W-1, E-1, E-2, P-1, X-1 (if approved), T-4, D-2 | The live page and the VS Code panel update on save; the devtools tab shows a running app |
| 3 | C-3 + V-6 (`--base`), W-2 and P-2 (if S-3 recommends them); release prep | The user approves the release |

## 3. Gates

- **The full `npm test` gate** (CLAUDE.md) and `npm --prefix sygnal-check test`;
  `npm --prefix editors/vscode test` when E-2 lands.
- **Size gate unchanged**: kanban ≤ 42,700 B gzip with `nativeGlobalThis: false`; 0 B from this
  plan in app bundles.
- **sygnal-check has one runtime dependency** (`@babel/parser`) unless the user approves another on
  S-1's numbers (D506).
- **The page works offline**: T-2 runs with network requests blocked and fails on any request.
- **Graph compatibility**: existing `--graph --json`, MCP `graph` and runtime `inspect()` consumers
  keep working; every new field is optional in the schema (unless P10-Q4 says version 2).
- **Docs:** `npm --prefix docs run build`; `check-doc-samples` clean; the errors doc regenerated if
  X-1 adds codes.

## 4. Diagnostic code reservations

All free in `codes.ts` today; confirm them in Phase 0.

| Range | Reserved for |
|---|---|
| 1xx wiring: **SYG170–179** | X-1's graph-wide checks: a context read with no provider; `PARENT` with no `CHILD.select`; a component reachable from no entry |

Per CLAUDE.md, each code goes into both tables in `codes.ts` and gets an explanation in
`sygnal-check/src/explanations.js`. Then regenerate `explanations.json` and the errors doc.

## 5. Questions before Phase 1

The user accepted every recommendation on 2026-10-16 (D508–D514).

| # | Question | Recommendation |
|---|---|---|
| P10-Q1 | Flag names | **User, 2026-10-16: accepted (D508).** **`--graph=html` / `--graph=mermaid` only**, no `--viz` alias: one way to ask for it, like the canonical forms |
| P10-Q2 | Default output path for `--graph=html` | **User, 2026-10-16: accepted (D509).** **The OS temp dir**, with the path printed; `--out` for a file to keep or commit |
| P10-Q3 | `llms.txt` budget | **User, 2026-10-16: accepted (D510).** **No new line**: the graph view is for people; agents keep using `--graph --json` and MCP `graph`. Mention it in the skill only |
| P10-Q4 | Schema version for the new fields | **User, 2026-10-16: accepted (D511).** **Additive at `version: 1`**: every field optional, nothing renamed |
| P10-Q5 | Graph-wide checks as diagnostics (X-1) | **User, 2026-10-16: accepted (D512).** **Yes, measured first**: a rule ships only with no false positives on the examples and docs samples; otherwise it stays a health-list item |
| P10-Q6 | Release grouping | **User, 2026-10-16: accepted (D513).** **sygnal-check 0.10.0 after Phase 1** (data fixes, `--graph=html`, `--graph=mermaid`); the live mode, the VS Code panel and the devtools tab in the next minors; sygnal only if `inspect()` or devtools change |
| P10-Q7 | A large real app for S-1 | **User, 2026-10-16: accepted (D514).** Use one if the user has one (the page never leaves the machine); otherwise the synthetic corpus and all examples together |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Large apps stay unreadable whatever the layout | S-1 compares views that aren't node-link diagrams (outline, matrix, icicle) and focus mode, not only layouts; the outline list always works |
| Static analysis misses links (dynamic tags, computed EVENTS types) and the picture looks complete when it isn't | Unresolved names stay visible as ghost cards; dynamic selectors and events are marked `?`; the page says the graph is static and links to the runtime view |
| The page template grows with every host | One renderer with host adapters (links, updates, theme) passed in; T-4 reports the size |
| Live mode as a local server is an attack surface | Loopback only, a random token, read-only, no file serving beyond the page (invariant) |
| Layout jumps on every save make live mode tiring | S-1 item 10 measures stability; W-1 keeps positions and animates changes |
| The VS Code webview and the devtools panel drift from the CLI page | All three load the same V-1 files; T-2 covers the shared page |
| Paths and names in a shared page reveal private project details | The page is local by default; `--out` is explicit; nothing is uploaded (§1.10) |
