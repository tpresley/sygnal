# PLAN-12 final prerelease review

Repository cleanup: temporary runners, prototype patches, duplicate repro fixtures and raw logs were archived outside the repository after implementation. Commands and filenames below describe the historical spike; maintained regressions live in `test/p12-*.test.js` and `sygnal-check/test/p12-*.vtest.js`. Summary reports and JSON measurements remain here.

**Original review outcome: hold 7.0 release.** The findings below describe the pre-fix candidate; original line numbers and failing counts are preserved as review evidence. F1–F8 are now implemented and their original 12 runtime reproductions/controls pass. Final implementation acceptance is complete; all release gates and refreshed links pass under the explicitly approved 43,000 B limit: see [implementation results](../plan12-f1-f8-implementation.md) and [independent fix audit](fix-audit.md).

No production source was edited during the original review; the linked packages at that time remained the user's test candidate. Findings came from independent timing, binding and tooling reviews, plus the
coordinator's documentation, package and release-workflow audit.

## F1 — P1: hidden descendants miss known-target disappearance

`src/core/instance.ts:449` only recurses during hidden-page `sync()`. Known-target presence
loss is checked at line 514 during reconciliation, which a hidden owner does not perform.

Reproduction: render an Editor bound with byId inside a Switchable page, start owned work,
hide the page, delete its record, then reinsert that ID. The old effect signal remains active,
and captured next('GOT', 'stale') overwrites the newly inserted record. A nested Switchable
host beneath the hidden owner also misses the deletion. This contradicts the accepted
target-loss lifetime contract and can corrupt restored data.

Three tests fail against an exact copy of current production sources, without research
prototype patches. Fix presence-loss processing during hidden synchronization, including
nested hosts, and invalidate cached output/reconciliation as necessary when shown again.
Decide and test fresh missing-lifetime initialization while hidden consistently with the
existing documented contract. Verify disposal, late next/replies, same-ID reinsertion, hidden
Collections/VirtualCollections/Switchables, restored object identity, and no stale cached DOM.
Keep the approved 42,950 B budget; current headroom is 39 B.

## F2 — P2: mixed EFFECT props can overwrite the runtime cancellation signal

`src/extra/sinkTiming.ts:21` restores saved pre-action props with `{...p, ...p[BEFORE]}`.
When a component receives a prop named signal and composes a before behavior EFFECT with an
after host EFFECT, the before adapter replaces the runtime effect's AbortSignal with the
external prop. The before behavior and after host see different signals; the former does not
abort on component disposal. Normal effect execution supplies the lifetime signal after user
props, so this is a mixed-timing regression.

The isolated test fails against current source. Preserve runtime-owned signal after restoring
snapshot props. Test both contributor orders and disposal while keeping previousState/state
snapshots and grouped EFFECT exception boundaries intact.

## F3 — P2: published tabs-close recipe loses focus after migration

`docs/src/content/docs/ui/tabs.md:125` calls neighbour(state.files, id) in ELEMENT after STATE
has removed id from files. The lookup returns undefined and ELEMENT returns ABORT. Closing
README selects main in state but emits no focus command. The explanation at line 133 still
claims all output reducers see old state. A built-in behavior's before declaration does not
change the host-authored CLOSE handler's default after timing.

Evaluating the actual published model confirms beforeFocus is the main-tab selector, whereas
afterFocusAborted is true. Use previousState.files for neighbor calculation (preserving its
existing behavior for selected/unselected closes), correct the prose and shipped offline copy,
and add a real-DOM recipe test that checks focus after closing first, middle and final tabs.

## F4 — P2: SYG256 discards STATE branch preconditions

`sygnal-check/src/rules/syg256-output-guard.js:88` visits STATE branches but discards their
conditions when recording literal writes at line 111. It reports this valid no-timing-change case:

```js
START: {
  STATE: s => s.status === 'working'
    ? { ...s, status: 'working', clicks: s.clicks + 1 }
    : ABORT,
  HTTP: s => s.status !== 'working' ? { url: '/work' } : ABORT,
}
```

When idle, STATE aborts and HTTP admits under either snapshot. When working, STATE increments
clicks but HTTP rejects under either snapshot. Switching the guard to previousState changes
nothing. This is not the write-induced migration contradiction the warning promises to prove.

Carry supported STATE path constraints into the proof and exclude transitions whose output
guard is already known to reject before STATE. Add ternary/if and boolean regressions while
retaining detection of the original idle-to-working self-blocking case and unknown-case skips.

## F5 — P3: a prototype accessor can invalidate timing proof

`sygnal-check/src/model/sinkTiming.js:107` excludes own accessors but accepts a noncomputed
__proto__ option. An inherited diagnostics getter can set this.sinkState to before before run
copies options, while the checker reports an after guard contradiction. The direct accessor
case is already excluded; the prototype case bypasses that exclusion.

Conservatively exclude noncomputed __proto__ option declarations from timing evidence,
including spread-origin cases. Add a regression; do not attempt to evaluate prototype getters.

## Linked-project stress feedback: deduplication

The user supplied [this stress-test report](linked-stress-report.md) after the initial review.
It tested the linked 7.0.0 runtime and 0.11.0 checker in a four-level component tree. Its
passing application/integration and checker scenarios add confidence but do not cover or
invalidate F1–F5. Its real DOM results use jsdom, not a browser-engine compatibility sweep.

| Report item | Disposition |
|---|---|
| BUG-1: queued PARENT after ancestor removal | New F6, P2; no matching initial finding |
| BUG-2: delete/reinsert before a render | New F7 regression, P1; related to F1's invalidation boundary, but visible instances also fail, so a hidden-sync-only fix is insufficient |
| Simulated input burst timeout | New F8, P3 testing/documentation friction; no runtime lost updates reported |
| Passing timing/checker/stress coverage | Supporting evidence, not additional defects; do not duplicate F1–F5 or interpret it as exhaustive lifecycle/performance proof |

## F6 — P2: queued PARENT work can reach a deleted ancestor before teardown

Report BUG-1 is a new action-delivery race. With Harness → byId Board → Collection Lane →
Collection Card, a Card action emits a global event that deletes Board and also emits PARENT.
The latter propagates up through Lane while the root deletion has already committed. Board's
queued CHILD.STATE and CHILD.PARENT reducers receive undefined and throw reading seen/id,
producing exactly two SYG216 diagnostics. The other board is preserved; this is caught reducer
failure during teardown, not an unhandled application crash.

`src/core/runtime.ts:161–178` skips already-disposed instances, but binding loss is processed
later in reconciliation (`src/core/instance.ts:514`). The queue can therefore invoke old work
after target deletion and before disposal. A local fixture confirms both mock and real DOM
modes with the same two diagnostics.

Ensure previously present lost-bound subtrees cannot execute later queued actions against
missing state. Preserve the current action's valid output/previousState semantics, FIFO order,
remaining records, and legitimate fresh missing-state initialization. Do not introduce a blanket
undefined-state rejection: fresh missing-state lifetimes are intentionally allowed to initialize.
Permanent tests should cover multi-hop PARENT plus EVENTS deletion in both DOM modes and
prove no SYG216 occurs while the surviving board remains unchanged.

## F7 — P1: absence between renders fails to end a known target's lifetime

Report BUG-2 shares F1's broader lifetime-invalidation gap but has a different trigger. Delete
and reinsert the same selected board ID synchronously before any render. Reconciliation sees
the same byId tuple and a present target, so the old subtree survives. Old delayed next() work
changes the new record's counter from 0 to 10; an old HTTP response can change its blank reply
to OLD LIFETIME. This happens for visible components, without the hidden-page condition in F1.

Handle presence loss at an observable state-transition/lifetime boundary rather than relying
only on a later rendered snapshot. Coordinate F1, F6 and F7 so render-only hidden-sync fixes
do not leave this race. A generation/tombstone mechanism is one research option, not an adopted
implementation. Preserve lifetime for ordinary immutable edits/reorders and fresh equivalent
byId helpers; a new object with the same ID is not by itself a remove/reinsert transition.

A local exact-source fixture independently reproduces the delayed-action and HTTP failures in
both mock and real DOM modes (four failures). It verifies no root render occurs between the
delete/restore operations. Two controls that await the deletion render pass.

Acceptance: delayed actions, owned effect signals and HTTP replies from the old subtree cannot
alter a same-ID replacement, including overlapping descendant IDs. Cover back-to-back mock
actions and synchronous native real-DOM clicks with no awaited render; retain the passing
delete → render → restore counterpart and missing-target/default behavior. Keep existing
functional/count/performance gates and the approved 42,950 B budget.

## F8 — P3: distinguish serialized simulated inputs from native input bursts

The input pump in `src/extra/testing.ts:2247–2261` intentionally waits for a quiet, patched tree
between real-DOM simulated inputs (QUIET_MS = 10 ms). A 200-input queue can exceed the default
2-second next()/waitForState() timeout without losing runtime writes. Native synchronous clicks
passed the reported 200-write stress case. eventWaitMs controls selector/render readiness,
not the inter-input quiet window.

Document this distinction in the testing guide: simulated inputs model serialized interaction;
native clicks are appropriate for a synchronous burst test, and long serialized tests need an
explicit timeout. Include pending simulated-input count in next()/waitForState() timeout
messages. settle() already includes this count, so extend the existing diagnostic rather than
claiming it is absent everywhere. Keep the current sequencing contract; no new timing option
or load-test API is required. This is testing ergonomics, not a runtime lost-update bug.

## Reproductions

From the repository root:

```sh
node dev-plans/research/plan12-final-review/run.mjs
node dev-plans/research/plan12-final-review/checker-and-tabs.mjs
```

The first copies exact current src plus the parity harness into a temporary project and runs
the runtime regression fixtures for F1/F2/F6/F7: **10 expected failures and 2 passing controls**
on the reviewed build. The linked-project additions contribute six of those failures (two
queued-PARENT cases and four stale timer/HTTP cases), plus the two controls. These are ordinary
red assertions of the desired contract, not tests that enshrine the bugs. It does not modify production or
dist. The second prints the two false checker warnings, before/after admission truth table,
actual copied before mode, and the published tabs model's lost focus command. Fixtures are
outside the normal suite so a review does not silently add known failing production tests.
Move the corrected regressions into the permanent suites with their fixes.

## Gates and packaging checked

- Latest standard build (immediately before review): all runtime outputs, declarations and
  shipped guides pass; no heap flags or isolated-config workaround.
- Fresh full `npm test`: **5,059 library tests pass**, 33 skipped; all **14 example suites**,
  public/source types, **377 browser cases**, WebMCP and graph suites, and count/performance/
  retention gates pass. Settled heap is **0.91 MB / 1.00 MB**.
- Fresh size gate: **42,911 B / 42,950 B**; default bundle **38,910 B**. No gate was raised.
- Fresh docs build: **112 pages**, 113-page link check and code-title check pass. Static sample
  check: **853 clean**, 26 marker-skipped, zero strict/a11y/pattern/parser findings.
- Latest full checker confirmation before this read-only review: **1,696 pass**, 4 skipped.
  These passing tests do not cover the new false positives above.
- npm dry-run packs include runtime CJS/ESM/types, migration guide, changelog and llms; checker
  pack includes version/timing helpers, SYG256 rule and explanations. All ten starter template
  guides are packed, and manifests require runtime ^7.0.0 / checker ^0.11.0. No research,
  test, secret or node_modules artifacts appeared in the runtime pack.

## Normal release preparation still required

- Rename the root changelog's Unreleased heading to the final 7.0.0 dated heading before
  publishing. The release workflow's awk extraction currently produces zero bytes. Its notes
  check occurs after npm publication, so do not discover this only after publishing. This is
  already an explicit RELEASING.md step, not a newly discovered runtime defect.
- Rebuild/package the VS Code extension after checker fixes: the existing ignored fallback
  server copy predates SYG256. Its normal build copies current checker source; no source fix is
  needed for this artifact freshness issue.
- Commit/review the coordinated runtime/checker/starter/editor/plugin changes and rerun the
  applicable gates after fixes. Publishing remains a separate action.
