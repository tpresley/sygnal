# PLAN-12 R-S1: Reducer timing spike

Repository cleanup: temporary runners, prototype patches, duplicate repro fixtures and raw logs were archived outside the repository after implementation. Commands and filenames below describe the historical spike; maintained regressions live in `test/p12-*.test.js` and `sygnal-check/test/p12-*.vtest.js`. Summary reports and JSON measurements remain here.

Research completed 2026-10-18 (Pacific/Honolulu), source baseline
`5e5205cbadd61865b787f6523c840489e074a28b`, Node v24.14.0, installed Vitest v4.1.11.
Production source, public declarations, templates and published bundles were not changed.

## Recommendation

Proceed with opt-in timing **after clarifying the mixed-action execution contract and optimizing
the implementation to fit the unchanged size gate**. The state-snapshot model works, including
different library/host snapshots inside one merged EFFECT. Complete preservation of historical
execution ordering for arbitrary mixed actions is impossible, however. The plan's portability
claim needs that qualification before R-1 starts.

Recommended contract for review, not an approved amendment:

1. An action whose effective output handlers are all `before` uses its original execution order.
2. If any output handler is `after`, execute the composed STATE transition once, then the output
   handlers in their original order. Give each its declared snapshot and matching props/context.
3. Preserve behavior EFFECT -> host EFFECT ordering, return/exception behavior and one hook/log
   invocation for the existing merged handler. Do not flatten merged functions into separately
   caught handlers merely to select snapshots.
4. Document `before` as selecting the pre-action **snapshot**, not guaranteeing execution before
   STATE when another contributor opts the same action into after-state output. Most existing
   built-in transitions need the snapshot; pin those to before. A library requiring historical
   execution phases needs an explicit compatibility assessment in mixed actions.

This is simpler and more predictable than selectively moving before handlers around STATE.
Preserving every feasible legacy phase is possible with scheduling metadata, but still cannot
solve contradictory constraints and introduces more machinery. Rejecting conflicting mixtures
is an alternative if stronger ordering portability is required; it adds an app integration error
and should not be introduced without a product decision. No production policy was chosen here.

## Runnable evidence

From the repository root:

```sh
node dev-plans/research/reducer-timing/run.mjs
node dev-plans/research/reducer-timing/run.mjs --after-default
node dev-plans/research/reducer-timing/run.mjs --after-default --pin-legacy-fixtures
node dev-plans/research/reducer-timing/order.mjs
```

`run.mjs` copies source/tests to a disposable OS-temp directory and patches only the copy using
`prototype.mjs`. The snapshot-first candidate is recorded in `prototype.diff` (archived spike artifact).
`--after-default` changes the copied testing adapter's default, not the production adapter.
`--pin-legacy-fixtures` explicitly pins the affected old action-log fixture in that copy. The root test
configuration excludes dev-plans; these research suites are run only through this harness.

| Experiment | Result | Interpretation |
|---|---|---|
| Unmodified selected baseline | 178/178 tests, 20 files | Establishes existing parity/behavior/form/chat/compose/undo baseline |
| Snapshot-first prototype, legacy default | 200/200 tests, 21 files | 22 new fixtures plus selected existing parity/behavior/form/chat/compose/undo tests |
| Inherited after default in copied testing adapter | 199/200 | One existing unannotated fixture contract changes, as expected from a default flip |
| Same after default, old fixtures explicitly before | 200/200 | Explicit contracts recover that old fixture; built-ins pinned in the candidate |
| Exhaustive 3-node ordering constraint example | No solution for conflicting case | A scheduling limitation, not a missing clever sort |

See [tests.json](tests.json), [tests-after-default.json](tests-after-default.json),
[tests-after-default-pinned.json](tests-after-default-pinned.json), and their `.log` files.
Passing fixture tests include assertions **demonstrating incompatibilities**; these counts do
not mean the candidate satisfies every proposed production contract.

The inherited-after failure is concrete migration evidence: the action-log fixture schedules
`next('LATER', s.n)`. Its data changes from 0 to 1, and the final state becomes 12 rather than
legacy 11. This is not a timer or logging failure. An explicit before declaration recovers it.

The initial exploration also exposed a prototype bug: changing the frame props dropped the
EFFECT AbortSignal. That was fixed by retaining invocation extras while selecting snapshot
fields. Both the existing D197 signal test and a new mixed behavior/host disposal-signal fixture
now pass under after defaults. That early bug is not classified as a migration requirement.

## Provenance and state composition

Current behavior merging produces one STATE function from slice STATE, HOST and host STATE;
it also combines behavior/host EFFECTs into one closure. A single timing flag on the normalized
action or top-level EFFECT therefore cannot represent the contributors correctly.

The candidate retains timing on behavior wrappers and an action-local frame containing before
and after host states/props. The behavior wrapper selects its slice from its declared frame;
the host wrapper selects the host's frame. One grouped EFFECT preserves behavior-first order
and exception scope. In production, prefer internal normalized provenance over public-looking
function properties such as the candidate's `__p11Timing`/`__p11Frame`. Those names are research
instrumentation, not proposed public API.

Verified cross-products: before/after app default × inherited/explicit component mode; before/
after behavior × before/after host; host value-sink replacement; slice STATE -> HOST -> host STATE;
one state invocation; disposal AbortSignal preserved across mixed EFFECT frames; calculated state; props/previousState/context; ABORT/same/throw/no STATE;
two apps sharing a component function; synchronous driver reply queued after committed state.

Behavior first arguments remain slices; `props.state` and `props.previousState` are host state.
The candidate reads the post state from the cell, so calculated/committed values are used rather
than an unevaluated raw reducer return. Output frames are captured once per action.

## Why a completely compatible mixed scheduler cannot exist

Let B be the behavior EFFECT, H the host EFFECT, S their composed STATE handler. Suppose B is
after, H is before, and the original merged EFFECT appeared before STATE:

| Promise | Required order |
|---|---|
| B sees committed state | S -> B |
| Existing merged EFFECT order | B -> H |
| Preserve H's historical execution before STATE | H -> S |

That is the cycle S -> B -> H -> S. [ordering.json](ordering.json) exhaustively lists the six
possible orders and shows none satisfy all three. Capturing a pre-state snapshot for H makes
its input correct, but does not preserve the third promise.

A separate actual-runtime fixture demonstrates the cost of ignoring this distinction: a legacy
behavior EFFECT preceding STATE sets an external flag, and the reducer reads it. Moving STATE
first changes the result despite preserving the EFFECT's snapshot. This intentionally probes
an external-state dependency (outside the preferred pure reducer style); it shows why snapshot
portability cannot be advertised as arbitrary execution-order portability.

Splitting the merged EFFECT also has an observable failure mode: today a synchronous exception
in B prevents H running because both share one caught invocation. Separately invoking/catching
them runs H. The candidate keeps the original closure and the fixture verifies H stays skipped.

## Audit findings and production work still needed

| Area | Finding / required implementation step |
|---|---|
| `behaviors.ts` | Provenance must survive slice wrappers, HOST composition, host replacements and grouped EFFECTs. Behavior metadata is distinct from `_behaviorActions`, which can change with host intent ownership. |
| `chat`, `form`, `compose` | Shared transition memoization depends on original input identity. Explicit before pins worked in the selected existing suites under after defaults. Do not recompute transitions with post-state inputs. |
| Undo/undoable | Wrap STATE once; preserve non-STATE metadata through copied entries. Selected undo and behavior parity tests pass; no after-state second evaluation is necessary. |
| Persist | Rewrites PERSIST into EFFECT and chains an existing EFFECT. That wrapper must retain contributor provenance. This path was source-audited, not exhaustively exercised with mixed modes. |
| Diagnostics/action log | `wrapHandler` wraps the outer function and forwards arguments; resolving provenance before wrapping works in the candidate. Keep one action/reducer/log boundary. Full devtools/time-travel verification remains. |
| Definitions/cache | Shared normalized definitions cannot contain resolved app defaults. Resolve schedules per app, or key caches by mode. Include declaration changes in stale/HMR handling; the candidate reads view statics at dispatch and is not a finished cache design. |
| Calculated/lens/item cells | Post means the readable committed component state. A deleted Collection item retains its last value today; do not assume every removal produces undefined for the item's own sinks. Full cell/error matrix remains a production gate. |
| Adapters/types | SSR, hydration, HMR, Astro/Vike/elements and public/source declaration propagation were not implemented. Testing after-default is an experimental copied-adapter patch only. |

The exploratory prototype deliberately does not claim complete production type checking,
configuration validation, context/error isolation, adapter support or a finished metadata design.

## Size and performance

Numbers use a fresh private Rollup core build and the existing size-gate implementation with a
single exact `sygnal` alias pointing kanban at that private build. The standard JSX/Vite plugin,
gzip method and 42,700 B gate are retained. Source copies isolate the work from shipped dist.

| Build | Gated kanban gzip | Delta | Core-only gzip | Delta | Changing-binding fixture gzip |
|---|---:|---:|---:|---:|---:|
| Baseline | 42,495 B | — | 18,350 B | — | 40,087 B |
| Timing candidate | 42,728 B | +233 B | 18,595 B | +245 B | 40,320 B |
| Timing + metadata-assisted rebinding | 42,841 B | +346 B | 18,729 B | +379 B | 40,444 B |

The timing candidate **fails the total gate by 28 B**; the combined candidate fails by 141 B.
These are exploratory implementations, not optimized minima, and omit some production plumbing.
Do not raise the budget or claim the final feature will fit from these numbers.

Five runs × 15,000 operations in a minimal source-bundled runtime benchmark put the timing
candidate's unchanged-lens median at 31.080 ms (range 29.985–33.077), versus baseline 29.591 ms
(28.779–29.969), approximately +5.0%. Production scheduling should be compiled/cached per app
definition, preserving the cheap all-before path instead of allocating mode arrays and scanning
handlers per dispatch as this prototype does. Repeat interleaved benchmarks after optimization;
these small timings are exploratory and do not replace the repository count/browser/perf gates.

A rerun after preserving effect-frame extras (including AbortSignal) produced identical size
figures; see `../state-rebinding/measurements-timing-combined.json`. Full raw measurements and
the reproducible measurement command are in
[the binding report](../state-rebinding/README.md#measurements).

## Next decision

Review the snapshot-only meaning of `before` inside a mixed action. If accepted, amend R-S1's
ordering language and proceed later with per-app schedules, preserved grouped invocation,
explicit built-in pins and size/fast-path optimization. If full phase portability is required,
retain the current R-S1 hold and decide how conflicting mixtures should be handled first.
No production code or accepted plan decision was changed by this spike.
