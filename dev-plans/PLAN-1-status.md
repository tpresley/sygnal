# PLAN-1 Status Tracker

Tracks progress for [PLAN-1.md](PLAN-1.md). Maintained by the coordinator.

**Integration branch:** `worktree-agent-ergonomics` · **Current phase:** 0 · **Last updated:** 2026-09-30

---

## Phase Overview

| Phase | Status | Tag | Notes |
|---|---|---|---|
| 0 — Foundations | ✅ Done | `plan1-phase0` | 0A ✅ · 0B ✅ · 0C ✅ · review: 9 findings, all fixed. Baseline eval still running (independent of merges; uses the pre-0B tarball) |
| 1 — Core capabilities | ✅ Done | `plan1-phase1` | 1A–1H ✅ · review: 11 findings + 2 minor, all fixed in 1H |
| 2 — Strictness, introspection, integration | 🟡 In progress | — | 2A ∥ 2C running; then 2B; then 2D (D30) |
| 3 — Agent context & docs | ⚪ Not started | — | |
| 4 — Measure & release | ⚪ Not started | — | |

Legend: ⚪ not started · 🟡 in progress · 🔵 in review / merging · ✅ done · 🔴 blocked

## Workstreams

| ID | Title | Status | Branch | Agent | Merged | Notes |
|---|---|---|---|---|---|---|
| 0A | Baseline eval harness | ✅ | (applied as patches) | subagent | `8ed8145..cb9fdf0` | verify.mjs 28/28 OK, rerun by the coordinator. Agent couldn't run in its worktree (G-004), so it built in scratch and sent patches; the coordinator reviewed them (all paths under `evals/`, every rm scoped) and applied with `git am` (D6) |
| 0B | Diagnostics infrastructure (+ fix B-001) | ✅ | `worktree-agent-adfffb626c0498aa1` | subagent | `18b3895` | B-001 fixed in `rollup.config.dts.mjs` (dts pre-plugin feeds emitted declarations). 9 labeled hook sites in `component.ts`. Vite dev flag via entry transform (D14). +1,464 B gzip (D13). First launch was BLOCKED by G-004 |
| 0B-fix | Phase 0 review fixes (9 findings + B-007) | ✅ | `worktree-agent-ab7cee6006bd3f5ad` | subagent | `44daa86` | Diagnostics never throw synchronously into streams (async rethrow in 'error' mode). run() resets the diagnostics config. `build` bundles types; `prepublishOnly` added. dts errors surface. Vite: directive/shebang-safe flag with sourcemap; B-007 fixed |
| 0C | Canonical-forms spec | ✅ | (coordinator, direct) | coordinator | this commit | [PLAN-1-canonical-forms.md](PLAN-1-canonical-forms.md) |
| 1A | Runtime consistency checks | ✅ | `worktree-agent-a143cfc2f9e1c19f7` | subagent | `5ee2339` (+`46d47de` integration fix) | Dev-only `sygnal/diagnostics` entry (9.4 KB gz, not in apps). SYG101/102 wiring, SYG103/104 selector + isolation boundary (real DOM via IsolateModule/ScopeChecker), SYG105 bus, SYG106 reserved-prop collision (G-007), SYG201/202 reducer shape, SYG301 RxJS hints (~37 operators, via Stream.prototype), SYG401 collection `from`. New hooks onSelector/onBusEmit/onBusSelect. Kanban run with real interactions: 0 diagnostics. Applied the enrichEventStream guard |
| 1B | Typed links (+ new `event()` helper) | ✅ | `worktree-agent-a757e118d8adfa9c2` | subagent | `b75616b` | ActionsOf, IntentSources, SygnalEvents registry (works against bundled dist), typed CHILD.select via ParentPayloadOf, Collection `from` constraint, `event()`; `emit()` now built on event(). +75 B. Selector typing: not feasible in TS (static checker covers it) |
| 1C | DOM-level test helpers | ✅ | `worktree-agent-a34b49bec89b36448` | subagent | `37de27d` (+`f8a0ec2` integration fix) | Enriched mock DOM (B-006), simulateEvent with vnode targeting + bubbling + isolation, buffered early calls + ready() (G-016), simulateAction drives all sinks via the real intent + sinkValues/emitted (G-015), no synthetic `__TEST_ACTION__` (G-013), diagnostics option + expectNoDiagnostics, html(), testing.ts type errors fixed (G-012). Whole-file +1,656 B, but **0 B** in the tree-shaken kanban bundle (D18) |
| 1D | Static checker `sygnal-check` | ✅ | `worktree-agent-a61372bf822366ee4` | subagent | `679e60f` | Rules SYG101/102/104/105/110/401 + SYG900, suppression comments, extensible rule modules and a project model (ready for 2A strict, 2B graph). 0 diagnostics on all examples and templates; catches eval tasks 06/07; kanban in 0.06 s. 46 package tests (`*.vtest.js`, not collected by the root) |
| 1E | Error-message retrofit | ✅ | `worktree-agent-a4b674c8f269ce1e4` | subagent | `781f119` (+`65dd5fc` integration) | ~55 call sites coded (SYG206–220, 402–420, 601–607, 901–903, plus 1A's SYG401). New `diagnostics/legacy.ts`: production ('off') still prints, now with codes; enabled modes route through report(). Corrected misleading texts (a bad Collection `from` renders **nothing**; it doesn't use the parent state). Pragma's SYG420 is a literal (the JSX runtime is bundled separately). Kanban +286 B |
| 0A-H | Harder eval tier (tasks 09–12) + harness fixes | ✅ | `worktree-agent-ab48f9e4d3b40f38e` | subagent | `6b79fbc` | 4 tasks × 2 arms, 30 hidden tests, verified 44/44 on the baseline tarball and HEAD, no flakes in 32 reruns, mutants caught. Fixed G-009 and G-017. Found B-010, B-011, B-012 |
| — | Tier-2 baseline run (`baseline-t2`) | ✅ | — | coordinator | `24e3641` | 40/40 pass. Sygnal 92 s / 4.5 iterations vs React 63 s / 2.5 (~1.46×). Ceiling persists; Phase 4 measures efficiency |
| — | Friction analyzer | ✅ | `worktree-agent-ad1b61c716442470a` | subagent | `8155e72` | 110 trials, 100% wall-time attribution, 27 unit tests. **B-007 alone is 20% (tier 1) / 41% (tier 2) of the Sygnal−React delta**; framework/tooling defects during self-testing ~40%; learning from library source ~9 s per trial (React 0). Recommendations folded into 3A/3B/4A (D27) |
| 1H | Phase 1 review fixes | ✅ | `worktree-agent-a23df24e3ee6d7cb4` | subagent | `0198550` | All 13 fixed with regression tests. Sinks synchronous unless a same-tick reducer is pending; INITIALIZE-only delay; reducers use fresh state + `withCalculated` lens; isolated child gets its own state stream. Kanban +162 B. Was: | 11 findings + 2 minor. Highest: B-003 made all non-STATE sinks async (breaks `preventDefault` in an EFFECT and gesture-bound effects). Also: renderComponent hides errors in collect mode; B-013 misses nested children; ready() hang (model, no initialState); overlapping diag mode; errors(selector) swallowing; controlled module scope; SYG111 literals; B-008 parent-copy perf |
| 1G | Rendering/state bug fixes + B-004 warning | ✅ | `worktree-agent-a832977a4a01b8857` | subagent | `a6caabf` | Fixed B-010 (pickCombine detects permutations; item identity kept), B-011 (snabbdom-valid text vnodes), B-012 (className module clears removed classes; className + `class={{}}` combine), B-013 (collection items reduce from fresh state), G-028, G-018 (`data-sygnal-ready` only while not ready). SYG111 static rule (one true positive: kanban `.lane-title-input`, left for 2D). Each fix had a failing test first. Kanban +504 B |
| 1F | Framework bug fixes | ✅ | `worktree-agent-a33bebfd10cbeb13b` | subagent | `52e3f91` | Fixed B-003 (per-action state snapshot for non-STATE sinks), B-004 (controlled-input module; D25), B-005 (`errors()` source method; null results delivered; D26), B-008 (isolated child keeps a per-instance slot), B-009 (reproduced; collection-scoped item ids), G-020, G-024 (renderComponent reports SYG104/SYG103 itself), G-025 (+ fixed a crash for a props-less `.components` element), G-026 (+ `from={null}` crash). 28 new tests, each failing before its fix. Kanban +194 B |
| 2A | Strict mode | ✅ | `worktree-agent-afd0cd5cf66506ba3` | subagent | `b88fcf1` | SYG501–507 static (`--strict`); runtime SYG501/502/504 via the dev entry (`configureStrict`, `__SYGNAL_STRICT__`, `renderComponent({strict})`); `--fix` for SYG504/505/506 (idempotent). Example hits: 21 (mostly SYG502 `return state`, SYG505 `emit()`, SYG501 in 2048). Kanban +0 B |
| 2B | Inspect | 🟡 | (harness-assigned) | subagent | — | Runtime `inspect()` in the dev entry (0 B), `sygnal-check --graph` (same JSON schema), `explain <code>` + explanations table (single source for the docs error reference), MCP server as a stretch (D28), G-010 types |
| 2C | Vite plugin integration | 🟡 | (harness-assigned) | subagent | — | Auto-load dev checks in serve + vitest setup, diagnostics/check options, checker → overlay, Astro/Vike dev mode (G-014), browser-tests free port (G-034) |
| 2D | Example migration | ⚪ | | | | |
| 3A | `llms.txt` | ⚪ | | | | |
| 3B | Skill rewrite | ⚪ | | | | |
| 3C | Docs site & repo docs | ⚪ | | | | |
| 4A | Eval re-run | ⚪ | | | | 5 trials (Q4) |
| 4B | Release prep | ⚪ | | | | |
| — | Baseline eval run (0A procedure) | ✅ | — | coordinator | (results committed) | 70/70 pass. Sygnal 74.5 s mean vs React 39.1 s; on shared tasks ~2.2×. Pass rate saturated (open Q6). See `evals/agent-ergonomics/results/BASELINE.md` |

## Gate Results

| When | Commit | build | build:types | vitest | test:types | browser | gzip `index.esm.js` | Notes |
|---|---|---|---|---|---|---|---|---|
| Baseline (pre-work) | `18ce5c9` | ✅ (TS2322 warnings) | ❌ B-001 | ✅ 610 | ✅ | ✅ 83 | 57,405 B (raw 273,829 B) | Size-gate baseline: limit is 58,941 B (+1.5 KB) |
| After 0A | `cb9fdf0` | — | ❌ B-001 | ✅ 610 | ✅ | ✅ 83 | unchanged | evals not collected by the root vitest; verify.mjs 28/28 |
| After 0B (Phase 0 close) | `18b3895` | ✅ (pre-existing warnings) | ✅ B-001 fixed | ✅ 649 | ✅ | ✅ 83 | 58,869 B | **New size baseline (D13)**: Phase 1+ limit is 60,405 B |
| After 0B review fixes (**Phase 0 close**, tag `plan1-phase0`) | `44daa86` | ✅ (includes dts) | ✅ | ✅ 670 | ✅ | ✅ 83 | 59,108 B | `dist/index.d.ts` from `build` alone has no `./cycle/` imports |
| After 1B | `b75616b` | ✅ | (in build) | ✅ 683 | ✅ (+ registry/dist programs) | ✅ 83 | 59,183 B | Phase 1 budget left: 1,222 B (1A ≤400, 1C ≤500, 1E ≤300) |
| After 1C + 1D | `679e60f` | ✅ | (in build) | ✅ 716 (+2 todo) | ✅ | ✅ 83 | whole file 60,764 B (info only) · **kanban app 40,237 B gz** (unchanged) | **Gate redefined (D18):** kanban production bundle limit 41,773 B (+1.5 KB over 40,237). Kanban tests 70/70. sygnal-check 46/46 |
| After 1H (**Phase 1 close**, tag `plan1-phase1`) | `0198550` | ✅ | (in build) | ✅ 845 | ✅ | ✅ 111 | kanban app **41,604 B** (limit 41,773; **169 B headroom**) | Kanban 70/70; sygnal-check 52/52 |
| After 1G (all Phase 1 merged) | `a6caabf` | ✅ | (in build) | ✅ 812 | ✅ | ✅ 107 | kanban app **41,442 B** (limit 41,773; 331 B headroom) | Kanban 70/70; sygnal-check 50/50; analyzer 27/27 |
| After 1F | `52e3f91` | ✅ | (in build) | ✅ 795 | ✅ | ✅ 94 | kanban app **40,938 B** (limit 41,773) | Kanban 70/70 |
| After 1E (+ integration fixes) | (see log) | ✅ | (in build) | ✅ 767 | ✅ | ✅ 89 | kanban app **40,744 B** (limit 41,773; ~1 KB left for 1F) | Kanban 70/70; sygnal-check 46/46 (code drift test passes) |
| After 1A (+ integration fixes) | `46d47de` | ✅ | (in build) | ✅ 750 | ✅ | ✅ 89 | kanban app **40,383 B** (+146; limit 41,773) · diagnostics entry 9,452 B (dev only) | Kanban 70/70 |

## Open Questions (awaiting user)

| # | Question | Raised | Blocks | Answer |
|---|---|---|---|---|
| Q1 | Canonical forms: single non-STATE sink (object vs shorthand) | Phase 0 | 0C → 2A, 2D, 3 | ✅ Object form `{ EVENTS: fn }`; shorthand is non-canonical |
| Q2 | Canonical forms: global event emit (`emit()` vs `{ EVENTS }`) | Phase 0 | 0C → 2A, 2D, 3 | ✅ Option A: `EVENTS: event('TYPE', fn)` inside the object form; new `event()` helper (D12) |
| Q3 | `sygnal-check` packaging | Phase 0 | 1D | ✅ Separate `sygnal-check` package (`@babel/parser`) |
| Q4 | Eval trial budget | Phase 0 | baseline run, 4A | ✅ 5 trials: (8 Sygnal + 6 React) × 5 = 70 runs per round, 140 total |
| Q6 | Eval ceiling: 70/70 pass. Add a harder task tier? (A keep as is · B harder tier both arms, ~80 more runs total · C harder tier Sygnal only) | Baseline | 4A design | ✅ B: harder tier (tasks 09–12) in both arms, 5 trials each; baseline uses the saved pre-change tarball (D16) |
| Q5 | Fix framework bugs B-003/B-004/B-005 within PLAN-1, or defer to a follow-up? | Phase 0 | — | ✅ New workstream 1F, after 1E (D11) |

## Decision Log

| # | Date | Decision | By | Rationale |
|---|---|---|---|---|
| D1 | 2026-09-30 | Element-bound triggers rejected | User + coordinator | Keeps actions defined only in `.intent`; static and runtime selector checks cover the bug class |
| D2 | 2026-09-30 | Fixing B-001 (`build:types`) is assigned to 0B | Coordinator | 0B owns `src/index.d.ts` in Phase 0 and needs the gate green |
| D3 | 2026-09-30 | 0A verifies its hidden tests by checking that each suite fails on the starter and passes with a reference solution; it doesn't run smoke-trial agents | Coordinator | Deterministic check of the harness; agent trials are run by the coordinator |
| D4 | 2026-09-30 | SYG code ranges pre-reserved per workstream in `codes.ts` (0B) | Coordinator | Prevents code collisions between 1A, 1E and 2A |
| D5 | 2026-09-30 | Subagents are spawned with `Agent(isolation: "worktree")` and fast-forward to the integration branch first; plan §1.2 and §1.5 revised | Coordinator | G-004 |
| D6 | 2026-09-30 | 0A landed by `git am` of reviewed patches directly onto the integration branch (no merge commit) | Coordinator | Consequence of G-004; content verified with verify.mjs and the full test gate |
| D7 | 2026-09-30 | 0A hidden tests boot the real app in jsdom and dispatch real DOM events, instead of `renderComponent` + mockConfig | Coordinator (accepted subagent deviation) | Mock DOM can't reproduce the isolation bug; tests don't depend on internals that 1C will change |
| D8 | 2026-09-30 | Canonical: single non-STATE sink uses object form | User (Q1) | |
| D9 | 2026-09-30 | `sygnal-check` is a separate package using `@babel/parser` | User (Q3) | Core runtime deps unchanged |
| D10 | 2026-09-30 | Eval budget is 5 trials per task per arm | User (Q4) | |
| D11 | 2026-09-30 | Add workstream 1F (fix B-003, B-004, B-005), serialized after 1E | User (Q5) | Fixes land after the baseline eval, so the re-run reflects them |
| D12 | 2026-09-30 | Canonical emit is `EVENTS: event('TYPE', fn)` inside the object form; the new `event()` helper is owned by 1B; `emit()` stays as a non-canonical alias | User (Q2, option A) | One model-entry shape everywhere; event name next to the call; composes with STATE without spreading |

| D13 | 2026-09-30 | Size gate re-baselined to 58,869 B at Phase 0 close (per plan §1.4 "Phase 0 baseline"). 1A runtime checks must **not** ship in `index.esm.js`: put them in a separate build entry (e.g. `sygnal/diagnostics`) that the Vite plugin loads in serve mode and that test setup loads | Coordinator | 0B core alone used 1,464 of the 1.5 KB budget; checks are dev-only by nature |
| D14 | 2026-09-30 | Vite dev flag is set by the entry-file transform (prepends `globalThis.__SYGNAL_DEV__ = true`), not by `define` | Coordinator (accepted subagent deviation) | `define` doesn't reach pre-bundled deps in Vite 8, and it would force diagnostics on in Vitest |
| D15 | 2026-09-30 | Baseline trial dirs live under the session scratchpad (`scratchpad/runs/baseline`), not `/tmp/sygnal-evals` | Coordinator | Subagent writes are confined to the scratchpad (G-004); the path avoids the word "evals" (G-009) |

| D16 | 2026-10-01 | Add harder eval tier: tasks 09–12, both arms, 5 trials = 40 runs per round. The baseline for the new tasks runs on the same pre-change tarball (`scratchpad/evals/sygnal-5.3.7.tgz`, packed at `57499d1`) | User (Q6) | Pass rate saturated at 70/70; need tasks that can fail |
| D17 | 2026-10-01 | 0A-H (harder tier) owns `evals/**` while it runs; no other workstream touches `evals/` | Coordinator | Ownership |

| D18 | 2026-10-01 | **Size gate redefined:** measure the gzip of the tree-shaken `examples/kanban` production bundle (baseline 40,237 B after 1B; limit +1.5 KB = 41,773 B). The whole-file `dist/index.esm.js` size is recorded for information only. `renderComponent` stays exported from `'sygnal'` (no API change) | Coordinator | 1C's test helpers grew the whole file by 1.6 KB but add 0 B to a real app (verified: identical kanban bundle hash), so the whole-file metric measured code that apps never ship. UMD/script-tag users do pay; noted for 4B |
| D19 | 2026-10-01 | 1D's code table is hand-kept with a drift test against `codes.ts` (titles); static severities may differ from runtime ones (SYG102/105 warn statically, info at runtime) | Coordinator (accepted deviation) | Static analysis has full-project knowledge that the runtime lacks |

| D20 | 2026-10-01 | The `sygnal/diagnostics` entry reaches the core through `globalThis.__SYGNAL_DIAGNOSTICS__` (not a public `registerCheck` export), keeping the public API unchanged | Coordinator (accepted deviation) | Avoids exporting internals; revisit in 4B if multiple sygnal copies on a page become a concern (last one wins) |
| D21 | 2026-10-01 | 1A's SYG102 test drives the hooks directly; under `renderComponent`, model-only actions are intentionally not reported (1C injects test intent streams for them) | Coordinator (merge resolution) | The behaviors of 1A and 1C are both correct; the test assumed the old renderComponent |

| D22 | 2026-10-01 | A bad Collection `from` is reported once, by the core (1E's SYG401/SYG412, in every mode), with the available array fields added to the message. 1A's dev check keeps only the `from`-missing/whole-state case | Coordinator (merge resolution) | 1A + 1E both reported SYG401 for the same event |
| D23 | 2026-10-01 | G-024 (simulateEvent reports SYG103/SYG104 under renderComponent) added to 1F | User | Agents test with renderComponent; the isolation trap must be visible there |

| D24 | 2026-10-01 | Add a friction analyzer over the existing transcripts (no new trials) to attribute the Sygnal−React delta to phases, defects and skill usage; it will also compare the Phase 4 re-run | Coordinator (in answer to the user's question about diagnostic depth) | Pass rate is saturated; efficiency is the only signal, so we need to know where the time goes |

| D25 | 2026-10-01 | B-004: `value`/`checked` are fully controlled (React-like). Add a dev warning for an input with a value prop but no input/change listener (1G: static SYG111 + docs) | User | Matches agent and React expectations; the warning catches the "save on blur" pattern that would reset mid-typing |
| D26 | 2026-10-01 | B-005: accept the additive `errors(selector?)` on driverFromAsync sources; null/undefined results are delivered to `select()` | User | Additive; unhandled errors are still logged as before |

| D27 | 2026-10-01 | Fold the friction-analyzer recommendations into the plan: 3A/3B get an API-facts section + "testing your change" recipe inline in SKILL.md and drop the shorthand from the skill; 4A runs the analyzer/compare, records tokens, and neutralizes harness-guard noise (8–17 s per trial in both arms); G-018 offered to 1G as optional | Coordinator | Evidence from `results/analysis/*.md` |

| D28 | 2026-10-01 | 2B: ship an MCP server (`sygnal-check mcp`: check, graph, explain) as a stretch goal after core inspect/graph | User | |
| D29 | 2026-10-01 | Phase 2 adds **0 bytes** to app bundles: strict mode and inspect live in the `sygnal/diagnostics` dev entry or tooling. If impossible, come back with numbers | User | 169 B headroom left |
| D30 | 2026-10-01 | Phase 2 sequencing: 2A ∥ 2C now (disjoint ownership) → 2B after 2A (shares the sygnal-check CLI + dev entry) → 2D after 2A + 2C (∥ 2B). This differs from the plan's 2C→2B→2A→2D merge order | Coordinator | Maximizes parallelism without shared files |

## Bugs & Gaps Found

Pre-existing issues and gaps found during the work. Severity: high (blocks a gate or breaks users), med (wrong behavior or misleading), low (cosmetic or docs).

| ID | Found | Severity | Area | Description | Status / Owner |
|---|---|---|---|---|---|
| B-001 | Baseline | high | Build / types | `npm run build:types` fails at HEAD (`18ce5c9`): rollup-plugin-dts "Syntax not yet supported" on the runtime statement `(_Fragment as any).__sygnalFragment = true` in `src/cycle/dom/snabbdom.ts:22`, which is pulled into the `.d.ts` bundle graph from `src/index.d.ts`. Same plugin/TS versions as the main checkout, so it's not an environment issue. Root cause (0B): rollup-plugin-dts has no TS program for a `.d.ts` entry, so it reads `.ts` sources as declarations. | ✅ Fixed in 0B (`357f529`) |
| B-002 | Baseline | low | Build | `npm run build` emits several `TS2322` warnings in the DOM source (`DevToolEnabledSource & MemoryStream<Element[]>` not assignable to `MemoryStream<(Element \| Document)[]>`). Non-fatal, but noisy, and it hides new warnings. | Open (unassigned; candidate for 1E or follow-up) |
| B-003 | 0A | **high** | `src/component.ts` sinks | Non-STATE sinks see **stale state** within one tick. With `SAVE: { STATE: s=>({...s, saved: s.draft}), EVENTS: s=>({type, data: count(s.draft)}) }`, if an input-driven EDIT and the SAVE click land in the same tick, STATE sees the new draft but EVENTS sees the old one. Expected: every sink of one action sees the same state. Eval helpers wait 50 ms between actions to avoid it. | Open → 1F |
| B-004 | 0A | med | Rendering | Controlled input isn't cleared when actions arrive in the same tick. With `<input value={state.draft}>`, typing then ADD (which resets the draft to `''`) in one tick leaves the typed text in the DOM: the intermediate render is coalesced, so snabbdom diffs `''→''` and never writes the value. | Open → 1F |
| B-005 | 0A | med | `src/extra/driverFactories.ts` | `driverFromAsync` swallows errors: a rejected promise is only `console.error`ed and never reaches the app, so loading UIs hang (the skill's own `if (!response.ok) throw` example leads straight into this). Also, a promise resolving to `null`/`undefined` throws at `innerVal.then` and is only logged. | Open → 1F |
| G-001 | Baseline | low | Docs | `CLAUDE.md` says "Vitest (318 tests)"; actual is 610 vitest + type tests + 83 browser tests. | Open → 3C |
| G-002 | Baseline | med | Dev setup | A fresh worktree needs `npm ci`, `npm ci --prefix browser-tests`, **and** `npm install` in `examples/kanban` (its `file:../..` link). Otherwise the kanban tests fail with "Cannot find package 'sygnal'". This isn't documented. | Open → 3C (document); setup steps are in the subagent briefs |
| G-003 | 0A | med | Skill docs | `skills/sygnal-dev` (SKILL.md + component-patterns.md) never shows how a child reads props from its parent (props are spread into the view's first arg; the 4th reducer arg is `props`). Only `props$` is mentioned. | Open → 3A/3B |
| G-004 | Coordinator | med | Infra (Claude Code) | Subagents inherit the coordinator's worktree pin: `EnterWorktree(path)` into a sibling worktree lets file reads through, but Bash/Write/git are refused. Plan §1.2 assumed this would work. | Mitigated by D5 |
| G-005 | Coordinator | low | API | `emit()` returns `{ EVENTS }`, so combining it with other sinks means spreading it: `{ ...emit('X', fn), STATE: ... }`. This is awkward if `emit()` becomes canonical. | Open; feeds Q2 |
| G-006 | Coordinator | low | Housekeeping | Unused worktrees `.claude/worktrees/p1-0a` and `p1-0b` (branches `plan1/0a`, `plan1/0b`, no commits) are left over from the first launch; removing them from the coordinator was denied by the permission classifier. | **User action** (see below) |
| G-007 | Coordinator | low | API | (1) The `event()` helper name collides by convention with the common callback param `event` (shadowing is harmless but can confuse readers); revisit the name before release. (2) The view receives `{ ...props, state, children, slots, context, peers }`, so a parent prop named `state`, `children`, `slots`, `context` or `peers` is silently overwritten. A candidate runtime diagnostic for 1A (SYG4xx). | Open → 1A (diagnostic for 2), 4B (name review) |
| B-006 | Pilot trial | med | `src/extra/testing.ts` mock DOM | `renderComponent`'s mock DOM source doesn't support the enriched-event `.data()` helper: `DOM.change('.toggle').data('id', Number)` throws `TypeError: DOM.change(...).data is not a function`, so apps that use `.data()` can't be tested with `renderComponent`. Found by an eval trial agent. **Broader (sygnal-03-t1):** the mock DOM returns plain streams with none of the enriched helpers; `DOM.input(...).value()` also throws "value is not a function". The mock must expose the same enriched API as the real DOM driver. | Open → 1C |
| B-007 | Baseline trials (3 of the first 7 Sygnal trials) | **high** | `src/vite/plugin.ts` HMR transform | The transform treats any non-node_modules file that imports and calls `run(` as the app entry, including **test files**. (a) Plain assignment `app = run(App)` is rewritten to `app = const __sygnal = run(App)`, a parse error. (b) Other shapes get HMR code that references `__sygnal` without defining it, so you get `ReferenceError: __sygnal is not defined`. Agents writing their own jsdom tests hit this and work around it with `import * as S` or `run as startApp`. Also matched `run(` inside comments, and `import.meta.hot` text in a comment disabled it. Hit by most Sygnal trials that wrote their own tests. | ✅ Fixed in 0B review fixes (`44daa86`): only top-level recognized shapes get HMR wiring; comments and strings are blanked before matching; test files and Vitest are skipped. Note: the baseline tarball predates the fix, so the baseline measures the bug |
| G-015 | Baseline trial sygnal-05 | med | `src/extra/testing.ts` | `simulateAction` only applies state changes; actions whose model entries target custom driver sinks (e.g. a fetch driver) produce no driver output, so agents can't test driver-triggering actions with it. Confirmed by sygnal-03-t1: EVENTS sink output also never fires through `simulateAction`. | Open → 1C |
| G-016 | Baseline trial sygnal-05 | med | `src/extra/testing.ts` | A mock DOM event sent immediately after `renderComponent()` is silently lost; it only registers after one timer tick (`setTimeout(0)`). There's no documented "ready" signal. Confirmed by sygnal-03-t1: `simulateAction` called right after `renderComponent` is also dropped (works after ~20 ms). | Open → 1C (add `await t.ready()` or make the first events buffer) |
| B-005 note | Baseline trial sygnal-05 | — | — | Independent confirmation of B-005: the agent noticed `driverFromAsync` swallows failures and worked around it by catching inside the fetch function. | — |
| G-017 | Coordinator | med | Eval harness | `transcript-stats.mjs` undercounts `iterations`: sygnal-05-t2 reported running its tests, but was recorded with 0 iterations. Probably misses some test/build invocation forms (e.g. `npx vitest`, `node node_modules/...`, a `cd X && npm test` chain). Iteration means for the baseline may be biased low. | ✅ Fixed in 0A-H (`lib/transcript.mjs` + unit tests). All 70 baseline records recounted (52 changed); BASELINE.md corrected: Sygnal 4.80 vs React 2.77 iterations |
| G-018 | Baseline trial sygnal-08-t2 | low | Rendering | Sygnal adds `data-sygnal-ready="true"` to the root element of every sub-component (Suspense READY tracking), so extracting markup into a child component changes the DOM. That breaks exact-HTML snapshot tests and surprises refactors that are supposed to keep the markup identical. Consider emitting it only when an ancestor `<Suspense>` exists, or only in dev. | Open → PLAN-2 candidate (or 1F if cheap) |
| B-008 | 1B | med | `src/component.ts` ~1557 | A sub-component with `.isolatedState = true` and `.initialState` but no `state` prop uses the base lens, so its initialState **replaces the parent's state** (observed: parent `{count: 0}` → `{}`). The existing guard only covers the case where isolatedState is missing. | Open → 1F (fix) + 1A (diagnostic, if cheap) |
| G-019 | 1B | med | Test infra | `test/types.test.ts` is never type-checked (vitest doesn't typecheck it, and the type-tests tsconfig doesn't include it), so its `expectTypeOf` / `@ts-expect-error` assertions are runtime no-ops. Real type guarantees live only in `type-tests/`. | Open → PLAN-2 candidate (move assertions into type-tests or enable vitest typecheck) |
| G-020 | 1C | low | EVENTS driver | EVENTS sink values carry enumerable `__emitterId`/`__emitterName` devtools stamps, which break `toEqual` assertions on raw sink output. Should be non-enumerable. | Open → 1F (cheap) |
| G-021 | 1C | med | Test infra | Root `vitest run` collects `examples/*/src/*.test.js` without the examples' Vite config, so their JSX compiles to React classic (`React.createElement`). 1C added a scoped `globalThis.React` shim in kanban tests. Needs a root vitest config (projects per example) or excluding examples from the root run. | Open → 2D |
| G-022 | 1C | low | Docs | After `simulate*`, both the state update and the re-render are async (a few ms). Agents must await `waitForState`/`ready` before asserting. Must be documented prominently. | Open → 3A/3C |
| G-023 | 1D | info | browser-tests | `sygnal-check` reports 6 SYG110 in `browser-tests/src/testing-utility.jsx` (`.btn`, `.inc`, `.dec` selected but never rendered). These are intentional, since the tests drive those components with `simulateAction`. Add `// sygnal-ignore` comments when the zero-diagnostics gate (2D) reaches browser-tests. | Open → 2D |
| G-024 | Coordinator | med | Diagnostics × testing | Runtime SYG103/SYG104 need a real DOM, so they never fire under `renderComponent` (mock DOM). That's exactly where agents test, and the isolation trap is the #1 Sygnal-specific bug. Mitigation today: `sygnal-check` (SYG110/SYG104 static). Option: teach `simulateEvent` to report SYG103/104 itself when a selector matches only inside a child's scope (it already resolves vnode targets and isolation scopes). | Open → **1F** (user request, D23) |
| G-025 | 1A | low | `src/extra/testing.ts` | `renderComponent` doesn't pass `hmrActions` or `components` through to `component()`, so those static properties have no effect under it. | Open → 1F (cheap) |
| B-009 | 1A (unverified) | med | Collections / isolation | Two Collections in the same parent whose items share ids would get **identical DOM isolation scopes** (the item scope is the bare id), so events could cross between them. Seen in code; not reproduced. | Open → 1F (verify with a test; scope by collection) |
| G-026 | 1E | low | `src/component.ts` | An invalid Collection `from` (neither a string nor `{get}`) prints SYG412 twice: once in getComponents (with no component name) and again in instantiateCollection. Pre-existing. | Open → 1F |
| G-027 | 1E | low | `src/component.ts` | The "Invalid reducer type" error (SYG218) is thrown and immediately caught by the surrounding catch, so it only shows up as the attached error of SYG216. Pre-existing. | Open → PLAN-2 candidate |
| B-010 | 0A-H | **high** | `src/cycle/state/pickCombine.ts` | **A Collection doesn't re-render on a pure reorder.** A reducer that only swaps or reverses items of a Collection's array updates state, but the DOM keeps the old order until some item's own state changes. `PickCombine._n` only calls `up()` when an item was removed or an item sink emits; a permutation does neither. Minimal repro: a top-level Collection plus a "Reverse" button. | Open → **1G** |
| B-011 | 0A-H | **high** | `src/pragma/index.ts` + snabbdom | **Stale text node.** Patching an element with a single text child into the same tag with several children keeps the old text: `{sel ? <p>Status: {s}</p> : <p>Select a task.</p>}` renders "Select a task.Status: Open". A single text child gives the vnode both `text` and a non-array `children`, so `updateChildren` gets an `oldCh` without `.length` and only appends. Very likely to hit any conditional "placeholder vs details" UI. | Open → **1G** |
| B-012 | 0A-H | med | snabbdom props / className | **A removed className stays on a reused element.** `<p className="placeholder">` patched to `<p>` keeps `class="placeholder"`, because className goes through snabbdom's props module, which never unsets removed props. | Open → **1G** |
| B-013 | 1F | **med-high** | `src/component.ts` collection items | **Lost update in Collection items:** two same-tick actions inside an item (EDIT then SAVE) lose the first (final `draft: ''`, `saved: ''`). Item STATE reducers read `this.currentState`, which lags behind `debounce(1)` in `instantiateCollection`, so SAVE starts from the pre-EDIT state. Likely fix: use the reducer's fresh `state` argument for collection items, with care for base-lens children that rely on the parent's calculated fields. | Open → 1G |
| G-028 | 1F | low | `src/extra/testing.ts` | `renderComponent` never becomes ready for a component with no initialState and no model (nothing emits state, so nothing renders; `ready()` waits forever). | Open → 1G |
| G-029 | 1F | info | Devtools | Parents re-stamp EVENTS from children with their own name, so `__emitterName` is always the outermost component. Pre-existing. | Open → PLAN-2 candidate |
| G-030 | Analyzer | med | Eval harness | The coordinator's worktree guard refuses some compound shell commands from trial agents (both arms), adding 8–17 s per trial: ~20–24% of React's wall time. This compresses the Sygnal/React ratio and adds noise. | Open → 4A (D27) |
| G-031 | Analyzer | med | Skill content | The installed skill has no testing section and no "API facts" (child props, run() API, CHILD.select payload, blur handling, xstream operators), so agents read `node_modules/sygnal` source (28 of 40, 19 of 20 trials). | Open → 3A/3B (D27) |
| B-014 | 1G (code reading, untested) | med | Rendering | A string `class="a b"` in JSX goes to snabbdom's classModule, which iterates the string's **characters** (adding classes "0", "1", "2"…). `className` works. | Open → verify + fix (PLAN-2 or Phase 2 follow-up) |
| B-015 | 1G | low | Rendering | snabbdom's propsModule never unsets removed props (e.g. `title`); only className is handled now (B-012). | Open → PLAN-2 candidate |
| G-032 | 1G | low | Docs | The docs need a SYG111 entry and a G-018 note (`data-sygnal-ready` now appears only while not ready). | Open → 3C |
| B-016 | 1H | low | `src/component.ts` | An isolatedState sub-component with initialState but **no model** never applies its initialState (with no model there is no INITIALIZE, so it reads the parent's state). Pre-existing. | Open → PLAN-2 candidate |
| B-017 | 1H | low | Rendering | On re-render, the controlled-input (and props) update hook runs before snabbdom updates children, so a `<select>` whose options change in the same patch may not take its new value. Pre-existing. | Open → PLAN-2 candidate |
| G-033 | 1H | low | sygnal-check | SYG111 doesn't report a `<select>` with a literal value, although the runtime controls it too. | Open → PLAN-2 candidate |
| G-034 | 1H | low | Test infra | The browser test runner uses a fixed port (5299, strictPort), so parallel worktrees can't run browser tests at the same time. This constrains parallel workstreams. | Open → 2D or PLAN-2 (use port 0 / auto) |
| G-035 | Coordinator (found by 2A) | med | Types | The coordinator never applied 1C's TYPE DIFF to `src/index.d.ts` (RenderOptions/RenderResult lacked simulateEvent, ready, diagnostics, …), so TS users got type errors on the new test API. | ✅ Fixed by the coordinator: types applied + `type-tests/render-component.tsx` |
| B-018 | 2A | med | Diagnostics | Runtime SYG202 warned when a Collection item returned `undefined`, which is the documented way to remove an item. | ✅ Fixed by the coordinator: info severity for sub-components, warn at the root, with a regression test |
| G-036 | 2A | low | Diagnostics API | `run(App, d, { diagnostics: { strict: true } })` isn't supported (run.ts forwards only mode/ignore); strict is enabled via `configureStrict` / `__SYGNAL_STRICT__` / renderComponent. Strict severities are registered by the dev entry, so `getCodeInfo('SYG50x')` is only complete once it's loaded. | Open → 3C (document); revisit in 4B |
| G-008 | Coordinator | low | Skill | The installed user-level skill `~/.claude/skills/sygnal-dev/SKILL.md` lags the repo copy (missing the DISPOSE row and the dispose$ "prefer DISPOSE" note); `agents/` exists only in the repo. Eval trials use the installed copy. | Open → 3B sync |
| G-009 | Coordinator | low | Eval harness | The `transcript-stats.mjs` audit flags every call whose path contains "evals", which gives false positives when the trial dir is under `.../evals/...`. | ✅ Fixed in 0A-H (audit narrowed; trial dir stripped before matching) |
| G-010 | 0B | low | Types | `getDevTools` is exported at runtime but has no declaration in `src/index.d.ts`. | Open → 2B |
| G-011 | 0B | med | Release | `npm run build` copies `src/index.d.ts` into `dist`, but that file has a relative `./cycle/dom/index` import that doesn't exist in dist. Correct types need `build:all`, and `package.json` has no `prepublishOnly` enforcing it. B-001 had been broken since the cycle-absorption commit `24e5790`, so versions published since then may ship broken types. | Partly fixed (`44daa86`): `build` now bundles the declarations and `prepublishOnly` runs `build:all`. Still open → 4B: check what types the published npm versions since `24e5790` actually ship |
| G-012 | 0B | low | Types | Full-project `tsc` reports errors in `src/extra/testing.ts` (`Stream` used as a type, TS2749; `DOM` missing on the sources type, TS2339). Related to B-002. | Open → 1C |
| G-013 | 0B | med | Diagnostics | `renderComponent` injects a synthetic `__TEST_ACTION__` intent and model entry, so diagnostics hooks see it, and `simulateAction` state changes reach `onReducer` as `__TEST_ACTION__` rather than the real action. Risk of SYG101/102 false positives. | Open → 1A + 1C |
| G-014 | 0B | low | Vite | The dev flag only covers apps whose entry imports `run` from `sygnal`; the Astro and Vike integrations don't get dev mode. | Open → 2C |

## Worktree Setup (run by each subagent inside its own isolated worktree; see D5)

```bash
git merge --ff-only worktree-agent-ergonomics
npm ci --no-audit --no-fund
npm ci --prefix browser-tests --no-audit --no-fund
(cd examples/kanban && npm install --no-audit --no-fund)
```

## Activity Log

- 2026-09-30 — 0A delivered as patches; reviewed, applied, verify.mjs 28/28; gates green (610 vitest, types OK, 83 browser). 0B relaunched with an isolated worktree. Q1, Q3 and Q4 answered; Q2 re-asked with an example. B-003..B-005 and G-003..G-006 logged.
- 2026-09-30 — 0A and 0B subagents launched; both blocked by G-004.
- 2026-09-30 — Plan committed. Baseline gates recorded. B-001, B-002, G-001 and G-002 logged.
