# Workstream `dom-events`

Branch `claude/sweep-dom-events-23ac52`. Kanban production bundle, gzip, against 7.4.0.

| Measure | 7.4.0 | Branch | Delta |
|---|---|---|---|
| (a) `nativeGlobalThis: false` (gated) | 43,630 | 42,591 | -1,039 |
| (b) default (what apps ship) | 39,630 | 38,591 | -1,039 |
| (c) `src/core/**` alone | 53,951 min / 20,166 gzip | same | 0 (no core files touched) |

## Changes

| Change | gzip |
|---|---|
| `EventDelegator` rewritten as a closure: one path per event, flat queue table, no `PriorityQueue`, raw listeners (no stream per element), one destination per non-bubbling stream | -604 (a: -620) |
| `ElementFinder` a function; `Body`/`DocumentDOMSource`, `MainDOMSource`, `VNodeWrapper` (a function now), `fromEvent`, `enrichEventStream`, `utils` and the driver's guards trimmed; no `adapt()` in the DOM sources | -374 (a: -358) |
| `IsolateModule`: closures instead of private methods; `update` skips an unchanged namespace; `SymbolTree` loses the prefix argument | -63 |
| The guard around redefining `currentTarget` kept after trying without it | +2 |

Speed-related: a destination caches its selector and scope list, where 7.4.0 rebuilt the selector and
walked up to the element's scope root per destination per element. `currentTarget` is defined when
an event is delivered and once at the end, where 7.4.0 defined it at every element in both phases.
Heap in the count gate went from 0.97 to 0.93 MB.

## Speed

`perf-ab`, full default run: latency geometric mean **1.003**, CPU 0.994, one op marked `SLOWER`:
`calc: toggle filter (1k -> 500)` at 1.051. Re-run alone with 4 rounds: **0.985** latency, 0.919 CPU, not
marked. The hot ops named in the brief: select row 0.964 (view) and 0.971 (Collection), keystroke 1.036
(0.70 -> 0.73 ms, under the 0.3 ms threshold), update every 10th 1.036 (view) and 0.927 (Collection).

The full run was on the commit before the `currentTarget` guard went back in. That guard is the only source
change since, and the flagged-op re-run and every gate below are on the final code.

## Gates (final code)

`TEST_EXAMPLES_INSTALL=1 npm test` passes: library, examples, types, browser (Chromium 450 passed, 0 failed),
perf gate (all within limits). `BROWSER=firefox` and `BROWSER=webkit` browser suites exit 0.
`sygnal-check` not run: nothing it reads changed.

## For the coordinator

- **Perf gate metric.** The `ScopeChecker` class stays (`src/extra/diagnostics/checks/dom.ts` imports it),
  but the delegator no longer makes any, so "Retained ScopeCheckers" now always reads 0 and no longer
  detects a leak. It needs a replacement. A delegator leak is still covered by `test/p45-a1` and
  `browser-tests/src/tests/delegator-leak-p45a.jsx`.
- **Not applied, needs a file outside this workstream:** a flat scope map in `IsolateModule` saves a further
  **-143 B gzip** and removes `SymbolTree.ts`, but `src/extra/focusWithin.ts` reads the tree directly.
  Details and the ordering caveat: `dom-events-flat-scope-map.md` in the shared notes folder.

## Behaviour differences to accept or reject

Rule 3 asks for none. These are the ones found by reading the code; no test or example depends on them.
Each is reachable only as described.

1. **Event path computed once per event.** 7.4.0 walked the DOM once per phase. They differ only if a stream
   operator moves DOM synchronously during the capture phase (Sygnal's own patches run in a microtask). The
   DOM standard also fixes the path once.
2. **Non-bubbling streams no longer share a record.** Each stream has its own destination. Delivery order differs
   only with 3 or more streams on one element and type, with mixed options, started interleaved. A
   `preventDefault` predicate on two identical streams now runs once per stream, as bubbling streams always did.
3. **The root listener for a type is added when a stream starts**, not at `events()`. A stream that never
   starts adds no listener.
4. **`globalThis.Cyclejs.adaptStream` no longer applies to DOM sources.** It was undocumented and nothing in
   Sygnal sets it. A Cycle.js app on the same page could set it, which would have broken Sygnal's streams.

## Tests edited (internal details only)

- `test/p45-a1-delegator-cleanup.test.js`, `browser-tests/src/tests/delegator-leak-p45a.jsx`: read the new
  `queues` / `records` / `elementListeners` instead of the removed scope tree and `ScopeChecker`s.
- `test/p45-r-g263.test.js`: one record per started stream (2, not 1); delivery assertions unchanged.
- `test/p46-g290-symboltree.test.js`: the `max` prefix argument is gone.
- Added `test/dom-event-path.test.js` (order across scopes, `currentTarget` during and after delivery,
  non-bubbling delivery). It passes on the 7.4.0 DOM code and on this branch.

## Tried or considered, not taken

- **Capture-phase root listener for non-bubbling events** (no per-element listeners or element search per
  patch). Not built, no number. It changes behaviour: 7.4.0 stops `submit`, `animationend` and similar
  at the element, which a root capture listener can't do without also stopping the event reaching it.
- **Replacing the driver's `rootElement$` operator chain with a producer.** Not built. Estimated at about
  100 B gzip, against the timing rules G-540/G-549 pin there.
- **`Set` to array for a scope's root elements.** Rejected: removal becomes O(n) on a large fragment root (G-290).

## 8.0 ideas

None that need an API change.
