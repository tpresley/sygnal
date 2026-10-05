# PLAN-4.6 Status Tracker

Tracks progress for [PLAN-4.6.md](PLAN-4.6.md) (component core rewrite). The coordinator maintains it.

**Numbering:** decisions from **D160**, gaps from **G-290** (PLAN-4.5 ended at D159 / G-289).

**Integration branch:** `plan46-integration`, cut from `plan45-complete` (`d900c522`) on 2026-10-04, with `claude/component-core-rewrite-experiment` (the study) merged (`45eefb2`). Worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** approved (D161–D170). R0 running.

## Phases

| ID | Phase | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-S | Spike: prototype + hard features, measure, project size | ✅ merged | `p46-spike` (`3d8af23`) | 2026-10-04 | **Go**: 40/40 tests; mount 1.9–2.2×, Collection 1.6–9× faster; kanban 30.4 KB (proj. 35–37 KB vs 41.3); streams/item 1; race class impossible. Findings → PLAN-4.6 §1a, Q18–Q23 |
| R0 | Decisions, hooks contract, parity/reentrancy/race tests | 🟡 running | `p46-r0` | | |
| R1 | Runtime core (both cores selectable) | ⬜ | | | |
| R2 | Hosts and markers | ⬜ | | | |
| R3 | Extensions (statics, replies, commands, behaviors) | ⬜ | | | |
| R4 | Tooling and integrations | ⬜ | | | |
| R5 | Cut-over, delete old core, gates, eval | ⬜ | | | |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D170 | 2026-10-04 | Q3, Q5, Q15, Q16, Q21, Q22: core below 41,343 B at R5; ≈ $27 Opus regression eval at R5 + ≈ $5 Haiku if agent docs change; keep `isolatedState` and fix its contradictory docs; fix calculated types; statics-before-driver-sends ordering within one action stays undocumented; `STATE.stream` (identity) and `STATE.watch` (deep) comparisons kept exactly | User |
| D169 | 2026-10-04 | Q23: id-less Collection items under filter/sort keyed by raw index (fixes G-291); duplicate ids warn in dev | User |
| D168 | 2026-10-04 | Q4: context read-tracking in the first cut (render only components that read a changed key), with a dev-mode check that re-runs a sample of skipped views and reports a differing vnode. Size was not the reason it was deferred; the residual risk (a read after the view returns) can't happen in pure synchronous views | User |
| D167 | 2026-10-04 | Q20: a child's `initialState` with an undefined slice stays SYG405 + error fallback, as today | User |
| D166 | 2026-10-04 | Q19: hidden Switchable pages render at mount, as today; new opt-in `<Switchable lazy>` defers a hidden page's first render until it is first shown (intent, actions, background statics run from mount). New public prop | User |
| D165 | 2026-10-04 | Q17, Q18: synchronous STATE reducers; INITIALIZE at construction; BOOTSTRAP a microtask after the first render (not 10 ms); teardown keeps a `Stream.prototype._remove` swap scoped to `dispose()` (0 timers) | User |
| D164 | 2026-10-04 | Q9–Q14 (savings): drop `'ACTION \| SINK'` keys, positional view args, `.peers`, `hmrActions`, `storeCalculatedInState`, and the undocumented leftovers (single-stream intent, `.label` as a name, Collection `idfield`, string/`true` context entries, `CHILD.select()` without an argument, `__SYGNAL_HMR_*` declarations) | User |
| D163 | 2026-10-04 | Q8: drop `.components`, string JSX tags, `<Collection of="Name">` (a name looked up in `.components`; `of={Item}` stays) and `CHILD.select('Name')` | User |
| D162 | 2026-10-04 | Q6, Q7: drop `DOMSourceName`/`stateSourceName` (fixed `DOM`, `STATE`); drop the public `component({...})` factory, `sources`/`isolateOpts` and the `sygnalFactory`/`sygnalOptions` vnode props; add `defineComponent(opts)` returning an ordinary function component | User |
| D161 | 2026-10-04 | Q1, Q2: commit to PLAN-4.6 before PLAN-5; 6.0 may remove the approved alternative/undocumented forms, with a migration guide (reverses PLAN-1's "nothing is removed" for this major) | User |
| D160 | 2026-10-04 | Pursue the core rewrite as PLAN-4.6 before PLAN-5, starting with spike 0-S and a draft plan; commitment after the spike and §9 | User |

## Gaps

| ID | Found | Sev | Area | Description | Status |
|---|---|---|---|---|---|
| G-290 | 0-S | Med | DOM driver | `SymbolTree.delete` runs `Object.keys(siblings)` per removal: O(n²) on large removals (480 calls × 500 keys in one Switchable switch). Affects the current core too when many siblings go at once | → R1 |
| G-291 | 0-S | Low | Collection | Id-less items under filter/sort are keyed by filtered/sorted index (likely a latent bug) | → Q23 |

## Log

- 2026-10-04 — §9 answered (D161–D170): go, removals approved, context tracking in, opt-in lazy Switchable pages. R0 started.
- 2026-10-04 — Spike 0-S merged (`3d8af23`): go. PLAN-4.6 updated (§1a, Q18–Q23). Perf gate green after merge; spike suite 40/40.
- 2026-10-04 — Study reviewed (`claude/component-core-rewrite-experiment`). `plan46-integration` cut from `plan45-complete` with the study merged. Spike 0-S started; PLAN-4.6 drafted. D160.
