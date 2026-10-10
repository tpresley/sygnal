# PLAN-7: Editor tooling: a Sygnal language server, a VS Code extension, a Claude Code plugin

**Goal:** show `sygnal-check`'s findings in the editor *while the code is being written*, for people (VS Code, Neovim, Zed, Helix, JetBrains) and for coding agents (Claude Code), from one language server. The wiring bugs it finds fail silently at runtime: a misspelled action does nothing, and a selector that doesn't match fires nothing. Today they appear only when someone runs the CLI or the MCP server, or after a save while the Vite dev server runs.

**Release (D297):** **sygnal-check 0.4.0** (additive: the `lsp` subcommand, the shared config file, end ranges); **create-sygnal-app 2.2.0** (templates recommend the extension and carry the config); the VS Code extension **0.1.0** on its own version line. `sygnal` itself changes only if P7-Q3 has the Vite plugin read the shared config: a patch, **6.1.1**. P7-Q1.

**Status:** Phase 0 complete (2026-10-10); §5's questions answered (D297–D304); 0-S2's findings amend L-1, V-1, I-1 and E-1 (D305–D308). Tracker: [`PLAN-7-status.md`](PLAN-7-status.md). The research and the decision to build it: [`research/ide-tooling.md`](research/ide-tooling.md) (the user agreed with its recommendations on 2026-10-10). Phase 0 cuts `plan7-integration` from `main` and creates `dev-plans/PLAN-7-status.md` in the PLAN-6 format.

**Branches:**
- integration: `plan7-integration`;
- subagent branches: `p7-*`;
- experiments and spikes: `exp/p7-*`.

**IDs:**
- items C- (checker groundwork), L- (language server), V- (VS Code extension), I- (other integrations: the Claude Code plugin, other editors, templates), N- (navigation and completions, gated), D- (docs), E- (eval);
- questions P7-Q1…;
- decisions and gaps continue the global numbering: **D297…** (D297–D304 taken by §5) and **G-657…** (PLAN-6 ended at D296 and G-656).

**Inputs:**
- The research: [`research/ide-tooling.md`](research/ide-tooling.md) (landscape, experiments A and B, delivery options) and the proof of concept in [`research/ide-tooling-poc/`](research/ide-tooling-poc/) (`server.mjs`: a zero-dependency LSP over stdio with diagnostics, hover and quick fixes; `client.mjs`: a scripted editor; `bench.mjs`; the fixture with the three component forms). Subagents read both before starting an item.
- `sygnal-check/src/mcp.js`: the hand-rolled JSON-RPC server to copy the structure from (dispatch, never-throw handling, tests in `test/mcp*.vtest.js`).
- `sygnal-check/src/model/project.js` (`Project.loadFile`, the only place that reads source), `diagnostic.js`, `fix.js`, `fixControls.js`, `graph.js`.
- `src/vite/plugin.ts`'s `check` option (how the dev server runs the checker and which defaults it passes: `strict` from `diagnostics.strict`, `ignore`, `a11y`, paths).
- The eval harness's variant format (`evals/agent-ergonomics/variants/*.json`, `lib/headless.mjs`) and the earlier results for checker tooling, `results/PHASE3-RESULTS.md` §E1 and §E8.

**Invariants:**
- **One source of rules.** The server calls `sygnal-check`'s API. No rule logic is duplicated in the server, the extension or the plugin, so the CLI, the Vite overlay, the MCP server and the editor always agree for the same files and config.
- **`sygnal-check` stays dependency-light**: `@babel/parser` only. The LSP layer is hand-written, like the MCP server (D209's spirit; P7-Q2).
- **The server never runs project code.** It reads source files and JSON config. It never evaluates `vite.config.*` or any other JS.
- **No new diagnostic codes, no `sygnal` core bytes**, no `llms.txt` lines unless E-1 shows agents benefit (§1.6).
- **The editor shows what the CLI shows.** For the same files on disk and the same config, the server's diagnostics equal `sygnal-check --json`'s. This is a test, not a goal.

**Words:**
- "the server" for `sygnal-check lsp`;
- "the extension" for the VS Code extension;
- "the plugin" for the Claude Code plugin;
- "a finding" for one `sygnal-check` diagnostic; "a code action" for an LSP quick fix or refactor.

---

## 0. What main changed since the research (merged 2026-10-10, `2831b13e`)

The research ran on `2d3569bf` (6.0.0). Main has since released **sygnal 6.1.0, sygnal-check 0.3.0 and create-sygnal-app 2.1.0** (PLAN-6, `sygnal/ai`). What matters here:

| Change on main | Effect on this plan |
|---|---|
| sygnal-check 0.3.0 adds the `agent` static to the project model and new rules: SYG150/151 and SYG240/243 and SYG440/441 (agent), SYG152 (LLM request without `ok`), SYG153 (WebMCP form attributes), SYG730/731 (a11y), and `decide()` reply actions in SYG102 (G-648) | The server gets them for free, which supports the "one source of rules" invariant. Many of these findings are on object keys and option names, so the end-range work (C-2) has to cover more node kinds than the PoC's string/identifier heuristic |
| `mcp.js` became a **dual-era** server (G-656: the `initialize` revisions plus the stateless 2026-07-28 revision), with `test/mcp-2026.vtest.js` and a dev-only `@modelcontextprotocol/client` | L-1 copies `mcp.js`'s structure, not its protocol layer: LSP uses `Content-Length` framing and its own lifecycle. MCP is unchanged by this plan. Testing a server with the official client package as a dev dependency is a precedent: L-1 may use `vscode-languageserver-protocol` / `vscode-jsonrpc` the same way, in tests only |
| `sygnal/vite` gained the **dev MCP endpoint** (`mcp: true`, `src/vite/mcp.ts`): the running page's `get_diagnostics`, `component_tree` and so on, reached over the HMR channel | Not in scope. It is a possible later source of *runtime* diagnostics in the editor (§1.8). The server stays static-only |
| create-sygnal-app now has **10 templates** (adds `template-mcp-app` and `template-mcp-app-ts`) | I-3 touches all 10 (`.vscode/extensions.json`, the config file); RELEASING's template list already names them |
| The checker is faster: re-measured on the merged tree, plan5-showcase (50 files, 2.2k lines) re-checks in **≈ 47 ms warm, ≈ 87 ms cold** (the research measured 174 / 254 ms on 0.2.0 under a different machine load); kanban 8 ms; ai-panel-spa 21 ms. The PoC still passes unchanged on 0.3.0 | Per-keystroke whole-project checks are affordable well past the research's 10k-line estimate. C-3's parse cache is still worth doing, but L-1 needs no incremental rules. The latency gate (§3) fixes the numbers on a generated large project instead of on the machine's mood |
| `llms.txt` is at **319 / 320** lines (D245); SKILL.md at 42,699 B (PLAN-5 held 42,100, D238; no test gate) | The plan adds no `llms.txt` lines. The skill gets at most one line, and only if E-1 says so |
| The eval harness: PLAN-3-H variants support `mcp` per arm (`e8-mcp.json`), with `--strict-mcp-config` isolation in `lib/headless.mjs`; the p6 tier (44–47) and `p6-final.json` | E-1 needs a new variant field for Claude Code plugins (`plugins`), isolated the same way. PHASE3 E1/E8 set the priors (§1.6) |
| Node prerequisite for `sygnal` is 20.19+ / 22.12+ (docs); `sygnal-check` still declares `>=18` | The server keeps `>=18` (no new Node APIs needed). The extension runs the server with the editor's or the project's Node (V-1) |

## 1. Scope

### 1.1 Checker groundwork (C)

All in `sygnal-check/`, each item tested on its own, released with L-1.

**C-1 In-memory sources** (P1)
- `check()` / `checkFiles()` / `buildProject()` take `sources?: Map<absPath, text>` (or `readFile(absPath)`). `Project.loadFile` reads from it before the disk. This replaces the PoC's `fs.readFileSync` patch.
- Import resolution (`resolveImport`) has to see unsaved *new* files too: a file that exists only in an editor buffer must resolve. Test it.
- `fixFiles()` gets the same option, returning edits instead of writing (C-4).

**C-2 End ranges** (P1)
- Every diagnostic gets `endLine` / `endColumn` from the node it reports on (for the range only; suppression comments keep matching by start line). `makeDiagnostic` takes a node (or a loc) instead of line/column where a rule has one.
- Audit all rules for which node is the *right* one to underline: the selector string, not the whole `DOM.click()` call; the key, not the whole model entry; the attribute, not the element (SYG7xx). SYG900 (parse error) gets the parser's position with a one-character range.
- `--json` output gains the two fields (additive; the README, and the diagnostics in `schema/inspect.schema.json` for `--graph`). The text format is unchanged.

**C-3 Parse cache** (P2)
- `Project` takes an optional `ParseCache` (absPath → `{ text, ast, parents, suppressions }`) and reuses an entry when the text is identical. The server keeps one across checks. The CLI doesn't use it.
- Target: re-checking after a one-file change parses one file. Measure with `bench.mjs`.
- Watch for AST mutation: rules must not mutate cached ASTs (check with a frozen-AST test run).

**C-4 Fixes as edits** (P1)
- Diagnostics that have a mechanical fix carry it as data: `fix.edits: [{ file, start, end, text }]` (offsets or line/column with end), plus a `title`. Covers:
  - every "did you mean `X`?" suggestion (SYG110, SYG641, SYG127 options, SYG151 `agent`, ...);
  - the strict rewrites `--fix` already applies (SYG504, SYG505, SYG506);
  - `--controls` conversions (one selector → control), with the same safety conditions as `fixControls.js`.
- `fixFiles()` is re-expressed on top of these edits, so `--fix` and the editor apply the same change. Existing `--fix` tests must pass unchanged.
- New, editor-only fixes: "add a model entry for `X`" for SYG101 (a stub `X: (state, data) => state` with a `TODO`; only when the model is an object literal in the same file), "remove the unreachable entry" for SYG102 as a *refactor*, not a quick fix.

**C-5 Shared config file** (P1, P7-Q3)
- `sygnal-check` reads `strict`, `a11y`, `ignore`, `paths` and `includeTests` from, in order: CLI flags / server settings, `sygnal-check.config.json` at the project root, the `"sygnal-check"` key in `package.json`, then the defaults. JSON only, never JS.
- The CLI, the MCP server and the language server all use it. If P7-Q3 accepts, the Vite plugin's `check` option uses it as the default too (its explicit options still win), so the overlay and the editor agree.
- Unknown keys are a warning (with "did you mean"); a malformed file is one SYG900-style finding on the config file itself, not a crash.

### 1.2 The language server (L)

**L-1 `sygnal-check lsp`** (P1)
- **Transport:** stdio, `Content-Length` framing, JSON-RPC 2.0. Hand-written in `src/lsp/` (protocol, document store, server), exported as `createLspServer()` for tests and run from `bin/` like `mcp`.
- **Lifecycle:** `initialize` (workspace folders, client capabilities, `initializationOptions` for settings), `initialized`, `shutdown`, `exit`, `$/cancelRequest` (cancels a pending check; a cancelled request is answered with `-32800`), `workspace/didChangeConfiguration`, `workspace/didChangeWatchedFiles` (re-check when a file changes on disk, a branch switch, a config change). From 0-S2 (D305–D306):
  - read `workspaceFolders` even when the client advertises `workspaceFolders: false` (Claude Code sends one folder anyway); multi-root otherwise as below;
  - register `workspace/didChangeWatchedFiles` and `workspace/didChangeConfiguration` **dynamically** when the client allows it (VS Code sends neither without registration); after any `didChangeConfiguration`, request `workspace/configuration` per folder again and ignore the notification's payload (VS Code's is window-scoped);
  - without watchers (Claude Code; Neovim on Linux), rely on `didSave` and re-read from disk;
  - exit when stdin ends, without waiting for `exit` (Claude Code sends `shutdown` and never `exit`); ignore unknown `$/` notifications (VS Code sends `$/setTrace` repeatedly).
- **Documents:** full sync first (`TextDocumentSyncKind.Full`); incremental sync only if profiling shows the copying matters (it didn't in the PoC).
- **Checking:** one project per workspace folder (multi-root works, and a folder without Sygnal components produces nothing). Whole-project check using C-1 overlays and the C-3 cache: **immediately on `didSave`**, debounced (≈150 ms) only for `didChange` without a save (D306: Claude Code sends `didSave` with every edit and builds its next model request ≈ 10 ms after the tool result, without waiting for the server). Publish **only the files whose findings changed**, plus an empty list for files that cleared; sort each file's findings by severity (Claude Code delivers at most 10 per file, errors first). The check runs off the request path (G-657).
- **Diagnostics:** `range` from C-2, `severity` mapped (error → Error, warn → Warning, info → Information, shown only if `verbose` is set, as in the CLI), `code` + `codeDescription.href` (the docs URL), `source: 'sygnal'`, the component name and the fix text in the message (as the CLI prints them), `data` carrying the fix edits.
- **Hover:** on a finding, the `explain` text (title, explanation, fix, docs link), as in the PoC.
- **Code actions:** answer the frequent automatic requests (`triggerKind: 2`) fast, with `[]` when nothing applies, and honour `only: ['source.fixAll']`. Quick fixes from C-4 (`isPreferred` for a single unambiguous suggestion); `source.fixAll.sygnal` applies every mechanical fix in the file (what `--fix` does for it); a "Suppress SYGnnn on this line" action that writes the checker's existing suppression comment (`// sygnal-ignore-next-line SYG110`, or `{/* … */}` inside JSX).
- **Push diagnostics only** in 0.4.0 (D305). 0-S2: VS Code shows every finding twice when a server offers both push and pull, and pull alone covers only open documents, which loses the cross-file findings; Claude Code has no pull. Pull (with `workspace/diagnostic`) can come later as an explicit opt-in that turns push off.
- **Robustness:** a rule that throws produces SYG900 for that file (as today) and never kills the server; a parse error in the file being edited keeps the *other* files' findings and that file's last good findings, unchanged, until it parses again (§6); requests are answered in order of arrival; the server logs to stderr / `window/logMessage` only at the configured level.
- **Settings:** `sygnal.strict`, `sygnal.a11y`, `sygnal.ignore`, `sygnal.paths`, `sygnal.verbose`, `sygnal.trace.server`. Editor settings override the C-5 config file, but the extension's defaults are "unset", so by default the file decides.

**L-2 Tests** (P1, with L-1)
- `test/lsp*.vtest.js`: in-process tests through `createLspServer()`, plus one stdio round trip through the binary.
- A **protocol conformance** test with a real client library as a dev dependency (`vscode-languageserver-protocol` or `vscode-jsonrpc`, exact pin, test-only, like `@modelcontextprotocol/client` for G-656).
- The **parity test**: for the fixtures and for every example app, the server's published diagnostics (with no overlays) equal `check()`'s for the same config.
- The PoC's script becomes a test: the three forms of the counter, an unsaved fix, hover, code action.

### 1.3 VS Code extension (V)

**V-1 `editors/vscode/`** (P1)
- A new folder (its own `package.json`, not an npm package; built with esbuild into one file). It depends on `vscode-languageclient`, bundled into the `.vsix`, as every extension does. D209 covers npm builds; the extension is a separate distribution channel (P7-Q4).
- **Finding the server:** the workspace's own `node_modules/sygnal-check` first (the same version as the project's CLI and CI, the way the ESLint extension uses the workspace's ESLint). Fallback: a copy bundled with the extension, with a status-bar note "using the bundled sygnal-check 0.4.x". If the workspace copy is older than 0.4 (no `lsp`), say so once and offer the bundled one (P7-Q5).
- **Activation:** on a workspace containing a `package.json` that depends on `sygnal`, or on `sygnal-check.config.json`; languages `javascript`, `javascriptreact`, `typescript`, `typescriptreact`.
- **Commands:** "Sygnal: Restart Server", "Sygnal: Show Output", "Sygnal: Explain Code…" (a picker over `explain`), "Sygnal: Fix All in File".
- **Settings:** the L-1 settings, contributed with descriptions and enums, every one with `"scope": "resource"` (0-S2: otherwise VS Code ignores folder-level values).
- **Snippets:** a component skeleton (view, `intent`, `model`, `initialState`) in JS and TS canonical forms, generated from `PLAN-1-canonical-forms.md`'s forms and checked by `sygnal-check --strict` in a test, so they can't drift.
- **Tests:** `@vscode/test-electron` smoke test (activate on a fixture, get the three findings, apply a quick fix). Runs in CI, not in `npm test` (it downloads VS Code), like `test:recipes`.
- **Publishing:** VS Code Marketplace and Open VSX (for VSCodium, Cursor, Windsurf and similar). The publisher accounts and tokens are the user's (P7-Q4); RELEASING.md gets a section.

### 1.4 Other integrations (I)

**I-1 Claude Code plugin** (P1)
- A plugin in the repository (`editors/claude-code/` with `.claude-plugin/plugin.json`) and a marketplace file (`.claude-plugin/marketplace.json` at the root, so `/plugin marketplace add tpresley/sygnal` works).
- Contents:
  - `lspServers` **inline in `plugin.json`** (0-S2: `claude plugin validate` doesn't read `.lsp.json`): `sygnal` → `npx --no-install sygnal-check lsp`, mapping `.js .jsx .ts .tsx`, with `"settings": {}` so the server gets a `workspace/configuration` channel (D307);
  - the **`sygnal-dev` skill**, which today users have to copy into `.claude/skills/` by hand (`integration/agents.md`). One install now gives the skill and the editor diagnostics;
  - **not** the MCP server by default (E8: unprompted use was shallow, and the CLI covers it). It stays one documented line to add.
- How Claude Code 2.1.287 delivers diagnostics (0-S2, [`research/p7-spikes/0-S2.md`](research/p7-spikes/0-S2.md)). No flag is needed. The server starts at the first Edit/Write of a mapped file. Published findings go into a pending registry and reach the model as a `<new-diagnostics>` system reminder with the *next* request after a tool result: not in the tool result, and not through the `LSP` tool, which the model never called.
  - Each identical finding (message, severity, range, source, code) is delivered **once per session**.
  - At most 10 per file and 30 per attachment.
  - Findings for files the agent never touched are delivered too.
  - `codeDescription`, `relatedInformation` and `data` are dropped, and there are no code actions.
- So **messages must stand on their own** (D307): the component, the problem and the fix in the text, as the CLI already prints them. Nothing the model needs can live in the docs link or in `data`.
- G-658 (open): in two runs, a finding left in the edited file after the agent's last edit was never delivered. Settle it with one `--debug-file` run (≈ $0.03) in Phase 2, before E-1.

**I-2 Other editors** (P2, docs-first)
- Documented setups, each tested once by hand and recorded in the status file:
  - Neovim (`vim.lsp.config` / nvim-lspconfig custom server);
  - Helix (`languages.toml`);
  - Zed: a settings snippet if Zed can attach a custom LSP to existing languages without an extension; otherwise a small Zed extension is a follow-up, not in this plan;
  - JetBrains IDEs: through LSP4IJ (free, works in Community editions) with a settings snippet; a native plugin is out of scope.
- The server must not assume VS Code: no VS Code-only methods, and no behaviour that depends on client capabilities it didn't check.

**I-3 Templates** (P2)
- All 10 create-sygnal-app templates get `.vscode/extensions.json` recommending the extension, and the C-5 config file (`{ "strict": true }`, matching AGENTS.md's `sygnal-check --strict`).
- Their AGENTS.md is unchanged unless E-1 says otherwise.

### 1.5 Navigation and completions (N), gated

These need source positions in the project model (the research's gap 3). **Go/no-go after Phase 2** (P7-Q6), on user feedback from the first release and the effort estimate from 0-S3.

**N-1 Positions in the model** (P2)
- Actions (intent keys, model keys, `next('X')`, reply names `ok:`/`error:`, `agent.actions` keys, timer actions), selectors and the view elements they match, EVENTS emits/selects, Collection `from` fields, context entries: each with its node's range. The `--graph` JSON may expose them as an optional `loc` (additive, schema updated).

**N-2 Language features** (P2)
- **Completions** inside the strings TypeScript treats as opaque:
  - model keys from the component's intent actions;
  - `DOM.*('…')` classes and ids from the component's own view;
  - `EVENTS.select('…')` from the types emitted anywhere in the project;
  - `ok:` / `error:` / `next('…')` from the model's keys;
  - `<Collection from="…">` from `initialState` / `calculated` keys.

  These matter most for JS and untyped TS, where `DOM` is `any` and nothing completes today.
- **Definition / references:** intent key ↔ model entry; selector → the element in the view; `EVENTS.select('X')` ↔ its emitters; reply name → model entry.
- **Rename** an action across intent, model, `next()`, reply names and `agent.actions` (`textDocument/rename` with `prepareRename`). Refuse when a name is built dynamically.
- **Code lens** (optional): "handled by model · emits EVENTS 'SAVED'" on intent keys.

### 1.6 Eval (E)

**E-1 Does in-editor feedback help agents?** (P2)

What earlier evals found (PHASE3 E1/E8):
- With `sygnal-check` installed, agents ran it unprompted (50/50) and it pointed at the planted bug first every time. But Opus found those bugs from the code anyway: no debug-time gain, time-neutral overall.
- Re-testing on a smaller model was recommended and never done.
- The MCP server's unprompted use was shallow, so it was dropped from the agent docs.

The plugin differs in one way: findings arrive *without the agent choosing to look*, mid-edit, on the line it just wrote.

**Hypothesis:** with the plugin, agents on smaller models introduce and keep fewer wiring bugs while *writing* features (not only on planted-bug debug tasks), so they need fewer failed test runs and iterations.

**Harness work** (D308, from 0-S2):
- a `plugins` variant field (a plugin directory passed with `--plugin-dir` for the Sygnal arm only; `--setting-sources project,local` isolates it correctly, and no flag is needed), recorded in the variant hash;
- a counter for diagnostics attachments read from the **stored session file** (`~/.claude/projects/<slug>/<session>.jsonl`), since the stream-json transcript never shows them; it records each finding's code, file, and whether it arrived **before the agent's last edit** (only those can change the outcome);
- task starters that are clean under `sygnal-check --strict`, so the plugin arm doesn't mostly measure findings in files the agent never touches (they are delivered too).

**What runs:** variant `e1-lsp` (`p6-final` + the plugin) against `p6-final`, on **Haiku and Sonnet**:
- the tier-1 feature tasks;
- the debug tasks 06, 07, 14;
- the p6 tier 44–47 (new code with `agent.actions` keys, where SYG150 bites).

Measure failed runs, iterations, wall time, cost, peak context, and the wiring bugs left in the final code.

**Spend:** estimated in Phase 0 and asked for before any run, as always. Dry runs only with a literal `--dry-run`.

**Decision rule** (P7-Q7):
- If failed runs or iterations drop by ≥ 20% on either model with no pass-rate loss, recommend the plugin in AGENTS.md (all templates), `integration/agents.md` and one skill line.
- Otherwise ship it for people only and keep it out of the agent docs, as with E8.

### 1.7 Docs (D)

**D-1 `integration/editors.md`** (new page, P1)
- VS Code (the extension, its settings, the config file);
- other editors (I-2's snippets);
- Claude Code (the plugin, what it installs);
- how the editor, the CLI, the Vite overlay and CI relate: same rules, same config.

**D-2 Updates** (P1)
- `integration/agents.md`: the plugin replaces "copy the skill folder" as the first option; copying stays as the fallback.
- The sygnal-check README: the `lsp` subcommand, the config file, `endLine`/`endColumn` in `--json`.
- `integration/bundler-config.md` (or wherever the Vite `check` option is documented): the config file as its default, if P7-Q3 accepts.
- The getting-started page: one line recommending the extension.
- No `llms.txt` change (editor tooling isn't API). CHANGELOG entries for sygnal-check and create-sygnal-app.

### 1.8 Not doing

- **A TextMate grammar, a formatter, a custom type checker, or our own TypeScript server.** TypeScript already covers JSX/TSX.
- **A TypeScript language-service plugin.** It is reconsidered only if N-2's completions feel second-class next to TS's own in VS Code (D-level decision then, not now).
- **An ESLint plugin.** The rules are cross-file and the CLI already covers CI. It is revisited only on user demand.
- **Runtime diagnostics in the editor** from the dev MCP endpoint (`get_diagnostics`). It is a possible follow-up: the server could subscribe to a running dev server and show runtime SYG codes at their source. It needs source locations in runtime diagnostics, which they don't have today.
- **Native JetBrains or Zed plugins**, beyond the settings snippets in I-2.
- **A web-based playground integration** (the docs' live editor). CodeMirror could talk to the server later, but the live examples already run `check-live`.

---

## 2. Phases

| Phase | Work | Detail |
|---|---|---|
| **0: Setup** (coordinator; spikes by subagents on `exp/p7-*`) | **0-A** baseline | Cut `plan7-integration` from `main`. Create `PLAN-7-status.md`, copy D297–D304 (§5) into it. Re-run the PoC and `bench.mjs` on the branch. Generate the large-project fixture for the latency gate (§3). Estimate E-1's spend for the user. |
| | **0-S1** ranges | Run C-2's audit as a spike: for each rule, which node it should underline, and how many need changes. Output: a table per rule, the effort for C-2, and any rule whose finding has no single good node. |
| | **0-S2** clients | Drive the PoC server from real clients: VS Code (a throwaway extension), Neovim, Helix, LSP4IJ, and Claude Code through a local plugin (`lspServers`). Record per client: does it use push or pull diagnostics, does it render `codeDescription` and `data`, does it send `didChangeWatchedFiles`, and how Claude Code surfaces the diagnostics to the model (after each edit, as a tool, both; any flag). Output: the capability matrix L-1 targets, and E-1's design. |
| | **0-S3** positions | Size N-1: which model structures already keep their nodes, and what's missing. Output: an estimate in days, for P7-Q6. |
| **1: Checker** | C-1, C-2, C-4, C-5 (parallel where files don't overlap; C-4 after C-2) then C-3 | Each with its own tests; `--json` schema and README updated; `fixFiles()` on top of C-4 with its tests unchanged. |
| **2: Server and clients** | L-1 + L-2; then V-1 and I-1 in parallel; I-2 setups; D-1/D-2; I-3 | L-1 targets 0-S2's matrix. **Release point:** sygnal-check 0.4.0, the extension 0.1.0, the plugin, create-sygnal-app 2.2.0 (and sygnal 6.1.1 if C-5 touches the Vite plugin). E-1's harness work can start in parallel. |
| **3: Measure** | E-1 | After the release point, with the user's go on spend. Report in `evals/agent-ergonomics/results/REPORT-v7.md`; apply the decision rule. |
| **4: Navigation (gated)** | N-1, N-2 | Only on P7-Q6's go. Release as sygnal-check 0.5.0 and extension 0.2.0. |

## 3. Gates

Every merge runs the existing gates:
- `npm run build:all`, `npm test` (vitest, examples, types, browser, perf gate), `npm --prefix sygnal-check test`;
- doc samples, error docs `--check`, the docs build, and `check-live` on Chromium, Firefox and WebKit;
- the size gate, the `llms.txt` limit;
- 0 findings from `sygnal-check --strict` on examples, templates and doc samples.

PLAN-7 adds:
- **Parity:** the server's diagnostics equal `check()`'s on every example app and fixture, for the default config and for `strict: true` (L-2).
- **No new runtime dependencies in `sygnal-check`:** `package.json` `dependencies` stays `@babel/parser` only (a test reads it).
- **Latency** (`sygnal-check/test/lsp-latency.vtest.js`, opt-in in `npm --prefix sygnal-check test` behind an environment flag, and run by the coordinator per phase):
  - a generated 20k-line project (40 components per 1k lines, the kanban shape repeated) re-checks after a one-file edit in **≤ 300 ms** warm with C-3;
  - a cold start is **≤ 2 s**;
  - the debounce plus the check stays **under ≈ 500 ms** from keystroke to diagnostics.

  The numbers get fixed in 0-A from measurements on the branch; afterwards they can only go down.
- **Robustness:** a fuzz test feeds every example file truncated at random points (unparseable mid-edit states) and requires that the server never throws, never drops other files' findings, and recovers when the text is whole again.
- **Templates:** each of the 10 templates has `.vscode/extensions.json` and the config file, and `sygnal-check` on a freshly scaffolded project reads the config (`create-sygnal-app` tests).
- **Extension:** the `@vscode/test-electron` smoke test passes in CI before any Marketplace publish (not in `npm test`).
- **Snippets** are `--strict` clean (a test extracts them).

## 4. Diagnostic code reservations

None. The plan adds no runtime or static codes. A malformed config file (C-5) is reported as SYG900 on that file, with a message naming the key. If a dedicated code turns out to be clearer, take the next free code in the 9xx range and follow CLAUDE.md's steps.

## 5. Decisions before Phase 1

The user accepted every recommendation on 2026-10-10 (D297–D304); 0-A copies them into `PLAN-7-status.md`.

| # | Question | Recommendation |
|---|---|---|
| P7-Q1 | Release | **User, 2026-10-10: accepted (D297).** **sygnal-check 0.4.0, create-sygnal-app 2.2.0, extension 0.1.0**; `sygnal` 6.1.1 only for P7-Q3's Vite default. N- items (if any) as sygnal-check 0.5.0 / extension 0.2.0. |
| P7-Q2 | Where the server lives | **User, 2026-10-10: accepted (D298).** **Inside `sygnal-check` as `sygnal-check lsp`, hand-written** (as `mcp` is), not a separate `sygnal-language-server` package on `vscode-languageserver`. One version to keep in step with the rules, `npx --no-install sygnal-check lsp` works wherever the CLI does, and the dependency list stays `@babel/parser`. The protocol surface we need (lifecycle, sync, publish/pull diagnostics, hover, code actions, later completion/definition/rename) is small, and a client library checks conformance in tests. |
| P7-Q3 | Shared config | **User, 2026-10-10: accepted (D299).** **Add `sygnal-check.config.json` / the `package.json` `"sygnal-check"` key (C-5), and let the Vite plugin's `check` option default to it.** Without it, the editor and the Vite overlay can disagree (the overlay takes `strict` from `diagnostics.strict` in `vite.config`, which the server must not evaluate). Cost: a `sygnal` patch release. The alternative (editor settings only) is less code and guarantees drift. |
| P7-Q4 | Extension identity and publishing | **User, 2026-10-10: accepted (D300).** **Publisher `sygnal` (or the user's existing one), extension id `sygnal.sygnal`, source in `editors/vscode/`, published to the VS Code Marketplace and Open VSX by the user**, with `vscode-languageclient` bundled in the `.vsix` (D209 covers npm builds; an extension can't do otherwise). The user creates the publisher accounts and keeps the tokens; agents never publish. |
| P7-Q5 | Which `sygnal-check` the extension runs | **User, 2026-10-10: accepted (D301).** **The workspace's copy first, the bundled copy as a fallback with a visible note.** The editor matches the project's CLI and CI version; projects without `sygnal-check` (or with an older one) still get diagnostics. |
| P7-Q6 | Navigation and completions (N-1/N-2) | **User, 2026-10-10: accepted (D302).** **Gate them after Phase 2.** Decide on 0-S3's estimate and first-release feedback. The diagnostics, hover and fixes carry most of the value the research found. |
| P7-Q7 | E-1 eval and its decision rule | **User, 2026-10-10: accepted (D303).** **Run it on Haiku and Sonnet, after the release point, with spend approved first.** Recommend the plugin in agent docs only on ≥ 20% fewer failed runs or iterations with no pass-rate loss (E1/E8 showed tools agents *can* use don't help Opus on planted bugs). |
| P7-Q8 | The Claude Code plugin's contents | **User, 2026-10-10: accepted (D304).** **The LSP server plus the `sygnal-dev` skill; the MCP server not enabled by default.** The skill finally gets a one-step install; E8 showed the MCP server isn't worth the agent's attention by default. |

## 6. Risks

| Risk | Mitigation |
|---|---|
| Ranges are wrong or too wide, so squiggles look sloppy | 0-S1's audit per rule; a range snapshot test per rule fixture (C-2) |
| Whole-project checks get slow on large apps | C-3 parse cache; the latency gate on a generated 20k-line project; if a real app exceeds it, scope the rules that are per-component to the changed files' components (incremental rules are a later item, not built speculatively) |
| Mid-edit, unparseable files cause flicker (findings vanish and reappear) | Keep the last good findings for a file whose new text doesn't parse, **unchanged** (no "stale" marker in the message: Claude Code would deliver the changed text as a new finding), until it parses again. 0-S3: every syntax-breaking edit fails to parse, so this is the normal path, not an edge case. The fuzz gate |
| The editor and CI disagree | One rules source; the parity gate; the shared config (P7-Q3); the extension prefers the workspace's `sygnal-check` (P7-Q5) |
| Claude Code's plugin LSP support changes or needs a flag | 0-S2 recorded 2.1.287's behaviour (no flag; delivery as a system reminder after the next tool result); recheck at each phase start; I-1 is a manifest, cheap to adjust; the plugin's skill works without the LSP |
| False positives become more visible in the editor than in the CLI | Info stays hidden by default (as in the CLI); the suppress action; findings that fall back to info today (dynamic classes, spreads) stay info |
| Two new release channels (Marketplace, Open VSX) add maintenance | The extension is a thin client: its version moves only for client changes; the rules ship through npm with `sygnal-check`; a RELEASING.md section with the exact steps |
| Agents get noise from diagnostics on half-written code, or on files they never touched (0-S2: Claude Code delivers those too) | E-1 measures it on clean starters; each identical finding is delivered once per session; Claude Code delivers after an edit, not per keystroke; if it hurts, the plugin sets `diagnostics: false` or ships without `lspServers` for agents |
