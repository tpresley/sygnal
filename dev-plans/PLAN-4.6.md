# PLAN-4.6: Component core rewrite for 6.0.0

**Goal:** replace the internals of the component core (`src/component.ts` and the `cycle/state` / `isolate` / scheduler chains it drives) with a smaller, synchronous runtime:
- one store per app with a run-to-completion action queue;
- pull-based state cells;
- one dirty-checked render flush;
- definitions normalized once per component function;
- explicit hooks for extensions.

Streams stay at the edges: intent, drivers, `STATE.stream`/`watch`, `dispose$`. The canonical API is unchanged. A list of rarely used alternative forms is removed (§9, the user's decision).

**Why now:** PLAN-4.5 made the current design fast enough to gate, but its five review rounds logged 39 issues (G-250…G-289). Most of them were races between the core's three timing sources: a microtask per reducer, startup timers, and a state stream chain per child. The new design has one clock, so that class of bug can't occur. It is also 2–4× faster on the operations PLAN-4.5 couldn't fix (mount, Collection). PLAN-5 builds widgets, browser sources and element plumbing on core internals; doing this first means building them once, on the hooks API.

**Release:** part of the held 6.0.0 major (D56). Runs **after PLAN-4.5 (tag `plan45-complete`) and before PLAN-5**; PLAN-5 rebases onto `plan46-integration`. No version bumps, tags on main, PR to main or publish.

**Status:** approved 2026-10-04 (D161–D173). R0 merged; R1 running.

**Inputs:**

| Input | Where | What it gives |
|---|---|---|
| Core rewrite study | `research/core-rewrite/` (branch `claude/component-core-rewrite-experiment`, merged into `plan46-integration`): 01 current structure, 02 legacy audit, 03 proposal, `proto/core-next.ts` | Map of today's core, what it supports vs documents, the proposed module layout, a measured prototype |
| PLAN-4.5 close-out | [`PLAN-4.5-status.md`](PLAN-4.5-status.md) | The count gate, timing baseline, behaviour contract (one patch per flush, synchronous teardown, post-patch DOM emission, dev statics freeze), the race-class gaps |
| PLAN-5 handoff | [`HANDOFF-to-PLAN-5.md`](HANDOFF-to-PLAN-5.md) | Budgets; D157's byte savings that need behaviour changes; G-282, G-284 |

**Invariants (as in PLAN-1…4.5):**
- Models return descriptions of effects, and drivers perform them.
- Every state change is an action.
- Views never bind events.
- PLAN-4.6 adds two:
  - **canonical observable behaviour stays the same**, except the timing changes listed in §5;
  - **the old core stays runnable as the parity oracle until the last phase.**

---

## 1. Where Sygnal stands

**After PLAN-4.5** (`plan45-complete`; gated core 41,343 B):

| Count (hard gate) | Value |
|---|---|
| DOM patches per update | 1 |
| Streams per Collection item | 22 |
| `setTimeout`s to unmount 1k | 9 |
| Retained ScopeCheckers | 0 |
| Heap after 5×1k cycles | 0.95 MB |

**Prototype vs current core** (study 03 §0; same JSX, same DOM driver, both measured in one run; median of 10, ms):

| Op | Current | Prototype | React |
|---|---|---|---|
| Mount 1k components | 35.2 | 14.7 | 10.6 |
| Unmount 1k | 6.4 | 3.15 | 2.1 |
| Update 1 of 1k | 3.05 | 1.3 | 1.25 |
| Collection: create 1k / 10k | 43.4 / 947 | 21.2 / 233 | 15.5 / 273 |
| Collection: replace 1k | 60.4 | 21.7 | 16.0 |
| Collection: select 1k | 8.25 | 3.65 | 0.5 |
| Collection: remove row | 11.7 | 1.25 | 1.25 |
| Leaf update 30 deep | 1.0 | 0.6 | 0.5 |

- Core self time to mount 1k: about 22 ms now, 1.8 ms in the prototype.
- Single-view ops (table, keystroke) don't change: they are bound by the pragma, snabbdom and the DOM driver.
- **Caveat:** the prototype covers only the canonical subset the benchmarks use. Spike 0-S checks whether the gains hold once the hard features are in.

## 1a. Spike 0-S results (`p46-spike`, merged; `research/core-rewrite/proto/`, `results-spike-0s/`)

The prototype was extended with:
- calculated fields;
- Collection filter, every sort form and cross-Collection moves;
- Switchable with hidden pages;
- Suspense/READY/Lazy through a marker registry;
- the generic statics path with the real `makeTimerDriver`;
- the real `makeFetchDriver` with per-item scope tagging and replies;
- `undo` through a definition-time hook;
- action-log hooks;
- reentrancy.

That is about 1,155 lines in 9 modules. **40/40 behaviour tests pass**, including PLAN-4.5's race scenarios.

| Criterion | Result |
|---|---|
| ≥ 1.5× faster on mount and Collection ops | **Met** (two runs, current → prototype, ms): mount 1k 37–42 → 18–21 (1.9–2.2×); Collection create 44–48 → 24–27 (1.6–2.0×), replace 55–62 → 20–23 (2.7×), select 7–8 → 3.2–3.4 (2.2×), remove 12–13 → 1.4–1.6 (9×), create 10k 884–904 → 198–224 (beats React's 275–284); filter+sort+calculated create 50–52 → 28–29 (1.8×); fetch per row create 271–283 → 122–131 (2.2×). Below 1.5×: update 1 of 1k (1.1–1.3×), keystroke (1.2–1.3×), re-sort (1.2–1.6×), Switchable show (0.6–0.9×; an O(n²) in the DOM driver's `SymbolTree.delete`; 1.0× once fixed) |
| Projected size ≤ 41,343 B | **Met.** Kanban on the prototype is **30,431 B** gzip (current 41,343); the prototype core is 7.7 KB bundled. Production features projected at +4.5–6.5 KB → **≈ 35–37 KB** |
| PLAN-4.5 race class impossible by construction | **Met.** No startup timers, gates, holds or hop counting. INITIALIZE writes state before the intent subscribes; new instances subscribe during the flush, which loops render → statics → drain until stable, then emits one vnode. Tests cover G-257, G-266 (startup with fake timers never advanced, 0 timers) and G-283 (a non-settling loop arms 0 timers) |
| Semantic differences listed | Yes → §9 Q18–Q23 |

**Counts** (current → prototype):
- patches per update: 1 → 1;
- streams per Collection item: 22 → **1** (table rows 27 → 2, fetch rows 28 → 4);
- `setTimeout`s to unmount 1k: 9 → **2** (the harness's own).

**Spike findings that change this plan:**
1. **Teardown still needs a `Stream.prototype._remove` swap,** scoped to `dispose()` (study 03's "no prototype patch" doesn't hold). Without it, xstream defers each stream's stop to its own `setTimeout`: 1–2k timers per 1k unmount. → Q18.
2. **The DOM driver has an O(n²) path** (`SymbolTree.delete` runs `Object.keys(siblings)` per removal). It is fixed in R1 (count children), which also helps the current core.
3. **The flush loop "render → statics → drain until stable, then one patch"** is what makes the race class impossible. It becomes the core contract (§2).
4. **Registry pattern** (hosts, post-processors, pre-processors, resolvers, definition hooks): Portal/Transition/ClientOnly fit `pres` without core changes.
5. **Definition-time hooks run behaviours' existing `merge()` on a definition shim,** so `undo` worked unchanged. This lowers R3's risk.
6. **The spike implemented context read-tracking** (the proposal's §7 #7) and it worked. It stays a decision (Q4).

## 2. Design (study 03, with these changes)

The design is study 03 §1–§6. In short:

| Area | Design |
|---|---|
| Runtime | `src/core/runtime.ts`: per-app store, FIFO run-to-completion action queue, one microtask flush, one root vnode to the DOM driver, then ELEMENT commands, loop guard (G-260) |
| State | `cell.ts`: root / key / lens / Collection item (one id→index map per array identity) / local (`isolatedState`), with calculated fields as a cell decorator |
| Definitions | `define.ts`: `WeakMap<fn, Def>` (model table, calculated order, context entries, statics, option checks) |
| Instances | `instance.ts`: inputs, `render()` returning the cached vnode when nothing changed, children keyed in a Map, context, dispose |
| Actions | `actions.ts`: handlers get the pre-action state; STATE applied synchronously; driver sinks through one bus stream per sink per app with value-level scope tagging; PARENT to the parent's CHILD hub; EFFECT synchronous |
| Hosts | Collection, Switchable (hidden pages skip render) and tag children |
| Markers | Portal, Transition, ClientOnly, Lazy, Suspense register handlers on import (D157's tree-shaking saving) |
| Statics | the generic `__sygnalStatic` path, recomputed on commits that changed state |
| Hooks | `transformDef`, `onCreate`/`onDispose`/`onRender`, `onAction`/`wrapHandler`/`onReducer`/`onNext`, `wrapSources`, runtime-provided `setState`, for behaviors, persist, diagnostics, devtools and testing |

**Changes to the proposal:**
1. **Context dependency tracking (study 03 §5, §7 #7) is in (D168):** a view's context reads are recorded, and a context change re-renders only the components that read a changed key. Safety net: with diagnostics on, a sample of skipped views is re-run and a differing vnode is reported (a new SYG code, R4).
2. **The dual-core switch is internal.** It is selected by an internal option on `run()` (and an env flag for the test matrix), not a documented `run({ core })` option, and it is deleted in R5.
3. **Every fix pass gets a review** (PLAN-4.5 lesson: R2 introduced G-283).
4. **The flush contract** (spike finding 3): actions drain run-to-completion; a flush renders top-down, recomputes statics, drains anything queued, and repeats until stable; then it emits one vnode. A loop guard (100 passes, then a `MessageChannel` hop, no timers) replaces G-260/G-283's timers.
5. **R0 writes the parity tests first:** the §5 timing changes, the reentrancy cases, and PLAN-4.5's race scenarios (G-257 one-patch move, G-266 INITIALIZE before intent, G-283 runaway loop) as tests both cores must pass, or that document the intended change.

## 3. Phases

| Phase | Content | Exit | Size |
|---|---|---|---|
| **0-S** spike ✅ (met all criteria) | Extend the prototype with calculated fields, Collection filter/sort/move, Switchable with hidden pages, Suspense/READY/Lazy, a generic static, fetch scope tagging, one behavior via `transformDef`, action-log hooks, reentrancy; measure speed, counts and size; project the production size | Go/no-go against §4's criteria | — |
| **R0** decisions and parity tests | §9 answered; `Hooks` contract written; the spike's 40 tests ported into a parity suite, plus the reentrancy and race tests, failing first where the behaviour changes | User decisions; tests reviewed | 0 |
| **R1** runtime | `src/core/`: runtime, cells, define, instance, actions, tag children, registry; the DOM driver's `SymbolTree` O(n²) fix; the pragma emits `data.c = fn` (no per-render options object); both cores selectable | Canonical-subset tests and examples green on both cores | measured, not gated (both cores ship in dev builds only) |
| **R2** hosts and markers | Collection, Switchable, marker registry: Portal, Transition, ClientOnly, Lazy, Suspense/READY, Slot | `browser-tests` green on `next` | — |
| **R3** extensions | Statics, replies, fetch/socket scope chains, commands, ELEMENT, controls; behaviors/undo/selection/persist via `transformDef` | PLAN-3/4 suites green on `next` | — |
| **R4** tooling and integrations | Diagnostics, devtools (inspection view, time travel via `setState`), testing (`renderComponent` via hooks; no `NEXT_LOG` parsing), SSR, Vike, Astro, `sygnal/element`, `sygnal/vite` HMR | Full `npm test` on `next`, docs samples, perf gate | — |
| **R5** cut-over | Default to `next`; delete the old core, the `cycle/state` chains, `scheduler.ts` gates and holds, and the `tearDown` patch; lower the count gate; update docs/llms/skill for §5 and §9; regression eval | All gates; size below 41,343 B | gated |

After each phase: a `/code-review high` of the phase diff (and of each fix pass), the timing report with a `next` column, and the tracker updated.

## 4. Gates

- **Every merge:** all of PLAN-4.5's gates:
  - build, vitest, examples, types, browser tests;
  - the count gate, sygnal-check, docs samples, error docs, docs build;
  - the size gate, the llms.txt line cap and identity, the SKILL.md cap.
- **Test matrix during R1–R4:** the vitest and browser suites run on both cores (`SYGNAL_CORE=next`). A test may be marked current-core-only only when it tests an internal that R5 deletes (listed in the tracker), never to skip a behaviour.
- **Count gate (R5 targets):**
  - patches 1;
  - streams per simple Collection item ≤ 2 (only what the user's intent creates);
  - `setTimeout`s to unmount 1k ≤ 2;
  - ScopeCheckers 0;
  - heap ≤ 1.0 MB.
- **Timing targets** (warn-only, ratio to React):
  - mount 1k ≤ 2×;
  - Collection create/replace ≤ 1.5×;
  - Collection remove ≤ 1.5×;
  - Collection select ≤ 8× (now 17×; the rest is snabbdom-bound);
  - leaf 30 deep ≤ 1.5×.
- **Size:** gated core at R5 below 41,343 B (the spike projects it; §9 Q10).
- **Spike 0-S go criteria:**
  - mount 1k and Collection create/replace/select/remove at least 1.5× faster than the current core;
  - projected production core ≤ 41,343 B;
  - the PLAN-4.5 race scenarios impossible by construction;
  - every semantic difference listed.

## 5. Behaviour changes (CHANGELOG `[Unreleased]`)

| Change | Breaking? | Who notices |
|---|---|---|
| A STATE reducer is applied synchronously when its action is processed (not in a microtask) | Timing only | Code reading `STATE.stream._v` between an action and the next microtask; tests that awaited a microtask "for the reducer" |
| Intent subscribed at creation; INITIALIZE synchronous; BOOTSTRAP in a microtask after the first commit (not at 10 ms) | Timing only | Tests with fake timers that advanced 10 ms for BOOTSTRAP (renderComponent's waits hide it). Removes D153's first-render gate and the G-284 fake-timer caveat |
| Driver/sink values reach drivers in the same order, possibly earlier in the tick (no ancestor hubs) | Timing only | Nothing documented |
| Every non-STATE sink sees the pre-action state (the documented rule), with no `STATE_SNAPSHOT` bookkeeping | No | — |
| The §9 API removals (D162–D164) | **Yes** | Migration guide; SYG50x strict codes flag most; at runtime a one-time dev error links to the guide (D173) |
| Context changes re-render only components that read a changed key (D168) | No (fewer renders) | A view relying on re-rendering for a side effect (not supported) |
| Id-less Collection items under filter/sort keyed by raw index; duplicate ids warn in dev (D169) | Fix | Apps relying on the latent filtered-index keying |

## 6. Process

- PLAN-4.5's coordinator model, worktree rules, brief template, failing-first tests, file ownership and phase-close reviews apply. Plus PLAN-4.5's lessons:
  - review fix passes too;
  - never merge into the integration worktree while an eval packs it;
  - prefix scratch files per workstream (G-250);
  - cross-check eval regressions by running each run's trial tests on the other build.
- **Branch:** `plan46-integration`, cut from `plan45-complete`, with the study merged. Phase branches are `p46-<id>`.
- **Tracker:** `PLAN-4.6-status.md`. Decisions continue from **D160**, gaps from **G-290**.
- **Serial:**
  - R1 → R2 → R3 → R4 → R5, each owning `src/core/**`;
  - R3 and R4 may split by area (extensions vs tooling) once R2 lands, with disjoint file ownership.
- **Eval:** one regression eval at R5 (Sygnal tiers 1–2 + ergo on Opus, ≈ $27), plus a Haiku tier-1 run if the §9 removals change agent-facing docs (≈ $5).
- **PLAN-5 handoff:** a note that PLAN-5 rebases onto `plan46-integration`, inherits the hooks API (widgets and browser sources use `transformDef`/statics, not instance patching) and the lowered gates.

## 7. Out of scope

- Replacing xstream (streams stay at the edges) or snabbdom.
- Signals.
- New canonical forms.
- Pragma or DOM-driver speed work beyond `data.c`. Single-view ops are bound there; a later plan can take it.
- Fixing G-282 (`renderComponent` `props` option): that is new public API, which PLAN-5 owns. R4 keeps the hook it would need.

## 8. Risks

| Risk | Mitigation |
|---|---|
| The production core keeps less of the prototype's gain | Spike 0-S measures the hard features before commitment; go/no-go criteria in §4 |
| Large share of tests poke internals | Test matrix on both cores; internal-only tests listed and ported or deleted in R5; behavioural suites (examples, browser, docs samples, evals) are the parity bar |
| Reentrancy (drivers emitting synchronously during sink delivery: event bus, `driverFromAsync` early replies, G-176/G-189) | R0 failing-first tests; FIFO run-to-completion rule |
| Extensions (behaviors, persist, action log, testing, devtools) all move at once | Hooks contract written in R0; R3/R4 each port with their own suites green on both cores |
| Third timing change in one release (PLAN-4.5, now this) | Release is held; users see one change. Docs/llms describe the final model once, at R5 |
| Size during R1–R4 (two cores) | Size gated only at R5; dev builds may carry both |
| Scope creep into PLAN-5 | §7; PLAN-5's features only via the hooks contract |
| Effort (est. 2–3× PLAN-4.5) | Phase exits are independently mergeable; the old core stays the default until R5, so the plan can pause after any phase |

## 9. Decisions (answered 2026-10-04; D161–D170 in the tracker)

All recommendations below were accepted, with these changes: Q4 context tracking is **in** (D168); Q19 superseded: hidden pages keep today's render-on-first-show, **no new prop** (D172, replacing D166); Q8 includes `<Collection of="Name">` (D163).

**Plan:**

| # | Question | Recommendation |
|---|---|---|
| P46-Q1 | Run PLAN-4.6 before PLAN-5, if spike 0-S meets §4's criteria | Yes |
| P46-Q2 | Policy: 6.0 may remove alternative/undocumented forms that cost core complexity (reverses PLAN-1's "nothing is removed" for this major), with a migration guide | Yes |
| P46-Q3 | Size target | Gated core below 41,343 B at R5; PLAN-5 inherits the freed bytes |
| P46-Q4 | Context dependency tracking | Not in this plan (§2) |
| P46-Q5 | Eval spend | ≈ $27 Opus regression at R5; + ≈ $5 Haiku tier 1 if agent docs change |

**Removals** (study 02; "needed" = the simple core depends on it, "saving" = code/complexity only):

| # | Form | Status today | Kind | Recommendation |
|---|---|---|---|---|
| P46-Q6 | `DOMSourceName` / `stateSourceName` | Alternative; can't work under `run()` | needed | Drop (fixed `DOM`, `STATE`) |
| P46-Q7 | Public `component({...})` factory, `sources`/`isolateOpts`, `sygnalFactory`/`sygnalOptions` vnode props | Alternative ("most users won't need this") / undocumented | needed | Drop. Keep `defineComponent(opts)`, which returns an ordinary function component (a renamed, narrower factory: new public name) |
| P46-Q8 | `.components` registry, string tags, string `of`, `CHILD.select('Name')` | Alternative | needed (identity by function; keeps the pragma fast path) | Drop |
| P46-Q9 | `'ACTION \| SINK'` model keys | Alternative, SYG504 | saving | Drop (or keep at ~0 cost by normalizing once in `define.ts`) |
| P46-Q10 | `.peers` | Alternative (own guide page) | saving, and simplifies root detection (G-281/G-288) | Drop; migration: render the peer as a sibling |
| P46-Q11 | `hmrActions` | Alternative / near-undocumented | saving | Drop |
| P46-Q12 | Positional view args `view(props, state, context, peers)` | Alternative, SYG501 | saving | Drop |
| P46-Q13 | `storeCalculatedInState: false` | Alternative (one mention, no test) | saving | Drop |
| P46-Q14 | Single-stream intent; `.label` as a name; Collection `idfield`; context entry as a string or `true`; `CHILD.select()` with no argument; `__SYGNAL_HMR_*` declarations | Undocumented / dead | saving | Drop |
| P46-Q15 | `isolatedState` | Docs contradict each other | — | Keep (a local root cell); fix the docs |
| P46-Q16 | Calculated `boolean` entries in the types | Types allow it, runtime throws | — | Fix the types |

**Timing** (§5):

| # | Question | Recommendation |
|---|---|---|
| P46-Q17 | Synchronous STATE reducers; INITIALIZE at construction; BOOTSTRAP a microtask after the first commit | Accept |

**Raised by spike 0-S:**

| # | Question | Recommendation |
|---|---|---|
| P46-Q18 | Teardown: keep a `Stream.prototype._remove` swap scoped to `dispose()` (0 timers), or accept xstream's one `setTimeout` per stream (≈ 1–2k per 1k unmount) | Keep the scoped swap (it is PLAN-4.5's mechanism, narrowed); revisit if xstream ever exposes a synchronous stop |
| P46-Q19 | Switchable hidden pages: render each page at mount (today), or on first show (spike: cheaper mount, slower first show) | Render at mount, as today (no visible change; first show stays fast) |
| P46-Q20 | A child's `initialState` when its state slice is undefined: today SYG405 + error fallback; the spike used it as the slice | Keep today's behaviour (SYG405); `isolatedState` is the documented way to own state |
| P46-Q21 | Within one action, a component that declares a static has its driver values buffered until after the static (G-158), so an EFFECT may run before an earlier-listed driver send | Accept; undocumented ordering. Document "sinks of one action run in model order, statics first" if anyone asks |
| P46-Q22 | `STATE.stream` / `STATE.watch` change detection: the spike compared shallowly at the flush; today `stream` drops repeats by identity and `watch` compares deeply | Keep today's semantics exactly (identity for `stream`, deep for `watch`) |
| P46-Q23 | Collection: id-less items under filter/sort keyed by raw index (spike) vs filtered/sorted index (today, looks like a latent bug); duplicate ids share one instance (write to the first) | Raw index (fix the latent bug; CHANGELOG); duplicate ids → a dev warning |
