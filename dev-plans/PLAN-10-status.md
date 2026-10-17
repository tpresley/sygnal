# PLAN-10 Status Tracker

Tracks progress for [PLAN-10.md](PLAN-10.md) (an interactive view of the app graph).

**Numbering:** a reserved block, decisions **D500–D549**, gaps **G-800–G-849**.

**Integration branch:** `plan10-integration`, cut on 2026-10-16 from the spike branch `claude/sygnal-check-html-viz-spike-a7f154` (main `55c0e9b3` + the spike and this plan), in the worktree `.claude/worktrees/sygnal-ai-helpers-c2d7fd`.

**State:** Phase 0 complete (S-1 decided: D536–D538). Phases 1–2 code complete except D-1/D-2 (docs); Phase 3 (C-3/V-6 `--base`, W-2, P-2) not started. The spike is done ([`research/graph-viz/`](research/graph-viz/README.md)). Questions answered (D508–D514). Phase 0 started 2026-10-16. Reservations confirmed: SYG170–179 free in `codes.ts` and `explanations.js` (2026-10-16).

## Decisions

| # | Date | Decision |
|---|---|---|
| D500 | 2026-10-16 | `sygnal-check --graph=html`: a self-contained page in the temp dir, opened in the default browser; `--out` / `--open`; never opens under `CI` or without a TTY (user) |
| D501 | 2026-10-16 | Fix the graph data gaps (A-1…A-6) before the viewer ships (user) |
| D502 | 2026-10-16 | Live mode `--graph=html --watch` (user) |
| D503 | 2026-10-16 | One renderer for the CLI page, a VS Code panel and the devtools panel (user) |
| D504 | 2026-10-16 | `--graph=mermaid` (user) |
| D505 | 2026-10-16 | `--base <ref>` diff mode, in a later phase (user) |
| D506 | 2026-10-16 | No CDN, no bundled graph library; an optional dependency only on S-1's numbers (user) |
| D507 | 2026-10-16 | Research large-app strategies (S-1) before building them; the user decides on the results (user) |
| D508 | 2026-10-16 | P10-Q1: `--graph=html` / `--graph=mermaid` only, no `--viz` (user) |
| D509 | 2026-10-16 | P10-Q2: the OS temp dir, path printed; `--out` to keep a file (user) |
| D510 | 2026-10-16 | P10-Q3: no new `llms.txt` line; the skill mentions the page (user) |
| D511 | 2026-10-16 | P10-Q4: new fields additive at `version: 1`, all optional (user) |
| D512 | 2026-10-16 | P10-Q5: graph-wide checks become rules (SYG170–179) only when measured clean on the examples and docs samples (user) |
| D513 | 2026-10-16 | P10-Q6: sygnal-check 0.10.0 after Phase 1; live mode, VS Code panel and devtools tab in later minors; sygnal only if `inspect()` or devtools change (user) |
| D514 | 2026-10-16 | P10-Q7: no large real app supplied: S-1 uses the synthetic corpus and all examples together (user) |
| D515 | 2026-10-16 | A-2: package and widget components are fields on the child entry (`external`, `widget`), not nodes; every node keeps a real `file:line` id (coordinator, on the worker's proposal) |
| D516 | 2026-10-16 | A-4: locations are flat `line` / `column`, plus `file` only when it differs from the component's; `modelAt` for an action's model entry; `contextEntries`, `eventSites` per component (coordinator) |
| D517 | 2026-10-16 | A-3: `events[type].emitterIds` / `selectorIds` parallel to the names, one entry per component, so a name can repeat when two same-named components emit (coordinator) |
| D518 | 2026-10-16 | A-6: when any entry call's component can't be resolved (a parameter, e.g. ai-showcase's `run(Chat)` in `kimi.js`), the other roots get `entry: 'unknown'` (coordinator) |
| D519 | 2026-10-16 | Amends D514: the user supplied a private Vike app for S-1 (33 components, 29 page entries). Read-only; nothing derived from it (graphs, screenshots, names) is committed; reported as numbers only (user) |
| D520 | 2026-10-16 | S-2: a runtime graph renders one card per (parent card, component name), labelled ×N; instances and their state in the detail panel, fetched by the host and never inlined; the static health checks that misread runtime data become "not seen yet" groups (coordinator, on S-2) |
| D521 | 2026-10-16 | A stable component `key` (`file#name`) in the static graph (additive); hosts key selection, positions and UI state by it, since `id` (`file:line`) moves when lines are added (coordinator, on S-3) |
| D522 | 2026-10-16 | The runtime `inspect()` adds, in the dev entry only: ids on children and EVENTS lists, `entry`, `viewOnly`, `app`, `shown`; no core change; a sygnal minor (D513) (coordinator, on S-2) |
| D523 | 2026-10-16 | No runtime `contextConsumes` for now: it needs an `InstanceView` getter (core bytes), against the plan's 0-core-bytes invariant; revisit only if P-1 needs it (coordinator, on S-2) |
| D524 | 2026-10-16 | W-1 design (S-3) adopted: a shared `live.js` factored out of the LSP's `prepare()` (parse cache, last good text) for `--watch`, E-1 and W-2; recursive `fs.watch` with a per-directory fallback (Node 18 on Linux), `--poll`, 50 ms debounce; `node:http` + SSE sending the whole graph, on 127.0.0.1 with a random port and token, a Host check, CSP and `Referrer-Policy: no-referrer`. sygnal-check `engines` stays Node ≥ 18 (coordinator, on S-3) |
| D525 | 2026-10-16 | V-1: the page's modules are inlined as function bodies onto one namespace; inlined files must be import-free with top-level exports only, checked at generation time; comments are not stripped (29.5 KB gzip for the fixture is fine; a regex stripper is a risk) (coordinator, on the worker's proposal) |
| D526 | 2026-10-16 | The page carries its own CSP (`default-src 'none'`, inline style and script only): it loads nothing and connects nowhere (coordinator) |
| D527 | 2026-10-16 | `--graph=html` never opens a browser under `CI` or without a TTY, even with `--open` (it says why); `--out` works with every `--graph` format; `--json` with `--graph=html|mermaid` exits 2 (coordinator) |
| D528 | 2026-10-16 | Revises D517: `events[type].emitters` / `selectors` stay unique names (as before PLAN-10); `emitterIds` / `selectorIds` are independent full lists (components in static graphs, instances in runtime graphs), not parallel to the names. One meaning across both sources; no repeated names (coordinator, on the D522 worker's question) |
| D529 | 2026-10-16 | Static `key` collisions: the first same-named component in a file keeps `file#name`, later ones get `#2`, `#3` in source order; no runtime `key` until `sygnal/vite` stamps one (P10-Q9) (coordinator) |
| D530 | 2026-10-16 | Reverses D523: the user accepts a few core bytes for runtime `contextConsumes` (a read-only `InstanceView` getter for the context keys a render read); done with V-3, byte delta reported, stop if over ~40 B gzip (user) |
| D531 | 2026-10-16 | A-7: `actions[].writes` lists top-level state keys only (no dotted paths), `[]` for no change, `null` when unknown, and is present only on actions with a STATE sink; a reducer returning an object without `...state` writes its keys plus every other `initialState` key (coordinator, on the worker's proposal) |
| D532 | 2026-10-16 | A-7: one `stateReads` list per component (view, literal child lenses and Collection `from`, `calculated` and `context` functions), with `stateReadsPartial: true` when it may be incomplete (coordinator) |
| D533 | 2026-10-16 | A-7: `actions[].removes: true` flags a reducer that may return undefined (removes a Collection item), separate from `writes` (coordinator) |
| D534 | 2026-10-16 | X-1 outcome (D512 measured): **SYG170** (context read with no provider) and **SYG171** (`PARENT` that no parent reads) ship as static warnings, 0 findings left on 17 examples, 840 docs samples, the fixtures and the private app after each false positive became a silence condition; **SYG172** (unreachable from any entry) stays page-only (62/62 false positives). Record: `research/graph-viz/graph-rules.md`; the render graph and entries moved to `sygnal-check/src/model/renderGraph.js` (coordinator) |
| D535 | 2026-10-16 | W-1 details: live pages carry every code title (≈7 KB) since later graphs may add codes; `<link rel="icon" href="data:,">` (Firefox's favicon request vs the CSP); `--poll` defaults to 200 ms (20–60,000); imported files outside the inputs are watched; `--watch` with `--out`, and `--poll`/`--port` without `--watch`, exit 2 (coordinator) |
| D536 | 2026-10-16 | **Large-app defaults (S-1)**: N ≤ 60 the current layout; 60 < N ≤ 150 open directory groups each laid out on its own, focus mode on select (depth 2), bus nodes only where they cut edges, minimap; N > 150 directory groups start folded (one card each, bundled ×N edges, wrapped rows). Always: semantic zoom (text and overlays hidden below 0.4), search with a results list, health list, outline, an EVENTS table, filters in a menu; SVG, canvas only past ~400 drawn nodes. Not defaults: depth auto-folding, community grouping, a bus node per event type (user) |
| D537 | 2026-10-16 | No layout library as an optional dependency; the hand-written layered layout stays (user) |
| D538 | 2026-10-16 | Vike: `+Page` / `+Layout` cards are labelled by their route, and the graph gets an implicit layout → page edge (user) |
| D539 | 2026-10-16 | V-3/P-1: runtime cards cluster by app ("app N · RootName", else the root name); the devtools App graph refreshes 150 ms after the last component or action message, with `inspect({ actions: 200 })`, only while the view is open; runtime diagnostics keep a `timestamp`; the devtools frame's CSP allows inline styles but never inline scripts; the page is built from the same modules (`pageAssets()`), no copy (coordinator) |
| D540 | 2026-10-16 | A-9 details: `+Wrapper` counts as an entry and part of the shell chain (Wrapper > Layout > Page, Vike's inheritance; `(group)` layouts apply only inside their group, labelled `/`); `routes` lists every route when several `+Page` files export one component (`route` = the first); a Route Function gives `route: null, routeDynamic: true`; layout edges are `children[].via: 'layout'` and don't feed the SYG170/171 parent links (coordinator) |
| D541 | 2026-10-16 | E-1/E-2: `sygnal/graph` `{ root | uri | textDocument }` → `{ root, version, graph }`, answered from a check that saw the current documents; `sygnal/graphChanged { root, version }` only for roots a client asked about. The panel: nonce CSP, `localResourceRoots: []`, links as messages opened only inside the panel's root, state restored from webview state (no `retainContextWhenHidden`), a serializer across restarts; theme toggle, editor picker and downloads hidden; "under the cursor" = from a component's line to the next component in the file until the graph has end lines (G-804) (coordinator) |
| D542 | 2026-10-16 | V-4 details on D536: in the small tier (≤ 60) zoom below 0.4 hides card text but keeps overlays (they hide only in the grouped tiers) and a trace always stays visible; a group is the directory two levels below the components' common directory, and a one-component group never folds; tracing opens the folded groups holding its ends (up to 6); the page's graph/EVENTS view switch is `api.showView` (E-2 owns `api.setView`); the synthetic generator lives in `sygnal-check/test/fixtures/graph-synth.js` (the research CLI imports it) (coordinator, on the worker's proposals) |
| D543 | 2026-10-16 | P10-Q8: `sygnal/vite` serves the live graph page at `/__sygnal/graph` in dev **by default**; `graph: false` turns it off (user) |
| D544 | 2026-10-16 | P10-Q9: `sygnal/vite` stamps each component with its static key in dev only, so the page can overlay runtime data on the static graph (P-2); nothing in production builds (user) |

## Items

| Item | Phase | Status | Notes |
|---|---|---|---|
| S-1 Large apps research | 0 | ✅ merged `258b9886` | `research/graph-viz/large-apps.md`; defaults await the user's decision |
| S-2 Runtime graphs in the renderer | 0 | ✅ merged `9ebadfa6` | `research/graph-viz/runtime-graphs.md`; D520, D522, D523 |
| S-3 Live transport design | 0 | ✅ merged `9ebadfa6` | `research/graph-viz/live-mode.md`; D521, D524; W-2 recommended for Phase 3 |
| A-1 View-only components | 1 | ✅ merged `dcbb7e33` | |
| A-2 Package components | 1 | ✅ merged `dcbb7e33` | node vs child-entry field: a D-number in Phase 0 |
| A-3 Ids on links | 1 | ✅ merged `dcbb7e33` | |
| A-4 Source locations | 1 | ✅ merged `dcbb7e33` | |
| A-5 `PARENT` receivers | 1 | ✅ merged `dcbb7e33` | |
| A-6 Entries | 1 | ✅ merged `dcbb7e33` | `run()`, `defineElement()`, Vike `+Page`/`+Layout`; Astro deferred (G-800) |
| A-7 State writes and reads | 2 | ✅ merged `34e9dba6` | the page doesn't use `writes`/`stateReads` yet: with V-4 | |
| A-9 Vike routes and layout → page edges | 2 | ✅ merged | D538, D540; page display in V-4 |
| A-8 Schema, text, MCP, runtime parity | 1 | ✅ merged `3e23b82b` | static + runtime fields, `key`, D528 |
| V-1 Renderer module | 1 | ✅ merged `464fb567` | from the spike's `template.html` |
| V-2 Use the new data | 1 | ✅ merged `90e2a085` | |
| V-3 Runtime graphs | 2 | ✅ merged `ae0ddda5` | `graphView/runtime.js` | |
| V-4 Large-app strategies | 1–2 | ✅ merged | D536, D542 | D536; with the page follow-ups (state trace from `writes`/`stateReads`, the context health item fixed per SYG170, unreachable as a filter, G-802) |
| V-5 Accessibility and polish | 1 | ✅ merged `464fb567` | |
| V-6 Diff rendering | 3 | 🔄 `p10-base-diff` | |
| C-1 `--graph=html` | 1 | ✅ merged `464fb567` | |
| C-2 `--graph=mermaid` | 1 | ✅ merged `464fb567` | |
| C-3 `--base <ref>` | 3 | 🔄 `p10-base-diff` | |
| W-1 `--watch` | 2 | ✅ merged | `live.js`, `watch.js`, `liveServer.js`, `graphView/liveHost.js` (D535) | |
| W-2 `sygnal/vite` dev route | 3 | 🔄 `p10-vite-graph` | D543 |
| E-1 LSP `sygnal/graph` | 2 | ✅ merged | |
| E-2 VS Code panel | 2 | ✅ merged | not yet: marking changed cards as the live page does | |
| P-1 Devtools app graph tab | 2 | ✅ merged `ae0ddda5` | verified in a harness and in Chromium with `--load-extension`, not in real DevTools | |
| P-2 Static + runtime together | 3 | 🔄 `p10-vite-graph` | D544 |
| X-1 Graph-wide rules (SYG170–179) | 2 | ✅ merged `d1d174ba` | SYG170, SYG171 shipped; SYG172 page-only (D534) |
| T-1 Unit tests | 1 | ✅ merged `464fb567` | |
| T-2 Browser smoke | 1 | ✅ merged `d129d039` | 13/13 on Chromium, Firefox, WebKit | |
| T-3 Graph data fixtures | 1 | ✅ merged `dcbb7e33` | |
| T-4 Size and speed | 2 | ✅ (V-4) | first paint syn-2000: Chromium 104–121 ms, Firefox 182–199 ms, WebKit 337–470 ms; page code +23 KB gzip | | warn-only |
| D-1 Docs page | 1 | ⏳ | |
| D-2 Docs and agent context updates | 2 | ⏳ | |

## Questions

| # | Status | Answer |
|---|---|---|
| P10-Q1 Flag names | answered | accepted (D508) |
| P10-Q2 Default output path | answered | accepted (D509) |
| P10-Q3 `llms.txt` budget | answered | accepted (D510) |
| P10-Q4 Schema version | answered | accepted (D511) |
| P10-Q5 Graph-wide rules | answered | accepted (D512) |
| P10-Q6 Release grouping | answered | accepted (D513) |
| P10-Q7 A large real app for S-1 | answered | accepted (D514); a private Vike app supplied (D519) |
| P10-Q8 W-2: serve `/__sygnal/graph` from `sygnal/vite` by default in dev (opt out with `graph: false`)? | answered | yes (D543 / D544) |
| P10-Q9 W-2/P-2: have `sygnal/vite` stamp components with their static key in dev only, so runtime instances match static cards? | answered | yes (D543 / D544) |

## Gaps

| # | Found | Gap | Status |
|---|---|---|---|
| G-800 | 2026-10-16 (A-6) | `.astro` files aren't scanned, so Astro page entries can't be marked | open |
| G-801 | 2026-10-16 (A-7) | `analyzeModel` treats a call-built model entry (`SEND: sending(fn)`) as a plain STATE entry, so its other sinks (e.g. `LLM`) are missed; pre-existing | open |
| G-803 | 2026-10-16 (A-9) | Possible runtime bug, unverified: Vike orders cumulative `Layout` values closest-first, while `src/vike/onRenderClient.ts` may treat index 0 as the outermost, which would nest layouts in reverse | ✅ fixed (`9e3e0d9a`, merged): real bug; ships with PLAN-10's release (user) |
| G-804 | 2026-10-16 (E-2) | Components have no end line in the graph, so the VS Code panel's "component under the cursor" is approximate (line to the next component); an additive `endLine` would make it exact | open |
| G-805 | 2026-10-16 (V-4) | At 2,000 components the folded overview still has 71 group cards; a second grouping level would help | open |
| G-806 | 2026-10-16 (V-4) | Canvas mode (> 400 drawn nodes): no keyboard navigation on the drawing (the outline is the accessible path) and SVG export is empty | open |
| G-807 | 2026-10-16 (V-4) | Bus-node lanes sit far from both ends of their edges | open |
| G-802 | 2026-10-16 | Page title: with no `package.json` in the scanned folder, `--graph=html` takes the name from an ancestor's (the test fixture shows "sygnal") | ✅ fixed in V-4 |

## Log

- 2026-10-16 `p10-large-view` merged (V-4 + the state trace from `writes`/`stateReads`, the context health item per SYG170 and Vike fields, Vike routes on cards and layout edges, G-802). The synthetic generator moved into `sygnal-check/test/fixtures/` so the gate doesn't read `dev-plans/`. On integration: sygnal-check 1,519; browser static 14, runtime + devtools 9, live 5, VS Code 7, large apps 10 on Chromium, Firefox and WebKit. Page: shop fixture 214 KB / 61 KB gzip.

- 2026-10-16 G-803 fixed in its own session (`vike-layout-order`) and merged: Vike lists cumulative `Layout`/`Wrapper` closest-first (vike 0.4.268), `sygnal/vike` nested index 0 outermost, so nested layouts rendered inside-out on SSR and hydration, and client navigation kept the first page's shell. New `src/vike/shell.ts` shared by `onRenderHtml`/`onRenderClient`; navigation now adds/removes nested Layouts keeping shared ones mounted; `examples/vike` gains `/admin`. On integration: build; root vitest 4,952 passed; sygnal-check 1,497; types; size gate unchanged (42,495 B); `examples/vike` builds; docs build and link check pass.

- 2026-10-16 `p10-vscode` merged: sygnal-check 1,497; browser static 14, runtime + devtools 9, live 5, VS Code panel 7 on Chromium, Firefox and WebKit; `npm --prefix editors/vscode test` (typecheck, unit 17, build, smoke 4/4 in the installed VS Code) passes on integration.

- 2026-10-16 `p10-vike-routes` merged: `route`/`routes`/`routeDynamic` and layout edges. On the private app 29 components got routes and 28 layout edges; `examples/vike` unchanged but `+Wrapper` gains `entry: true`. sygnal-check 1,480; types OK; doc samples 840 clean (worker).

- 2026-10-16 `p10-runtime-view` merged (`ae0ddda5`; `run-headless.mjs` conflict, both suites kept; a test that cut `V.mountPage` out of the inline script by regex broke on the live-mode line, fixed). D530 core cost: +9 B (kanban 42,496 → 42,505 B on the branch; 42,495 B on integration, 205 B headroom). On integration: build; sygnal-check 1,470; root vitest 4,945 passed / 33 skipped; types; size gate; perf gate all within limits; browser static 14/14, runtime + devtools 9/9, live 5/5 on Chromium, Firefox and WebKit.

- 2026-10-16 `p10-graph-rules` merged (`d1d174ba`; a `graph.js` import conflict with A-7 resolved): sygnal-check 1,442; diagnostics + docs-errors drift 139; errors doc up to date; types OK. Follow-up for the page (V-4 batch): its "context read with no provider" item ignores a component's own `.context` and lists Vike's framework fields; SYG170's silence conditions are the reference.
- 2026-10-16 `p10-watch` merged: sygnal-check 1,459; LSP suites unchanged (306); browser static page 14/14 and live page 5/5 on Chromium, Firefox and WebKit. Rebuild after one edit: plan5-showcase 15–25 ms (save → client 78–88 ms), ai-showcase 40–50 ms (101–113 ms).
- 2026-10-16 `p10-s1-large-apps` merged (`258b9886`): research only, nothing from the private app committed. Folding directory groups above ~150 components is what makes 2,000 readable (fit zoom 0.008 → 0.38); no layout library worth a dependency (ELK 41.7 s at 2,000, own layered 15–25 ms); all 90 task-check answers right in 0–3 steps.
- 2026-10-16 `186e05b8`: highlighted edges and labels drawn above the cards with a label pill, cards on top otherwise (user report).

- 2026-10-16 `p10-state-paths` merged (`34e9dba6`): known `writes` for kanban 17/17, todomvc 11/11, graph-shop 8/8, plan5-showcase 116/118, ai-showcase 322/334 (the rest genuinely dynamic); partial reads only in ai-showcase (9/31). sygnal-check 1,421 passed; types OK. Also `49a233dd`: Health items indented under their group (user report).

- 2026-10-16 D528 merged (`90e2a085` page, `3e23b82b` static graph): event names unique again, id lists independent. On integration: sygnal-check 1,406 passed, inspect tests 13, types OK, graph page 13/13 (Chromium).

- 2026-10-16 `p10-viewer-cli` fix + V-2 merged (`d129d039`): `setGraph` keeps a moved view exactly and refits an untouched one; restoring the selection never pans; a WebKit-only flake fixed. V-2: view-only cards lighter, package/widget ghosts labelled, `childSelects` as a PARENT overlay (pink, own toggle), entries tagged and first. On integration: sygnal-check 1,404 passed, graph page 13/13 (Chromium).

- 2026-10-16 `p10-graph-key-runtime` merged (`3b311330`): static `key`; runtime `children[].ids`, `emitterIds`/`selectorIds`, `entry`, `viewOnly`, `app`, `shown` in the dev entry only (`src/core/` untouched). Size gate 42,496 B before and after. Worker's gates: root vitest 4,936 passed, sygnal-check 1,368, types, browser 377/377, docs build. On integration after a rebuild: sygnal-check 1,403, inspect tests 11/11, types OK.

- 2026-10-16 `p10-viewer-cli` merged (`464fb567`): `sygnal-check/src/graphView/` (model, layout incl. edge routing, mermaid, page), `--graph=html|mermaid|json|text`, `--out`, `--open`/`--no-open`, `--editor`; WCAG AA colours checked by a test; cycles no longer crash the layout. On its own branch: sygnal-check 1,388, browser 377/377 + graph page 11/11 on Chromium, Firefox and WebKit. Page: 100 KB raw / 29.5 KB gzip for the fixture. After the merge with the graph data: sygnal-check 1,400 passed; graph page 9/11 on Chromium (setGraph view drift; a hard-coded fixture id) — sent back to the worker with V-2.

- 2026-10-16 `p10-s2-s3-design` merged (`9ebadfa6`): S-2 (runtime samples for kanban and two plan5-showcase sections; the spike page threw on runtime graphs and split instances into roots) and S-3 (rebuild after a one-file edit with a warm cache: kanban 3.3 ms, plan5-showcase 14.5 ms, ai-showcase 41 ms, all examples 77 ms; save → SSE ≈ 78 ms; a fresh CLI run 142–188 ms). Runtime diagnostics are reported once per process, so P-1 shows each with its time.

- 2026-10-16 `p10-graph-data` merged (`dcbb7e33`): sygnal-check 1,365 passed / 4 skipped; `test:types` and `test/inspect-kanban.test.js` pass. On the examples nothing disappeared: the fixture goes 6 → 7 components (`Shop` back, `ProductCard` no longer a root); plan5-showcase 43 → 54 (the 10 the spike found missing, plus `Dashboard` and `Notes`); 33 entries in plan5-showcase, 10 in ai-showcase. Also fixed: `public.d.ts` lacked `behavior` on actions/selectors and `agent.queries`; behavior reply targets are namespaced like their `next()` targets.
