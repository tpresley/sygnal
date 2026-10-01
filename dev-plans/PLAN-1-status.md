# PLAN-1 Status Tracker

Tracks progress for [PLAN-1.md](PLAN-1.md). Maintained by the coordinator.

**Integration branch:** `worktree-agent-ergonomics` · **Current phase:** 0 · **Last updated:** 2026-09-30

---

## Phase Overview

| Phase | Status | Tag | Notes |
|---|---|---|---|
| 0 — Foundations | 🟡 In progress | — | 0A ✅ · 0B 🟡 · 0C ✅ |
| 1 — Core capabilities | ⚪ Not started | — | |
| 2 — Strictness, introspection, integration | ⚪ Not started | — | |
| 3 — Agent context & docs | ⚪ Not started | — | |
| 4 — Measure & release | ⚪ Not started | — | |

Legend: ⚪ not started · 🟡 in progress · 🔵 in review / merging · ✅ done · 🔴 blocked

## Workstreams

| ID | Title | Status | Branch | Agent | Merged | Notes |
|---|---|---|---|---|---|---|
| 0A | Baseline eval harness | ✅ | (applied as patches) | subagent | `8ed8145..cb9fdf0` | verify.mjs 28/28 OK, rerun by the coordinator. Agent couldn't run in its worktree (G-004), so it built in scratch and sent patches; the coordinator reviewed them (all paths under `evals/`, every rm scoped) and applied with `git am` (D6) |
| 0B | Diagnostics infrastructure (+ fix B-001) | 🟡 | (harness-assigned) | subagent (bg, relaunched) | — | First launch BLOCKED by G-004; relaunched with `isolation: worktree` |
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
| — | Baseline eval run (0A procedure) | ⚪ | — | coordinator | — | 70 runs; starts after Phase 0 closes, before Phase 1 merges |

## Gate Results

| When | Commit | build | build:types | vitest | test:types | browser | gzip `index.esm.js` | Notes |
|---|---|---|---|---|---|---|---|---|
| Baseline (pre-work) | `18ce5c9` | ✅ (TS2322 warnings) | ❌ B-001 | ✅ 610 | ✅ | ✅ 83 | 57,405 B (raw 273,829 B) | Size-gate baseline: limit is 58,941 B (+1.5 KB) |
| After 0A | `cb9fdf0` | — | ❌ B-001 | ✅ 610 | ✅ | ✅ 83 | unchanged | evals not collected by the root vitest; verify.mjs 28/28 |

## Open Questions (awaiting user)

| # | Question | Raised | Blocks | Answer |
|---|---|---|---|---|
| Q1 | Canonical forms: single non-STATE sink (object vs shorthand) | Phase 0 | 0C → 2A, 2D, 3 | ✅ Object form `{ EVENTS: fn }`; shorthand is non-canonical |
| Q2 | Canonical forms: global event emit (`emit()` vs `{ EVENTS }`) | Phase 0 | 0C → 2A, 2D, 3 | ✅ Option A: `EVENTS: event('TYPE', fn)` inside the object form; new `event()` helper (D12) |
| Q3 | `sygnal-check` packaging | Phase 0 | 1D | ✅ Separate `sygnal-check` package (`@babel/parser`) |
| Q4 | Eval trial budget | Phase 0 | baseline run, 4A | ✅ 5 trials: (8 Sygnal + 6 React) × 5 = 70 runs per round, 140 total |
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

## Bugs & Gaps Found

Pre-existing issues and gaps found during the work. Severity: high (blocks a gate or breaks users), med (wrong behavior or misleading), low (cosmetic or docs).

| ID | Found | Severity | Area | Description | Status / Owner |
|---|---|---|---|---|---|
| B-001 | Baseline | high | Build / types | `npm run build:types` fails at HEAD (`18ce5c9`): rollup-plugin-dts "Syntax not yet supported" on the runtime statement `(_Fragment as any).__sygnalFragment = true` in `src/cycle/dom/snabbdom.ts:22`, which is pulled into the `.d.ts` bundle graph from `src/index.d.ts`. Same plugin/TS versions as the main checkout, so it's not an environment issue. | Open → 0B |
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
