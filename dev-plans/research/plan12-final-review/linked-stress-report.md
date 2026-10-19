# Linked Sygnal stress-test report

Two additional runtime lifetime bugs reproduced. The checker timing tests passed. Fieldnotes' eight existing integration tests remain unchanged and pass.

Tested local npm links: `sygnal@7.0.0` and `sygnal-check@0.11.0`, both resolving into `/Users/troy/Documents/Displera/sygnal` (checkout base commit `5e5205cb`, including its local changes). No framework source was modified. The test harness is separate from Fieldnotes' entry point and does not enter the production bundle.

## Reproduce

```sh
npm run test:stress      # 26 passing cases + 6 expected failures
npm run test:repro       # Show the six failures as ordinary red tests; exits 1 on this build
npm test                # Whole repo: 34 passing cases + 6 expected failures
npm run check           # TypeScript and strict checker: clean
npm run check:migration # Nine checker scenarios: all expected diagnostics/clean cases confirmed
npm run build           # Production build: passes
```

`src/stress/KnownIssues.test.ts` uses Vitest's `it.fails` in the ordinary suite. These are assertions of the desired contract, not assertions that the bugs should continue. A framework fix produces an unexpected pass, prompting removal of the marker. `test:repro` enables ordinary `it` to show the underlying errors. Both bugs reproduce using the default mock DOM and `dom: 'real'` (jsdom running Sygnal's actual runtime).

## BUG-1 — A child deleting its ancestor can leave queued PARENT actions reading undefined

**Suggested priority: P2.** A valid event/parent combination produces reducer exceptions during teardown. The error is caught and reported, rather than an unhandled app crash.

Four component levels:

```text
Harness → Board (byId selected board) → Collection<Lane> → Collection<Card>
```

The leaf action writes its own state, publishes a global event, and also notifies its parent:

```ts
DISMISS: {
  STATE: s => ({ ...s, n: s.n + 1 }),
  EVENTS: event('STRESS_DROP_SCOPE', s => s.owner),
  PARENT: s => ({ id: s.id, owner: s.owner, n: s.n, /* snapshot fields */ }),
}
```

The root hears `STRESS_DROP_SCOPE` and removes the selected board. Meanwhile, the leaf's `PARENT` payload propagates through the Lane and reaches Board's `CHILD` action.

**Expected:** Once the board target is deleted, the old subtree's queued work is dropped or otherwise prevented from invoking reducers against absent state.

**Actual:** `Board.CHILD.STATE` receives `undefined` and throws reading `s.seen`; its `PARENT` output also receives `undefined` and throws reading `s.id`. Both yield **SYG216**. The remaining board is preserved, but reducers from the removed subtree still run against missing state.

Reproduction: `KnownIssues.test.ts`, `BUG-1` (both DOM modes). The leaf action is in `Harness.tsx`'s `Card.model.DISMISS`; root handling is `Harness.model.DROP_SCOPE`. The assertion fails at `t.expectNoDiagnostics()` with exactly two SYG216 diagnostics.

**Possible cause, inferred from source:** `App.drain()` skips only instances already marked disposed; known-binding presence is checked later during `Inst` child reconciliation. Queued work can run in the gap between the root state change and reconciliation. This is a diagnosis hypothesis, not a proposed framework patch.

**Application workaround:** Route an ancestor-delete request through one ownership path instead of combining immediate ancestor deletion via EVENTS with further PARENT work from the same action. Defensive missing-state guards can avoid exceptions, but put lifecycle checks into application reducers.

## BUG-2 — Deletion and reinsertion before rendering preserve an old lifetime

**Suggested priority: P1.** Old delayed actions and HTTP replies can mutate a replacement record with the same ID.

1. Mount the four-level tree with `Board state={byId('boards', selected)}`.
2. In a leaf card, schedule `next('LATER', 10, 150)` or start an HTTP request.
3. Delete the selected board and reinsert a new board with the same ID synchronously, with no render between those two transitions.
4. Let the old delayed action run, or deliver the old HTTP response.

The real-DOM reproduction uses two synchronous native jsdom button `.click()` calls. The mock-DOM reproduction dispatches DELETE and RESTORE back-to-back. In both cases the replacement board is created from scratch with a zero counter and an empty reply.

**Expected:** Deletion ends the old known target's lifetime, canceling its delayed actions and requests. Reinsertion cannot revive them, as described in Sygnal 7's migration guide.

**Actual, delayed action:** the replacement card starts at `0`, then becomes **`10`** after the old timer fires.

**Actual, HTTP:** the old request is still pending; answering it successfully changes the replacement card's reply from `''` to **`'OLD LIFETIME'`**.

Reproductions: `KnownIssues.test.ts`, both `BUG-2` tests, each in both DOM modes. The normal counterpart—delete, wait for the deletion render, then reinsert—passes elsewhere in the suite, as do selection changes with overlapping descendant IDs. The failure specifically requires the target's absence to occur between renders.

**Possible cause, inferred from source:** `Inst` checks binding presence during reconciliation. If deletion and reinsertion happen before that reconciliation, the selected target looks continuously present and has the same byId identity, so the old instance is retained. A deletion generation/tombstone or action-time invalidation may be needed; no source patch was attempted.

**Application workaround:** Wait for the deletion render before reusing the ID, or include a separately incremented generation in the child's explicit key. A record should remain the same lifetime for normal updates; the important distinction here is a real remove/reinsert sequence.

## Passing stress coverage

| Area | Coverage |
| --- | --- |
| Four-level state propagation | Three PARENT hops, concurrent EVENTS audit, calculated fields, `props.state`, `previousState`, component context, and ancestor aggregate reducers |
| Keyed Collections | Reorder cards and lanes with pending delayed actions; preserve the correct instance when fresh equivalent byId helpers are produced |
| Request isolation | Same request key in multiple nested siblings; out-of-order replies; supersede one leaf request without canceling siblings |
| Lifecycle cancellation | Selection changes with overlapping child IDs; deletion followed by a completed render and reinsertion; Collection source changes; Switchable target changes with visible/hidden pages |
| Removal and filtering | Leaf self-removal sends its previous identity; pending request is canceled; filtering preserves backing state and correct keyed writes |
| Reducer timing | Aborted STATE still runs PARENT; all four before/after combinations of behavior and host, including two composed STATE updates and ordered effects |
| Burst writes | 200 synchronous native jsdom clicks across four siblings; all 200 updates, PARENT audits, and EVENTS audits preserved |
| Seeded model comparison | 400 deterministic edits across two boards, switching selections and reordering lanes/cards; every edited value and emitted snapshot checked against an independent counter model |
| Static checker | Original SYG256 case, corrected previousState guard, explicit before, plus six three-level app/parent/child timing combinations; parent timing correctly does not cascade to children |

## Additional testing friction

Large batches of `simulateEvent()` in real-DOM mode do not simulate a synchronous burst. The helper intentionally waits for a quiet tree between inputs (`QUIET_MS` is 10 ms in the linked source), while a wait defaults to 2 seconds. Queuing 200 events and waiting for the final count hit the timeout after roughly 167 delivered inputs; it initially resembled lost updates.

This was **not a runtime lost-update bug**. The native jsdom click burst completed with all 200 writes intact. The 400-step serialized test has an explicit 30-second budget. It would help if a timeout reported the number of still-queued simulated inputs, or the testing guide called out this distinction for load tests. `eventWaitMs` is the selector-readiness budget, not a way to disable the inter-input quiet window.

## Limits

These are deterministic functional stress tests of the linked runtime and checker, not a performance benchmark, a memory-leak proof, or a browser-engine compatibility sweep. `dom: 'real'` here means jsdom; no Chromium/WebKit engine is implied. The two reported bugs are reduced runtime reproductions, not behavior observed in Fieldnotes' normal flows, which do not currently expose these particular deletion interactions.
