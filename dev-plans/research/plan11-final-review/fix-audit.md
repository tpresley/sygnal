# PLAN-11 independent fix audit

The coordinated fixes address the concrete F1–F8 findings in the reviewed source. Two further
lifetime gaps found during this audit—cleanup reading missing state and missed Collection
array absence—were corrected by the binding owner and passed an independent exact-source
check. No remaining concrete defect was identified within this audit's scope. This is not a
claim that final release gates, package refreshes, or all possible lifecycle cases have passed.

## Findings and verification boundaries

| Finding | Reviewed result | Evidence / boundary |
|---|---|---|
| F1: hidden descendants survive target loss | Owners observe known-target presence at existing action notifications; hidden descendants are invalidated without waiting for their views. | Independent exact-source checks confirm hidden replacement remains deferred until shown. Permanent coverage: `test/p11-hidden-binding.test.js`. Final coordinated runtime suite remains the coordinator's gate. |
| F2: mixed effects overwrite the cancellation signal | The before adapter restores snapshots and then preserves the runtime-owned `signal`. | Inspected `src/extra/sinkTiming.ts`; the runtime signal is assigned after saved props. Both-order regression coverage belongs to the timing suite. No new independent F2 test run is claimed here. |
| F3: closing a tab loses focus | The published model uses `previousState.files` to find the neighbor under after timing. | Inspected the recipe and `test/p11-tabs-guide.test.js`: selected first/middle/last closes and final empty state are exercised with real DOM focus. Execution is part of the coordinator's final gates. |
| F4: checker loses STATE branch preconditions | Literal transitions retain supported equality, exclusion, and truthiness facts; infeasible paths and guards already rejecting before STATE are excluded. | Permanent ternary/if/boolean regressions retain the original idle-to-working warning. Full checker verification below passed. |
| F5: prototype getter invalidates timing evidence | Noncomputed `__proto__` option declarations make timing opaque, including known spread origins. | Permanent helper and end-to-end checker regressions. An additional SYG255 spread-validation crash exposed by those tests was fixed and covered. |
| F6: queued PARENT work reaches a removed ancestor | Presence-loss disposal occurs before the drain advances to later queued work; disposed subtree actions are skipped. | Inspected the coordinated action-notification path and mock/real DOM regressions in `test/p11-queued-parent-loss.test.js`. Final execution is the coordinator's gate. |
| F7: remove/reinsert between renders revives work | Known-target disappearance is observed between actions, without requiring an intervening render. | Independent host checks confirm old signals abort and captured old next() cannot change same-ID replacements. Timer/HTTP mock/native-click coverage is in `test/p11-between-render-loss.test.js`. |
| F8: simulated-input timeout hides its backlog | State waits report pending simulated-input count; the testing guide distinguishes serialized simulation from native bursts. | Inspected timeout construction and permanent `test/p11-simulated-input-timeout.test.js`; no sequencing/API change is introduced. Final execution is the coordinator's gate. |

## Additional lifetime defects found and corrected

1. Disappearance initially called `DISPOSE` after the bound cell had become undefined. A normal
   `DISPOSE: { EFFECT: state => cleanup(state.title) }` failed instead of cleaning up. The fix
   preserves the latest owned snapshot, including updates made before the next render, and
   prevents cleanup writes from recreating the deleted target. The independent test performs
   UPDATE then DROP without awaiting a render and verifies cleanup receives the updated title.
   Permanent broader coverage is in `test/p11-lifetime-cleanup.test.js`, including descendants,
   calculated values, Switchable pages, and falsy-but-present state.
2. Presence checks initially ignored `CollectionHost.arr`, leaving Collection and
   VirtualCollection lifetimes active when a known `from` path disappeared. A second gap
   normalized a missing byId-array lens to `[]`, concealing absence. The binding owner added
   array-cell observation and preserved raw lens presence. Independent path and byId-array
   cases now abort old signals and reject captured old delayed actions after replacement.

A suspected STATE.stream sequencing change was withdrawn: actual HEAD already notified after
each action. A private experiment that removed that existing notification was not a valid
baseline. No STATE.stream regression is asserted.

## Completed independent evidence

- **Exact current-source snapshot: 7 tests passed.** The temporary project copied production
  sources and the parity harness, without research prototype patches. It checked latest cleanup
  state, deferred hidden replacement, unchanged STATE.stream sequencing, and Collection plus
  VirtualCollection disappearance/replacement through both paths and byId-array lenses.
  Runner: `/private/tmp/sygnal-notify-review.mjs`; evidence:
  `/private/tmp/sygnal-notify-review-final-candidate.log`. These temporary files are session
  evidence, not portable release fixtures; permanent regressions are named above.
- **Full checker: 1,723 passed, 4 skipped; 78 files passed, 1 skipped.** Run after F4/F5 and
  the SYG255 spread fix, with loopback/watcher access. Evidence:
  `/private/tmp/sygnal-p11-f4f5-checker-final.log`. Focused guard/context/binding/range/explanation
  verification passed **467 tests**. The changes add **27 permanent regressions**.
- **Editor refresh:** VS Code **18 unit tests**, typecheck, and build passed after these checker
  fixes; its generated fallback checker includes the current constraints/prototype handling.
  No runtime dist build or publishing was performed by this audit.

## Final notification-version cache inspection

Read-only inspection of the final per-App `nv`/`ver` guard found no missed-registration or
ordinary disposal/stream-delivery defect. No additional test run is claimed for this review.

- Root and isolated-local cell writes call `commit()`, which advances `ver`; distinct queued
  state changes therefore remain distinct notifications. The guard only skips a later notify
  pass at an already observed version.
- A newly requested STATE source primes its current value and `stLast` before registering.
  A newly registered binding owner captures the child's current binding state during
  reconciliation. Neither needs an extra same-version notification to acquire its baseline.
- `nv` is assigned before iterating watchers. A reentrant notification after another committed
  write sees the newer version; a write without immediate reentry leaves a newer version for
  the next call. Per-instance stream identity checks still prevent duplicate values.
- Disposal removes watchers, and iteration uses the existing live Set semantics. Presence-loss
  disposal forces the owner dirty; the state write already scheduled rendering. Hidden owners
  remain invalidated until shown, while fresh missing-state lifetimes retain their documented
  initialization rules.

The binding owner's separately reported focused tests cover STATE.stream `[1, 2]` delivery and
missing → present → missing before rendering. Their results are supporting evidence, not a new
independent run here. The reported 42,993 B candidate and proposed 43,000 B ceiling are not
recorded as an approved or independently revalidated size pass in this audit.

## Remaining release risks and required gates

The lifetime source changed during coordination, so earlier passing runtime, size, retention,
browser, and packaging results cannot establish the final candidate's status. The coordinator
must finish the normal build, applicable full suites, size/performance/retention gates, docs and
shipped-guide checks, package inspection, and requested linked-project refresh against the
settled source. In particular, the approved size budget is not declared satisfied here.

Known boundaries remain deliberate: opaque custom lens targets need explicit identity;
hidden owners dispose lost descendants immediately but recreate them when shown; SYG256 is a
bounded static proof and a clean check does not prove arbitrary guard logic correct. No
unrequested general mutation analysis or runtime ABORT cancellation was added.

Publishing remains separate. Before an actual release, complete the documented dated 7.0.0
changelog/release-note preparation and ensure packaged runtime, checker, starter, editor, and
plugin artifacts correspond to the reviewed source. Root plan/status and final gate reporting
remain with the coordinator.
