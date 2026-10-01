# PLAN-1 Status Tracker

Tracks progress for [PLAN-1.md](PLAN-1.md). Maintained by the coordinator.

**Integration branch:** `worktree-agent-ergonomics` · **Current phase:** 0 · **Last updated:** 2026-09-30

---

## Phase Overview

| Phase | Status | Tag | Notes |
|---|---|---|---|
| 0 — Foundations | ✅ Done | `plan1-phase0` | 0A ✅ · 0B ✅ · 0C ✅ · review: 9 findings, all fixed. Baseline eval still running (independent of merges; uses the pre-0B tarball) |
| 1 — Core capabilities | 🟡 In progress | — | 1A–1D launched in parallel; 1E queued, then 1F |
| 2 — Strictness, introspection, integration | ⚪ Not started | — | |
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
| 1A | Runtime consistency checks | ⚪ | | | | |
| 1B | Typed links (+ new `event()` helper) | ⚪ | | | | `event()` added per D12 |
| 1C | DOM-level test helpers | ⚪ | | | | |
| 1D | Static checker `sygnal-check` | ⚪ | | | | Separate package (Q3) |
| 1E | Error-message retrofit | ⚪ | | | | |
| 2A | Strict mode | ⚪ | | | | |
| 2B | Inspect | ⚪ | | | | MCP decision pending |
| 2C | Vite plugin integration | ⚪ | | | | |
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
| G-017 | Coordinator | med | Eval harness | `transcript-stats.mjs` undercounts `iterations`: sygnal-05-t2 reported running its tests, but was recorded with 0 iterations. Probably misses some test/build invocation forms (e.g. `npx vitest`, `node node_modules/...`, a `cd X && npm test` chain). Iteration means for the baseline may be biased low. | Open: audit the counter against a few transcripts before computing baseline summaries; recompute affected records with `--classify`/re-score if fixed |
| G-018 | Baseline trial sygnal-08-t2 | low | Rendering | Sygnal adds `data-sygnal-ready="true"` to the root element of every sub-component (Suspense READY tracking), so extracting markup into a child component changes the DOM. That breaks exact-HTML snapshot tests and surprises refactors that are supposed to keep the markup identical. Consider emitting it only when an ancestor `<Suspense>` exists, or only in dev. | Open → PLAN-2 candidate (or 1F if cheap) |
| G-008 | Coordinator | low | Skill | The installed user-level skill `~/.claude/skills/sygnal-dev/SKILL.md` lags the repo copy (missing the DISPOSE row and the dispose$ "prefer DISPOSE" note); `agents/` exists only in the repo. Eval trials use the installed copy. | Open → 3B sync |
| G-009 | Coordinator | low | Eval harness | The `transcript-stats.mjs` audit flags every call whose path contains "evals", which gives false positives when the trial dir is under `.../evals/...`. | Mitigated by D15; fix the pattern before 4A |
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
