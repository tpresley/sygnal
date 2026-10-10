# PLAN-7 Status Tracker

Tracks progress for [PLAN-7.md](PLAN-7.md) (editor tooling: `sygnal-check lsp`, the VS Code extension, the Claude Code plugin). The coordinator maintains it.

**Numbering:** decisions continue from **D297** (D297–D304 below), gaps from **G-657**.

**Integration branch:** `plan7-integration`, cut on 2026-10-10 at `eb208337` (= `main` `b02eb715` merged into the research branch `claude/sygnal-ide-plugins-research-4d5a79` at `2831b13e`, + the research, the plan and D297–D304), in the worktree `.claude/worktrees/sygnal-ide-plugins-research-4d5a79`. `origin/main` had no newer commits at the cut. Spikes run in agent worktrees on `exp/p7-s1` … `exp/p7-s3`.

**State:** Phase 0 complete (2026-10-10). Phase 1 complete (2026-10-10). **Phase 2 in progress** (started 2026-10-10): wave A = L-1/L-2 (server), G-660 (AST walk speed), I-3 (templates) in parallel; wave B after L-1 = V-1, I-1 (+ G-658's debug run), I-2; wave C = D-1/D-2.

## Decisions

| # | Date | Decision |
|---|---|---|
| D297 | 2026-10-10 | P7-Q1: release as sygnal-check 0.4.0, create-sygnal-app 2.2.0, VS Code extension 0.1.0; `sygnal` 6.1.1 only for the Vite plugin's config default (D299); N- items as sygnal-check 0.5.0 / extension 0.2.0 |
| D298 | 2026-10-10 | P7-Q2: the server lives in `sygnal-check` as `sygnal-check lsp`, hand-written like `mcp`; `dependencies` stay `@babel/parser` only; a client library checks conformance in tests |
| D299 | 2026-10-10 | P7-Q3: a shared JSON config (`sygnal-check.config.json` or the `package.json` `"sygnal-check"` key) read by the CLI, MCP, the server, and as the default of the Vite plugin's `check` option |
| D300 | 2026-10-10 | P7-Q4: extension id `sygnal.sygnal` (publisher `sygnal` or the user's existing one), source in `editors/vscode/`, `vscode-languageclient` bundled in the `.vsix`; Marketplace + Open VSX; the user owns the publisher accounts and publishes |
| D301 | 2026-10-10 | P7-Q5: the extension runs the workspace's `sygnal-check` first, the bundled copy as a visible fallback |
| D302 | 2026-10-10 | P7-Q6: navigation and completions (N-1/N-2) are gated after Phase 2, on 0-S3's estimate and first-release feedback |
| D303 | 2026-10-10 | P7-Q7: E-1 runs on Haiku and Sonnet after the release point, spend approved first; the plugin goes into agent docs only on ≥ 20% fewer failed runs or iterations with no pass-rate loss |
| D304 | 2026-10-10 | P7-Q8: the Claude Code plugin ships the LSP server and the `sygnal-dev` skill; the MCP server is not enabled by default |
| D305 | 2026-10-10 | Coordinator (0-S2): L-1 pushes diagnostics only in 0.4.0. VS Code shows every finding twice when offered push and pull; pull covers open documents only, which loses cross-file findings; Claude Code has no pull. Pull with `workspace/diagnostic` only later, as an opt-in that turns push off. Plus the protocol details in PLAN-7 L-1 (dynamic registration, per-folder configuration re-read, `workspaceFolders` read regardless, `-32800`, exit on stdin end) |
| D306 | 2026-10-10 | Coordinator (0-S2): check immediately on `didSave` (debounce only keystroke `didChange`); publish only changed files plus cleared ones; sort by severity; fast `[]` for automatic code-action requests |
| D307 | 2026-10-10 | Coordinator (0-S2): the plugin puts `lspServers` inline in `plugin.json` with `"settings": {}`; finding messages stand alone (Claude Code drops `codeDescription`, `relatedInformation` and `data`); last good findings of an unparseable file stay unchanged (no stale marker in the text) |
| D308 | 2026-10-10 | Coordinator (0-S2): E-1 counts diagnostics attachments from the stored session file (not stream-json), records whether each arrived before the agent's last edit, and uses `--strict`-clean starters; `--plugin-dir` + `--setting-sources project,local`, no flag |
| D309 | 2026-10-10 | Coordinator (C-5): config discovery walks up from `cwd` to the first directory holding `sygnal-check.config.json` or `package.json` and stops there; both present → the config file wins (info SYG900 on `package.json`); config `paths` are relative to the config file's directory; an explicit option replaces the config value (lists aren't merged); a malformed chosen file means defaults (no fallback to the `package.json` key) |
| D310 | 2026-10-10 | Coordinator (C-5): config problems are SYG900 findings on the config file (malformed / unknown key / wrong type: warn; both files: info), not a new code; SYG900's explanation is widened to say so. The CLI has `--config <file>` and `--no-config` but no `--no-strict` (a config's `strict: true` is turned off only with `--no-config`; the API and MCP can pass `strict: false`) |
| D312 | 2026-10-10 | Coordinator (C-4): diagnostics carry `fixes: [{ title, kind, preferred?, fixAll?, edits }]` beside the human `fix` text; `fixAll` marks what `--fix` applies (never "did you mean" guesses or stubs); `--fix` applies exactly the editor's `fixAll` edits; an insertion touching another fix's edit waits for the next pass; per-selector controls conversions come from `controlFixes()` (no diagnostic, no new code); L-1's `source.fixAll.sygnal` calls `fixFiles(…, { sources })` rather than concatenating per-finding edits |
| D311 | 2026-10-10 | Coordinator (C-5): Vite precedence = explicit `check.*` → config file → `diagnostics.strict`/`ignore`; `include` resolved once at startup (a `paths` change needs a restart; other keys re-read per check); config files changing trigger a re-check; an older sygnal-check without `loadConfig` gets exactly today's options (feature-detected). Needs sygnal 6.1.1 (D297) |

## Phase tracker

| Item | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 0-A | Baseline: integration branch, this file, PoC + bench re-run, large-project fixture, E-1 spend estimate | ✅ | `plan7-integration` | — | Below: [0-A results](#0-a-results) |
| 0-S1 | Ranges audit per rule | ✅ report copied | `exp/p7-s1` | `6cba0435` | [`0-S1.md`](research/p7-spikes/0-S1.md). 39 rules, 58 codes from 74 report sites: 45 already on the right node, 10 trivial, 3 small (SYG152/422/609), 1 with no node (SYG900 for a rule crash: log it, or line 1). All rules report through one `report({ node })`, so the runner adds `endLine`/`endColumn` from `node.loc.end` (exclusive, UTF-16, as LSP). Prototype adds `endNode` (end the range early: `<img`, not the whole tag) and `anchor` (the old wider node; `sygnal-ignore` comments keep matching its line: narrowing moves the start line of SYG731/152/422). sygnal-check suite 714/714 on the prototype (verified by the coordinator), no snapshot changes. **C-2 ≈ 1.5 days (≈ 2 with `related`)**. The `sygnal-check/src` prototype stays on `exp/p7-s1` for C-2 to cherry-pick (minus the spike's `SYGNAL_RANGE_LOG` hook) |
| 0-S2 | Client capability matrix (VS Code, Claude Code; Neovim/Helix/LSP4IJ from docs, not installed) | ✅ merged | `exp/p7-s2` | `002fba1f` | [`0-S2.md`](research/p7-spikes/0-S2.md). VS Code 1.138 headless against the installed app (nothing downloaded): supports all L-1 needs, but push + pull → duplicates; `codeDescription`/`relatedInformation`/`data` survive into code actions; watchers and config changes need dynamic registration; settings need `scope: resource`. Claude Code 2.1.287: push only, no code actions, no flag; findings arrive as a `<new-diagnostics>` reminder on the next request after a tool result, once per identical finding, ≤ 10/file, ≤ 30/attachment, untouched files included; links and `data` dropped. Neovim/Helix/LSP4IJ snippets from docs, untested. 4 Haiku runs, **$0.14**. Amendments: D305–D308; open: G-658 |
| 0-S3 | Positions for N-1/N-2: estimate | ✅ merged | `exp/p7-s3` | `82a3f797` | [`0-S3.md`](research/p7-spikes/0-S3.md). Action occurrences already keep their nodes (289/289 located on 3 examples); missing: view class/id token offsets (largest), `calculated`/`context` keys, behavior definitions' actions, `CHILD.select`, a range helper. Babel `errorRecovery` gives 0% on syntax-breaking edits; a repair suffix at the cursor → 100% on realistic mid-edit cases; text-before-cursor + last good AST → 100% (99% truncated). Estimate **≈ 15 days (11–19)**: N-1 5, completions 4, definition/references 2, rename 3, code lens 1. Order: completions → actions N-1 + definition/references → code lens → rest of N-1 → rename (≈ 7 days for the first two). Input for P7-Q6 (D302) |

| C-1 | In-memory sources (`sources` option) | ✅ merged | `p7-c1` | `80fff553` (merge `b935adb4`) | `sources` (Map or object; keys resolved against `cwd`) on `check`/`checkFiles`/`buildProject`/`graph`/`graphFiles`; `Project.loadFile` reads it first; `resolveImport(…, { isFile })` sees source-only files; `expandInputs` picks source-only files under directory/glob inputs with the walk's filters. `fixFiles()` unchanged (C-4 must make `sources` first-class there or strip it: today it would apply buffer offsets to disk text). An overlay can't hide a file still on disk (LSP: tombstones if "deleted in editor" is needed). `fixControls.js` still reads disk. sygnal-check 714 → 725 |
| C-2 | End ranges (+ `related`) | ✅ merged | `p7-c2` | `6fe07637` | `endLine`/`endColumn` (1-based, exclusive, UTF-16) on every diagnostic from the runner; `report()` gains `endNode`, `anchor` (suppressions also match its line), `related`. The 13 codes from 0-S1 converted; SYG422 via a new `specCheck()` in `model/timers.js`. A rule crash's SYG900 keeps no range (`file: ''`, line 0). `related` on SYG104 (child tag + the rendering attribute in the child, new `renderedAt()` in `model/view.js`), SYG105 (a close-named counterpart only), SYG128, SYG129, SYG440, SYG609/643 (the `run` callee); skipped: SYG104 via hyperscript, SYG441, SYG724. `--json`, graph diagnostics, `inspect.schema.json` (`relatedLocation`), README "JSON output", and the static types in `checks/public.d.ts` (+ `InspectRelatedLocation`). A range assertion for all 57 rule codes (`test/fixtures/ranges/cases.json`, coverage test). Snapshots unchanged. sygnal-check 725 → 805 after merge; build, `test:types`, doc samples, error docs, vitest green |
| C-3 | Parse cache + latency gate | ✅ merged | `p7-c3` | `337f2180` (merge `09cc3f35`) | `src/cache.js`: `ParseCache` / `createParseCache({ freeze? })`; `options.cache` on `check`/`checkFiles`/`buildProject`/`graph*`; caches `{ text, ast, parents, suppressions }` or a parse failure per path, reused on identical text; FileInfo, components and the model rebuilt per build; eviction at build start (entries the previous build didn't use); MCP keeps one for its life, CLI none. **Three per-build leaks through module-level WeakMaps keyed by AST nodes fixed** (`model/behaviors.js` `defCache`, `model/widgets.js`, `rules/a11y/shared.js` `described`), with a leak-detector test; no rule mutates ASTs (frozen-AST parity over all fixtures and examples). One-file edit at 20k lines: 351 → **272 ms** (gate ≤ 300 ms: ≈ 10% headroom, G-660); 50k: 751 ms. `test/lsp-latency.vtest.js` (`SYGNAL_CHECK_LATENCY=1`) passes on the merged branch. Conflicts with C-5 in `mcp.js`/README resolved by the coordinator (MCP tools pass the cache through the config-aware path). sygnal-check 863 + 1 skipped |
| C-4 | Fixes as edits | ✅ merged | `p7-c4` | `ec67f281` (merge `ca4c7119`) | `fixes` on diagnostics (D312), in `--json`, graph diagnostics, schema (`fix`, `textEdit`), `public.d.ts` (`InspectFix`, `InspectTextEdit`; type test `p7-c4-fixes.ts`). Fixes: "did you mean" for SYG110, 112, 127, 140, 141, 142, 150, 151, 223, 226, 641, 707 (preferred); SYG105 rename (not preferred); `fixAll` SYG504/505/506/612 with import edits; SYG101 model stub (quickfix), SYG102 removal (refactor). `fixFiles()` re-expressed on the `fixAll` edits, byte-identical to pre-C-4 goldens on disk and through `sources`; with `sources` it writes nothing and returns `texts` + `edits`; `convertControls` honours `sources`; `controlFixes()` new. Test file written after the code (deviation): run against the pre-C-4 checker, 29/34 failed and the 5 golden checks passed. Conflicts with C-3/C-5 (docs only) resolved by the coordinator. sygnal-check 899 + 1 skipped |
| C-5 | Shared config (CLI, MCP, Vite default) | ✅ merged | `p7-c5` | `bb78461a` (merge `42bdd3df`) | `src/config.js`: `loadConfig`, `resolveOptions`; keys `strict`, `a11y`, `ignore`, `paths`, `includeTests` (+ `$schema` ignored). `check()`/`graph()` apply it (inputs omitted → config `paths`); `checkFiles()`/`graphFiles()` read none. CLI `--config`/`--no-config`; MCP `check`/`graph` re-read it per call; Vite precedence D311. Docs: README "Configuration", `integration/bundler-config.md`. D309–D311. Merge conflicts with C-1 in `index.js`/`graph.js`/README resolved by the coordinator (config-aware `check()`/`graph()` pass `sources` through). 44 + 7 tests; sygnal-check 849 after merge |

**Phase 1 baseline** (`plan7-integration` at `752e3516`, before any Phase 1 merge, full worktree setup): `npm test` green: vitest 4,315 passed / 33 skipped (406 files), the 12 example suites, types, perf gate, browser 375/375 (Chromium) + WebMCP native 22/22, polyfill 22/22, none 1/1; `npm --prefix sygnal-check test` 714/714; doc samples 777 clean; error docs up to date. After C-1: sygnal-check 725/725, doc samples clean, vitest unchanged.

| L-1/L-2 | `sygnal-check lsp` + tests | running | `p7-l1` | | worker-thread checks (G-657), push only (D305), 0-S2 requirements |
| G-660 | AST walk speed | running | `p7-g660` | | `ast.js` only |
| I-3 | Templates: `.vscode/extensions.json`, `sygnal-check.config.json` | ✅ merged | `p7-i3` | `e2cf502d` (merge `f5cd06d7`) | All 10 templates: `{"recommendations":["sygnal.sygnal"]}` and `{"strict": true}` (vike/vike-ts add `"paths": ["pages"]`, matching their AGENTS.md; mcp-app checks `src` only, as its AGENTS.md). `npm pack` includes both; the scaffolder copies dot entries as-is. sygnal-check 0.3.0 never opens the file (its walker collects only JS/TS). `test/create-sygnal-app-templates.test.js` (22: pack, scaffold all 10 offline with a prompt stub, `loadConfig`/`check()` match AGENTS.md's command, 0 findings). RELEASING.md: the templates' `sygnal-check` range must go to `^0.4.0` for the config to take effect; with 0.4.0 the dev overlay runs strict from the config. Root vitest 4,344 / 33 skipped after merge |
| V-1 | VS Code extension | waiting for L-1 | | | |
| I-1 | Claude Code plugin (+ G-658) | waiting for L-1 | | | |
| I-2 | Other editors | waiting for L-1 | | | G-659: installs need the user's OK |
| D-1/D-2 | Docs | waiting for V-1/I-1 | | | |

## 0-A results

**PoC re-run** on `plan7-integration` (sygnal-check 0.3.0): unchanged behaviour. 3 findings on open, hover with SYG110's explanation, `Change to '.inc'`, 0 findings after the unsaved fix; 3–24 ms per check on the fixture.

**Large-project fixture:** [`research/p7-spikes/0-A/gen-large.mjs`](research/p7-spikes/0-A/gen-large.mjs) copies the kanban, plan5-showcase and ai-panel-spa `src/` trees (tests excluded) round-robin to a target size; generated on demand, not committed. [`bench-latency.mjs`](research/p7-spikes/0-A/bench-latency.mjs) measures a whole-project check (cold = first check in the process; warm = median). Apple M3 Max, Node 24.14.0, `--strict`:

| Project | Files | Lines | Cold | Warm | Warm: build (parse + model) | Warm: rules |
|---|---|---|---|---|---|---|
| examples/kanban | 5 | 1.1k | 27 ms | 8 ms | 4 ms | 4 ms |
| examples/ai-panel-spa | 13 | 2.0k | 53 ms | 26 ms | 12 ms | 15 ms |
| examples/plan5-showcase | 50 | 2.2k | 82 ms | 45 ms | 18 ms | 27 ms |
| generated, 14 copies | 327 | 20.8k | 427–437 ms | 345–362 ms | 134–140 ms | 214–223 ms |
| generated, 34 copies | 753 | 50.3k | 993 ms | 870 ms | 321 ms | 549 ms |

Without `--strict` the 20k project is the same within noise (379 ms warm). The process start plus import plus one check of the 20k project is 0.50–0.51 s wall.

Findings:
1. **Linear scaling, ≈ 17 ms per 1k lines warm, of which ≈ 11 ms is rules.** C-3's parse cache removes most of the build share on a one-file edit, so the 20k project should re-check in ≈ 230 ms, within the planned **≤ 300 ms** gate. Cold start (≈ 0.5 s) is far inside **≤ 2 s**. Keystroke to diagnostics, with a 150 ms debounce, should be ≈ 380 ms, inside **≈ 500 ms**. The §3 numbers stand; 0-A fixes them as the gate's starting limits.
2. **Rules alone pass 300 ms at about 27k lines** (550 ms at 50k). Beyond that, PLAN-7 §6's mitigation applies (scope per-component rules to the changed files' components). Not built speculatively.
3. **A check blocks Node's event loop for its whole duration** (≈ 360 ms at 20k). Hover, code-action and completion requests that arrive mid-check would wait. Proposed amendment to L-1: run checks in a `worker_thread` (the main thread keeps the documents and answers requests from the last results), or at least check `$/cancelRequest` and pending changes between files. Decide in Phase 2 with 0-S2's client behaviour; recorded as **G-657**.

**E-1 spend estimate** (asked for again before any run, D303; the costs per trial are from REPORT-v5/v6, Sygnal arm):

| Model | Tasks | Trials | Cost per trial | Estimate |
|---|---|---|---|---|
| Sonnet 5.5 | tier 1 (01–08) + 14 | 9 tasks × 5 × 2 variants = 90 | ≈ $0.15–0.22 | $14–20 |
| Sonnet 5.5 | 44–47 | 4 × 5 × 2 = 40 | ≈ $0.29 | ≈ $12 |
| Haiku 5.5 | pilot (G-653: no Haiku 5.5 records on tier 1) | 8 | unknown, ≈ $0.8–1.5 | $6–12 |
| Haiku 5.5 | tier 1 + 14, 3 trials | 9 × 3 × 2 = 54 | ≈ $0.8–1.5 (pilot decides) | $43–81 |
| Haiku 5.5 | 44–47, `e1-lsp` only (control: the 20 Sygnal trials of `p6-final-haiku` on the PLAN-6 final build; reuse only if the `e1-lsp` build differs from it in sygnal-check alone) | 20 | ≈ $1.80 | ≈ $36 |
| **Total** | | **212** | | **≈ $111–161** |

Cheaper variants if needed: Sonnet only (≈ $26–32), or Haiku only on the debug tasks 06, 07, 14 (≈ $15–27). The run happens in Phase 3, after the release point.

## Gaps

| # | Found | Severity | Area | Gap | Status |
|---|---|---|---|---|---|
| G-657 | 0-A | med | L-1 | A whole-project check blocks the server's event loop (≈ 360 ms at 20k lines), delaying hover/code actions/completions | Open → Phase 2. C-3: the parse cache can't cross a thread (AST class instances, WeakMaps), so the worker owns the cache and runs checks; the main thread sends `{ path: text }` overlays and keeps the last results for hover/code actions; one cache per workspace folder, builds never interleave on one cache |
| G-658 | 0-S2 | med | I-1 / E-1 | Claude Code didn't deliver a finding left in the edited file after the agent's last edit (runs 3 and 4; in run 4 the server had published it before the tool result). Unexplained from the bundled code | Open → Phase 2: one `--debug-file` run (≈ $0.03) before E-1 |
| G-660 | C-3 | low | sygnal-check perf | The latency gate passes with ≈ 10% headroom (272 ms vs 300 ms at 20k lines). Profile: `ast.js` `walk`/`childNodes` ≈ 70% of self time (every rule walks every file); a per-node-type child-key table is the proposed fix (a per-node WeakMap gave ≈ 240 ms but slowed cold runs) | Open → before the 0.4.0 release, or with L-1 |
| G-659 | 0-S2 | low | V-1 / I-2 | Neovim, Helix and JetBrains (LSP4IJ) setups are written from docs and untested (not installed on this machine) | Open → Phase 2 (I-2): install and test, with the user's OK |

## Log

- 2026-10-10: C-4 merged; CHANGELOG `[Unreleased]` written. **Phase 1 complete.** Final gate on `plan7-integration` green: build; sygnal-check 899 + latency gate; `npm test` (vitest 4,322 / 33 skipped, examples, types, browser, perf gate); doc samples 777 clean; error docs; size gate OK (unchanged); docs build; check-live 91/91 on Chromium, Firefox and WebKit. Next: Phase 2 (L-1 server with G-657's worker design, then V-1/I-1, I-2, D-1/D-2, I-3; G-658 and G-660 before the release point).

- 2026-10-10: Phase 1: C-1, C-2, C-5 merged (full gate green after C-5: npm test, check-live 91/91 × 3 engines); C-3 merged (latency gate green, G-660); SYG900's explanation widened for config findings (D310; explanations.json and the error reference regenerated). C-4 running.

- 2026-10-10: 0-S2 merged (`fe88cb7f`); PLAN-7 amended for its findings (L-1 push only and protocol details, `didSave` checks, V-1 resource-scoped settings, I-1 manifest and self-contained messages, E-1 measurement from session files) as D305–D308; G-658, G-659 opened. **Phase 0 complete.** Spend so far: $0.14 (0-S2's four Haiku runs).

- 2026-10-10: 0-S1 done; report and scripts copied to `plan7-integration` (the source prototype stays on `exp/p7-s1` for C-2). Additions for Phase 1: C-2 takes the prototype's `report()` shape (`endNode`, `anchor`) and adds range assertions before narrowing more rules; an optional `related: [{ node, file, message }]` on `report()` (≈ 0.5 day) feeds LSP `relatedInformation` for pair and cross-file findings (SYG104/105/128/129/440/441/609/643); SYG505's range equals its `--fix` edit, reusable by C-4; recoverable syntax errors produce no SYG900 (errorRecovery).

- 2026-10-10: 0-S3 merged (`fdfcb329`). Two notes for L-1 beyond N-: mid-edit syntax errors are the normal state of a file being typed (so §6's "keep the last good findings, marked stale" is required, not optional), and Babel columns are UTF-16 code units like LSP positions (no conversion).

- 2026-10-10: Phase 0 started. `plan7-integration` cut at `eb208337`. 0-A done (above). Spikes 0-S1, 0-S2 and 0-S3 started in agent worktrees. Neovim, Helix and JetBrains IDEs aren't installed here, so 0-S2 drives VS Code and Claude Code and documents the others from their docs.
