# PLAN-4.6 Status Tracker

Tracks progress for [PLAN-4.6.md](PLAN-4.6.md) (component core rewrite). The coordinator maintains it.

**Numbering:** decisions from **D160**, gaps from **G-290** (PLAN-4.5 ended at D159 / G-289).

**Integration branch:** `plan46-integration`, cut from `plan45-complete` (`d900c522`) on 2026-10-04, with `claude/component-core-rewrite-experiment` (the study) merged (`45eefb2`). Worktree `.claude/worktrees/plan-4-execution-7ae8e8`. The release stays held (D56).

**State:** R0–R5 merged: one core. Review of R5 running; then P46-EV (user's terminal) and close-out.

## Phases

| ID | Phase | Status | Branch | Merge | Notes |
|---|---|---|---|---|---|
| 0-S | Spike: prototype + hard features, measure, project size | ✅ merged | `p46-spike` (`3d8af23`) | 2026-10-04 | **Go**: 40/40 tests; mount 1.9–2.2×, Collection 1.6–9× faster; kanban 30.4 KB (proj. 35–37 KB vs 41.3); streams/item 1; race class impossible. Findings → PLAN-4.6 §1a, Q18–Q23 |
| R0 | Decisions, hooks contract, parity/reentrancy/race tests | ✅ merged | `p46-r0` (`f48a112`) | 2026-10-04 | `src/core/hooks.ts` + 04-hooks-contract (13 consumers mapped); `test/parity/` 74 tests (53 pass + 21 expected-fail on current); 06 inventory (41 port, 17 delete at R5, 9 current-only); G-290 fixed (−2 B); 05 migration draft |
| R1 | Runtime core (both cores selectable) | ✅ merged | `p46-r1` (`4d91475`) | 2026-10-04 | `src/core/` ≈1,600 lines (9.6 KB gz alone); `test:next` in `npm test` (148 pass, 45 skipped for R2–R4); parity on next 31 pass; 6 of 9 examples pass on next (the rest need R2). Tags page: mount 2.0×, update-1 2.4×, unmount 2.3× faster; 1 stream per component. Size gate fails as planned (both cores: 49,289 B) → D175 |
| R2 | Hosts and markers (+ D174, D175, D166 test rewrite) | ✅ merged | `p46-r2` (`62cfaec`) | 2026-10-04 | Collection/Switchable hosts, marker registry (Portal, Transition, ClientOnly, Lazy, Suspense), D174 `resetState`, D175 strip (size 41,474 B), R1 review fixes. Next core: parity 64 pass / 15 skip; test:next 318; all 9 examples; browser 155/186 (rest R3–R5). Collection create 1.8×, replace 2.8×, select 2.2×, remove 10×, mount 2.2× faster; streams/item 1–2 |
| R3 | Extensions (statics, replies, commands, behaviors) | ✅ merged | `p46-r3` (`b0613ee`) | 2026-10-04 | Statics (generic path, G-158 buffering), replies, fetch/socket `isolateValue`, commands/ELEMENT/controls, `resources`/`uses` at definition time, persist via a root shim, View Transitions; R2 review fixes. Next: parity 78 pass / 4 skip (R4/R5); test:next 720; browser 175/186 (rest R4/R5). Timers page create 52 → 32 ms, persist create 45 → 25 ms; fetch rows 28 → 2 streams, 1,006 → 2 timeouts; fetch replies: 1,001 patches vs 97 → R4 (D180). Size 41,453 B |
| R4 | Tooling and integrations | ✅ merged | `p46-r4` (`4574951`) | 2026-10-04 | Diagnostics/devtools via hook layers from `__SYGNAL_DIAGNOSTICS__.layers`; renderComponent as one hook layer (D176 internal: every documented pattern passes on both cores); SSR `data.c`, Vike, Astro, element, HMR. New dev codes SYG423 (context skip check), SYG424 (duplicate id), SYG425 (isolatedState missing keys), SYG612 (removed in 6.0). Next: root suite 2,695 pass, examples 9/9, browser 183 (+3 R5), perf gate (streams/item 1, unmount timers 2, heap 0.67 MB). `src/core` 47.0 KB min / 17.4 KB gz; kanban with both cores 51.7 KB gz |
| R5 | Cut-over, delete old core, gates, eval | ✅ merged | `p46-r5` (`6ce8a90`) | 2026-10-04 | Old core deleted (−10.6k lines); removals D162–D164 (+ SYG211/213/413/414/419/601/604/605/607/901–903 retired; SYG501/504/506 → "Removed in 6.0", static SYG612 rule in sygnal-check); `defineComponent`; migration guide (`guide/migrating-to-6`); docs/llms/skill/CLAUDE.md updated; count gate: streams/item 1, unmount timers 2, heap 1.0 MB. vitest 2,582, browser 184, examples 9/9. Kanban **40,608 B** (−735 B vs PLAN-4.5); `src/core` 17.4 KB gz. Mount 1k 38.9 → 17.8 ms (1.4× React); Collection replace 56.6 → 23.6, remove 12.2 → 1.4 (1.0× React), create 10k 899 → 238 (beats React) |
| P46-P | Spike: pragma/snabbdom hot path for select ops (D186) | 🟡 running | `p46-perf-spike` | | measured only; findings decide whether a small perf phase follows |
| R6 | Fixes from the R5 review (G-336…G-347), D184 llms line, D185 size gate | ✅ merged | `p46-r6` (`c9e3e56`) | 2026-10-04 | All 12 fixed; pragma corpus restored; `'dispose'` AppErrorPhase (G-267 errors now reported); `resetState` llms line (291 lines); size gate failing again at 42,300 B: **40,766 B** (1,534 B headroom). vitest 2,688, browser 184, sygnal-check 498 |
| P46-EV | Regression eval (Opus tiers 1–2 + ergo; Haiku tier 1) | ⬜ | | | after R6 and P46-P |

## Decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D187 | 2026-10-04 | R6 follow-ups, folded into the post-spike pass: add the `'intent'` and `'context'` phases the core already reports to `AppErrorPhase` and the error-boundaries table; the SSR portal placeholder gets the `sygnal-portal` class so hydration patches it (G-318 path); trim the pragma's stale `SPECIAL` entries (G-146 stamp, `sygnal-factory`) if the perf spike doesn't already | Coordinator |
| D186 | 2026-10-04 | Collection select (7.5× React) and single-view select (6.5×) are above their warn-only targets; the remaining cost is the JSX pragma and snabbdom's diff. A small measured spike (P46-P) on that path runs before PLAN-5 | User |
| D185 | 2026-10-04 | Size budget for the new core: keep the D48 gate at **42,300 B** (kanban, nativeGlobalThis false) and re-enable it as a failing gate; PLAN-5 starts with 1,692 B of headroom (kanban 40,608 B) | User |
| D184 | 2026-10-04 | Agent context: `resetState` gets one `llms.txt` line (canonical for an `isolatedState` child bound to a parent slice; SYG425 points to it); `defineComponent` stays docs-only, not canonical (function + statics is the one form); SKILL.md unchanged | User |
| D183 | 2026-10-04 | R4 perf pass: fetch replies keep one patch per reply (they resolve in separate macrotasks; joining them would need a timer or frame wait, which the design rules out; a bounded microtask hop changed nothing). A context Proxy per instance was reverted (no gain; it would keep a context object passed as a prop identical across renders). b023: an action's EVENTS cascade finishing before the next simulated input is covered by D165 (FIFO run-to-completion) | Coordinator |
| D182 | 2026-10-04 | No intermediate releases come off `plan46-integration` until the new core is complete, so the old core's size budget (size gate ≤ 42,300 B) no longer gates PLAN-4.6 merges (D175's strip stays, harmless). Each merge reports the **new core's size** for information: `src/core/**` alone (min + gzip) and kanban on the next core. The new core's budget is decided at the end of the plan (replaces D170's "below 41,343 B at R5" target) | User |
| D181 | 2026-10-04 | SYG401's explanation text (sygnal-check `explanations.js:339`) is reworded for D178 at R5 with the other docs | Coordinator |
| D180 | 2026-10-04 | Replies resolving in separate microtasks get one flush/patch each on next (fetch page: 1,001 patches vs 97 on current; latency still better, 249 vs 272 ms). R4's perf pass measures bounded coalescing (e.g. wait an extra microtask hop while commits keep arriving, no timers) on the fetch page, keystroke and leaf update, and keeps it only if latency doesn't regress. Internal; no API | Coordinator |
| D179 | 2026-10-04 | D174's seed-only-while-undefined rule and `resetState` apply to lens bindings as well as `state="key"` (same "no silent overwrite" intent) | Coordinator |
| D178 | 2026-10-04 | A Collection whose `from` key is missing at creation renders once the key appears (today: SYG401 and nothing for its life, `src/component.ts:1432`); SYG401 still warns; its text becomes "renders nothing until it exists". CHANGELOG fix | Coordinator |
| D177 | 2026-10-04 | Duplicate Collection ids: only the first item renders, with the D169 dev warning (today one instance's vnode is placed twice, which snabbdom can't patch correctly). CHANGELOG | Coordinator |
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
| G-294 | review R1 | High | core/instance | A change inside a named `<Slot>` never re-renders the child (dirty check compares only the default slot). Confirmed | Fixed (R2) |
| G-295 | review R1 | Med | core/instance | A child whose intent throws during subscribe has already seeded state, fired onCreate, queued INITIALIZE and joined watchers; never disposed. Confirmed | Fixed (R2) |
| G-296 | review R1 | Med | core/runtime, testing | Sink values emitted during start() are dropped before renderComponent/run() callers attach listeners. Confirmed | Fixed (R2) |
| G-297 | review R1 | Med | core/runtime | Removing a hook layer also removes layers added after it. Confirmed | Fixed (R2) |
| G-298 | review R1 | Med/Low | core/runtime | No catch around the flush: a throwing lens/hook freezes the app with no onError. Confirmed | Fixed (R2) |
| G-299 | review R1 | Low | testing | TDZ `retry` error when renderComponent's start fails on next. Confirmed | Fixed (R2) |
| G-300 | review R1 | Low | core/actions | `next()` timers not cleared on dispose | Fixed (R2) |
| G-301 | review R1 | Low | core/runtime | `api.flushed()` never resolves after dispose or a throwing flush | Fixed (R2) |
| G-302 | review R1 | Low | core/teardown | Disposed streams stop at the end of the flush instead of the next macrotask (a shared `.remember()`/`periodic` remounted in the next flush restarts). Coordinator: restore xstream's macrotask stop via the existing macro ping (no setTimeout) | Fixed (R2) |
| G-303 | review R1 | Low | core/runtime | Driver errors skip `hooks.onError` | Fixed (R2) |
| G-304 | review R1 | Low | core (efficiency) | Per-render allocations (isolate key, context Proxy, handler props), O(watchers) notify per action, full-tree flush walk | Partly (R2: isolate-key cache reverted, no gain; rest → R4 perf pass) |
| G-305 | review R1 | Low | mock DOM | Scope check matches by prefix (`s1` vs `s14`) | Fixed (R2) |
| G-306 | review R2 | High | core/cell | Id-less Collection item gets a made-up `id` written back; after a removal it collides with a sibling's index key and one item disappears (regression). Confirmed | Fixed (R3) |
| G-307 | review R2 | Med | core/cell | `id: 0` treated as no id; ids and indices share a key space; `'1'`/`1` same uid. Confirmed | Fixed (R3) |
| G-308 | review R2 | Med | core/collection | D178 not implemented (missing `from` never renders). Confirmed | Fixed (R3) |
| G-309 | review R2 | Med | core/instance | SEED re-check missing at drain: a parent action queued before it is overwritten (D174/D179). Confirmed | Fixed (R3) |
| G-310 | review R2 | Med | core/lazy | A failed lazy import stays "loading" forever (regression). Confirmed | Fixed (R3) |
| G-311 | review R2 | Med/Low | core/runtime | Flush catch leaves partial bookkeeping (stale siblings, stale Collection, undrained queue) | Fixed (R3) |
| G-312 | review R2 | Low/Med | core/runtime | Layered `transformDef`/`wrapSources`/`wrapHandler` lose lower layers when an upper returns void. Confirmed | Fixed (R3) |
| G-313 | review R2 | Low | core/runtime | `early` flag never cleared after a throwing first flush | Fixed (R3) |
| G-314 | review R2 | Low | core/cell | Lens-bound isolated child has no `initialState` default (D179 parity with key binding). Confirmed | Fixed (R3) |
| G-315 | review R2 | Low | build | Two top-level `xs.create()` calls survive the D175 strip | Fixed (R3) |
| G-316 | review R2 | Low | core/portal | Late-target Portal retry can double-mount or leak (inherited) | Fixed (R3) |
| G-317 | review R2 | Low | core/hosts | `lazy()` as a Collection `of` or Switchable page never resolves (same as today; coordinator: fix on next) | Fixed (R3) |
| G-318 | review R3 | High | core/portal | A Portal first reached by a patch (SSR hydration, or swapping a `<div>` for a `<Portal>` at the same position) never mounts (regression). Confirmed | Fixed (R4) |
| G-319 | review R3 | Med | core/hosts | A Collection inside a hidden Switchable page isn't reconciled while hidden: removed rows keep running background statics, new rows don't start them. Confirmed; coordinator: fix for parity | Fixed (R4) |
| G-320 | review R3 | Low/Med | core/runtime | Statics step skipped while renders throw. Confirmed | Fixed (R4) |
| G-321 | review R3 | Low | core/cell | Write-back strips a real id equal to the row's index. Confirmed | Documented limit (05 §3.4; today's item state carries the injected index id too) |
| G-322 | review R3 | Low | core/cell | `uid()` collides between index keys and id keys (duplicate DOM ids). Confirmed | Fixed (R4) |
| G-323 | review R3 | Low | core/statics | A new statics-declaring instance forces an extra full render pass. Confirmed | Fixed (R4) |
| G-324 | review R4 | High | testing | Child-only fake replies never reach an intent-less component (silent test failure). Confirmed | Fixed (R5) |
| G-325 | review R4 | Med/High | testing | False SYG102 for a root with a model and no intent under renderComponent + dev entry. Confirmed | Fixed (R5) |
| G-326 | review R4 | Med | testing | The input-armed `t.next()` cursor never expires (documented "move the clock by hand" pattern returns a past state). Confirmed | Fixed (R5) |
| G-327 | review R4 | Med | diagnostics | SYG423 false positives for non-deterministic views. Confirmed | Fixed (R5) |
| G-328 | review R4 | Med | portal | Portal ↔ plain div at the same position keeps adding content to the target (pre-existing, both cores). Confirmed | Fixed (R5) |
| G-329 | review R4 | Low/Med | diagnostics | SYG612 false positive for uppercase real elements (`h('SPAN')`). Confirmed | Fixed (R5) |
| G-330 | review R4 | Low/Med | core/runtime | A throwing dev layer factory stops `run()`. Confirmed | Fixed (R5) |
| G-331 | review R4 | Low | core/runtime | One throw in `handle()`/a SET item discards the rest of the queue | Fixed (R5) |
| G-332 | review R4 | Low | diagnostics | SYG612 `seenDefs` not reset by `resetChecks()`. Confirmed | Fixed (R5) |
| G-333 | review R4 | Low | diagnostics | SYG425 warns for `initialState` keys whose value is `undefined` | Fixed (R5) |
| G-334 | review R4 | Low/Med | tests | Three excluded tests cover kept behaviour with removed-form fixtures; port, don't delete (§4) | Fixed (R5) |
| G-335 | review R4 | Low | testing | Array/Date child-sink values recorded as plain objects (pre-existing) | Fixed (R5) |
| G-336 | review R5 | Med/High | sygnal-check | Static SYG612 (error, always on) flags non-component objects (`draft.peers = []`, `registry.components`) and any `<Collection>`; opens the Vite overlay; `--fix` deletes fields on any object. Confirmed | Fixed (R6) |
| G-337 | review R5 | Med | sygnal-check | `--fix` removal under a braceless `if` makes the next statement conditional. Confirmed | Fixed (R6) |
| G-338 | review R5 | Med | core/instance | Single-stream intent fails with a misleading SYG603, not the removed-form message. Confirmed | Fixed (R6) |
| G-339 | review R5 | Med | docs/explanations | SYG403 text recommends the removed context forms. Confirmed | Fixed (R6) |
| G-340 | review R5 | Low | explanations | SYG101/102/411 texts describe removed forms | Fixed (R6) |
| G-341 | review R5 | Low/Med | tests | Pragma characterization corpus deleted though the pragma is unchanged (§4 coverage). Confirmed | Fixed (R6) |
| G-342 | review R5 | Low | tests | Four deleted tests cover kept behaviour (one hides a swallowed teardown error); children now passed unprocessed (undocumented). Confirmed | Fixed (R6) |
| G-343 | review R5 | Low | defineComponent | Inline views named "view"; view statics dropped; positional arity hidden from SYG612. Confirmed | Fixed (R6) |
| G-344 | review R5 | Low | docs | CHANGELOG overclaims SYG612 coverage; CLAUDE.md strict-mode line stale | Fixed (R6) |
| G-345 | review R5 | Low | docs | Portal placeholder class (G-328) not in CHANGELOG | Fixed (R6) |
| G-346 | review R5 | Low | testing | Each `simulate*` leaves a pending cursor-expiry timer. Confirmed | Fixed (R6) |
| G-347 | review R5 | Low | cleanup | Dead old-core residue (controlledInputModule render-seq, legacy.ts helpers, stale doc pointers) | Fixed (R6) |
| G-291 | 0-S | Low | Collection | Id-less items under filter/sort are keyed by filtered/sorted index (likely a latent bug) | → Q23 |

## Log

- 2026-10-04 — R6 merged (`c9e3e56`); all gates green, size gate failing-mode at 42,300 B (40,766 B). D187. Waiting on P46-P.
- 2026-10-04 — Review of R5: 12 findings (G-336…G-347; none in the core runtime's flush/state paths); R6 started.
- 2026-10-04 — D184–D186 (user): resetState in llms.txt; size gate back at 42,300 B; perf spike before PLAN-5 (P46-P started).
- 2026-10-04 — R5 merged (`6ce8a90`): one core; all gates green; kanban 40,608 B. Review of R5 started; eval held until its fixes land.
- 2026-10-04 — Review of R4: 12 findings (G-324…G-335), sent to R5.
- 2026-10-04 — R4 merged (`4574951`); full suite green on both cores. D183. R5 and a review of R4 started.
- 2026-10-04 — Review of R3: 6 findings (G-318…G-323, one regression), sent to R4. New core alone: 43.7 KB min / 15.9 KB gz (R1: 9.6 KB gz).
- 2026-10-04 — D182: size gate informational during PLAN-4.6; new-core size reported per merge; budget decided at the end.
- 2026-10-04 — R3 merged (`b0613ee`); all gates green (41,453 B); browser on next 175/186. D180, D181. R4 and a review of R3 started.
- 2026-10-04 — Review of R2: 12 findings (G-306…G-317, 2 regressions), sent to R3.
- 2026-10-04 — R2 merged (`62cfaec`); all gates green (size 41,474 B). D177–D179. R3 and a review of R2 started.
- 2026-10-04 — Review of R1: 12 findings (G-294…G-305), sent to R2.
- 2026-10-04 — R1 merged (`4d91475`); gates green except size (planned: both cores ship, 49,289 B). D174 (user: isolatedState keeps parent data, `resetState` prop, dev warning), D175, D176. R2 and a review of R1 started.
- 2026-10-04 — R0 merged (`f48a112`); all gates green (vitest 2,649 + 21 expected-fail; 41,341 B). D166 re-decided as D172 (keep today, no prop); D171, D173. R1 started.
- 2026-10-04 — §9 answered (D161–D170): go, removals approved, context tracking in, opt-in lazy Switchable pages. R0 started.
- 2026-10-04 — Spike 0-S merged (`3d8af23`): go. PLAN-4.6 updated (§1a, Q18–Q23). Perf gate green after merge; spike suite 40/40.
- 2026-10-04 — Study reviewed (`claude/component-core-rewrite-experiment`). `plan46-integration` cut from `plan45-complete` with the study merged. Spike 0-S started; PLAN-4.6 drafted. D160.
