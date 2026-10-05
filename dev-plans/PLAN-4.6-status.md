# PLAN-4.6 Status Tracker

Tracks progress for [PLAN-4.6.md](PLAN-4.6.md) (component core rewrite). The coordinator maintains it.

**Numbering:** decisions from **D160**, gaps from **G-290** (PLAN-4.5 ended at D159 / G-289).

**Integration branch:** `plan46-integration`, cut from `plan45-complete` (`d900c522`) on 2026-10-04, with `claude/component-core-rewrite-experiment` (the study) merged (`45eefb2`). Worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** R0, R1 merged. R2 running (incl. R1 review fixes G-294…G-305).

## Phases

| ID | Phase | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-S | Spike: prototype + hard features, measure, project size | ✅ merged | `p46-spike` (`3d8af23`) | 2026-10-04 | **Go**: 40/40 tests; mount 1.9–2.2×, Collection 1.6–9× faster; kanban 30.4 KB (proj. 35–37 KB vs 41.3); streams/item 1; race class impossible. Findings → PLAN-4.6 §1a, Q18–Q23 |
| R0 | Decisions, hooks contract, parity/reentrancy/race tests | ✅ merged | `p46-r0` (`f48a112`) | 2026-10-04 | `src/core/hooks.ts` + 04-hooks-contract (13 consumers mapped); `test/parity/` 74 tests (53 pass + 21 expected-fail on current); 06 inventory (41 port, 17 delete at R5, 9 current-only); G-290 fixed (−2 B); 05 migration draft |
| R1 | Runtime core (both cores selectable) | ✅ merged | `p46-r1` (`4d91475`) | 2026-10-04 | `src/core/` ≈1,600 lines (9.6 KB gz alone); `test:next` in `npm test` (148 pass, 45 skipped for R2–R4); parity on next 31 pass; 6 of 9 examples pass on next (the rest need R2). Tags page: mount 2.0×, update-1 2.4×, unmount 2.3× faster; 1 stream per component. Size gate fails as planned (both cores: 49,289 B) → D175 |
| R2 | Hosts and markers (+ D174, D175, D166 test rewrite) | 🟡 running | `p46-r2` | | |
| R3 | Extensions (statics, replies, commands, behaviors) | ⬜ | | | |
| R4 | Tooling and integrations | ⬜ | | | |
| R5 | Cut-over, delete old core, gates, eval | ⬜ | | | |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D176 | 2026-10-04 | `defineComponent` is added and the `component` export removed together in R5 (an earlier export would flip the current core's expected-fail parity test). The `simulate*` → `await t.next()` contract under synchronous reducers (R1's input-armed cursor) is decided in R4, asking the user if it changes documented testing behaviour | Coordinator |
| D175 | 2026-10-04 | Size during R2–R4: production builds strip the next core (a build-time constant from `sygnal/vite` guards the `run()`/`renderComponent` branch), so the size gate keeps measuring the shipped core; the bench `next` target opts back in. Deleted at R5 | Coordinator |
| D174 | 2026-10-04 | `isolatedState` + `state="key"`: by default `initialState` seeds the slice only while it is `undefined` (parent data kept); a new tag prop **`resetState`** replaces the slice with `initialState` at creation; a dev-only warning (diagnostics, new code in R4) when the existing slice lacks keys `initialState` defines, naming them and suggesting `resetState` or initializing them in the parent. Today's behaviour (always overwrite) changes. New public prop | User |
| D173 | 2026-10-04 | A removed form met at runtime (string tag, `'A \| S'` key, `.peers`, positional view, custom source name, `component(`…) reports a one-time dev error with a link to the migration guide (diagnostics bundle; production silent, 0 core bytes) | User |
| D172 | 2026-10-04 | **Supersedes D166.** D166 was asked on a wrong premise: today's core already defers a hidden Switchable page's render until it is first shown (G-121). 6.0 keeps that, with **no new prop**. The user preferred an opt-in eager prop "unless there's a compelling reason not to"; the reason: first show is DOM-bound (the view call is cheap and a hidden page has no DOM to pre-create), so the prop would add API for almost no gain. Keeping hidden pages' DOM mounted is a different feature, for PLAN-5 or later | User / coordinator |
| D171 | 2026-10-04 | G-292 (a Switchable `state="x"` page gets an `isolatedState` sibling's local state) is fixed in the new core only; the parity suite pins it. The old core is deleted at R5 and the release is held, so no user runs it | Coordinator |
| D170 | 2026-10-04 | Q3, Q5, Q15, Q16, Q21, Q22: core below 41,343 B at R5; ≈ $27 Opus regression eval at R5 + ≈ $5 Haiku if agent docs change; keep `isolatedState` and fix its contradictory docs; fix calculated types; statics-before-driver-sends ordering within one action stays undocumented; `STATE.stream` (identity) and `STATE.watch` (deep) comparisons kept exactly | User |
| D169 | 2026-10-04 | Q23: id-less Collection items under filter/sort keyed by raw index (fixes G-291); duplicate ids warn in dev | User |
| D168 | 2026-10-04 | Q4: context read-tracking in the first cut (render only components that read a changed key), with a dev-mode check that re-runs a sample of skipped views and reports a differing vnode. Size was not the reason it was deferred; the residual risk (a read after the view returns) can't happen in pure synchronous views | User |
| D167 | 2026-10-04 | Q20: a child's `initialState` with an undefined slice stays SYG405 + error fallback, as today | User |
| D166 | 2026-10-04 | **Superseded by D172.** Q19: hidden Switchable pages render at mount, as today; new opt-in `<Switchable lazy>` defers a hidden page's first render until it is first shown (intent, actions, background statics run from mount). New public prop | User |
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
| G-292 | R0 | Med | Switchable | Current core: a page bound with `state="pageA"` next to a sibling page with `isolatedState` gets the sibling's local state (renders `undefined:undefined`) | New core only (D171); parity-pinned |
| G-293 | R0 | Low | process | D166 was asked on a wrong premise (the spike described its prototype's Switchable, not today's); verify current behaviour before asking the user about a "change" | Fixed (D172) |
| G-294 | review R1 | High | core/instance | A change inside a named `<Slot>` never re-renders the child (dirty check compares only the default slot). Confirmed | → R2 |
| G-295 | review R1 | Med | core/instance | A child whose intent throws during subscribe has already seeded state, fired onCreate, queued INITIALIZE and joined watchers; never disposed. Confirmed | → R2 |
| G-296 | review R1 | Med | core/runtime, testing | Sink values emitted during start() are dropped before renderComponent/run() callers attach listeners. Confirmed | → R2 |
| G-297 | review R1 | Med | core/runtime | Removing a hook layer also removes layers added after it. Confirmed | → R2 |
| G-298 | review R1 | Med/Low | core/runtime | No catch around the flush: a throwing lens/hook freezes the app with no onError. Confirmed | → R2 |
| G-299 | review R1 | Low | testing | TDZ `retry` error when renderComponent's start fails on next. Confirmed | → R2 |
| G-300 | review R1 | Low | core/actions | `next()` timers not cleared on dispose | → R2 |
| G-301 | review R1 | Low | core/runtime | `api.flushed()` never resolves after dispose or a throwing flush | → R2 |
| G-302 | review R1 | Low | core/teardown | Disposed streams stop at the end of the flush instead of the next macrotask (a shared `.remember()`/`periodic` remounted in the next flush restarts). Coordinator: restore xstream's macrotask stop via the existing macro ping (no setTimeout) | → R2 |
| G-303 | review R1 | Low | core/runtime | Driver errors skip `hooks.onError` | → R2 |
| G-304 | review R1 | Low | core (efficiency) | Per-render allocations (isolate key, context Proxy, handler props), O(watchers) notify per action, full-tree flush walk | → R2 (measure) |
| G-305 | review R1 | Low | mock DOM | Scope check matches by prefix (`s1` vs `s14`) | → R2 |
| G-291 | 0-S | Low | Collection | Id-less items under filter/sort are keyed by filtered/sorted index (likely a latent bug) | → Q23 |

## Log

- 2026-10-04 — Review of R1: 12 findings (G-294…G-305), sent to R2.
- 2026-10-04 — R1 merged (`4d91475`); gates green except size (planned: both cores ship, 49,289 B). D174 (user: isolatedState keeps parent data, `resetState` prop, dev warning), D175, D176. R2 and a review of R1 started.
- 2026-10-04 — R0 merged (`f48a112`); all gates green (vitest 2,649 + 21 expected-fail; 41,341 B). D166 re-decided as D172 (keep today, no prop); D171, D173. R1 started.
- 2026-10-04 — §9 answered (D161–D170): go, removals approved, context tracking in, opt-in lazy Switchable pages. R0 started.
- 2026-10-04 — Spike 0-S merged (`3d8af23`): go. PLAN-4.6 updated (§1a, Q18–Q23). Perf gate green after merge; spike suite 40/40.
- 2026-10-04 — Study reviewed (`claude/component-core-rewrite-experiment`). `plan46-integration` cut from `plan45-complete` with the study merged. Spike 0-S started; PLAN-4.6 drafted. D160.
