# PLAN-11 v7 binding lifetime spike

Repository cleanup: temporary runners, prototype patches, duplicate repro fixtures and raw logs were archived outside the repository after implementation. Commands and filenames below describe the historical spike; maintained regressions live in `test/p11-*.test.js` and `sygnal-check/test/p11-*.vtest.js`. Summary reports and JSON measurements remain here.

Research completed 2026-10-18 (Pacific/Honolulu). This revisits the
[original spike](../state-rebinding/README.md) after accepting a major release.
All prototype edits and builds run in private temporary copies of the current source;
no production files are changed by this research harness.

## Recommendation

**Include semantic binding replacement and disappearance handling in v7, with the
approved 42,950 B limit.** A known
binding target is part of a component's lifetime identity, alongside the explicit
key/id/path already used to locate it. A changed target disposes the old lifetime and
creates a new one. An unchanged explicit key does not suppress this boundary.

Supported target identities are a state path string, absence of a binding, and the
private semantic tuple attached by `byId(field, id, idKey)`. A fresh equivalent helper
object preserves the lifetime. Ordinary target data changes also preserve it.

This applies to an ordinary component's `state`, `Switchable.state`, and
`Collection.from` / `VirtualCollection.from`. A changed host binding disposes the
whole host, including hidden Switchable pages and Collection items whose IDs overlap
between the old and new collections. Each resulting component follows the existing
creation rules for intent, INITIALIZE, BOOTSTRAP, isolated state seeding, calculated
state, context, streams and child ownership.

Opaque custom lenses remain mount-bound. Neither a new function/lens reference nor
a changed getter result reliably identifies an entity: inline closures are commonly
reallocated, while ordinary record updates change getter results. Automatic disposal
on either event can reset local state or create initialization loops. Such bindings
continue to need an explicit key when their target changes. No new public API,
dependency, lens field or inference from application data is proposed.

A transition between a known target and an opaque lens also starts a new lifetime;
two opaque lenses cannot be compared semantically and therefore retain the original
binding. Read-only custom lenses retain their existing no-write behavior.

## Why remount instead of forwarding

The earlier forwarding prototype could direct an old response or delayed `next()`
to the newly selected record. Disposal already supplies the correct ownership
boundary: driver reply streams end, HTTP requests abort, EFFECT signals abort,
pending next timers clear, captured next calls stop, subscriptions end, and descendant
lifetimes dispose. The major release now allows those visible lifecycle changes.

The candidate also normalizes undefined root output to `null` only at DOM delivery.
The DOM driver already defines null as empty output. This fixes an existing edge
case exposed when a root returns a selected component directly and its new target is
missing; without normalization the driver throws and leaves stale markup. Internal
root output, patch hooks and cached vnode identity remain otherwise unchanged.

## Reproduce

```sh
node dev-plans/research/state-rebinding-v7/run.mjs
node dev-plans/research/state-rebinding-v7/measure.mjs
```

The test runner copies current source/tests to an OS temporary directory, installs
`prototype.mjs` (archived spike artifact) only there, and copies `fixtures.test.js` (archived spike artifact)
into that copy's test directory. Other linked directories are read only. The size
runner replaces the private dist symlink with a private directory before building.

The runner removes only this spike's production edits in each temporary copy before
reapplying the candidate. Thus current v7 timing/default work remains on both sides
of the comparison, and the commands still work after production integration. The
earlier v6 spike remains pinned to its historical baseline. The source revision in
raw measurements is the repository HEAD; these v7 measurements explicitly include
the uncommitted v7 reducer-default changes.

## Verification

`tests.log` (archived spike artifact): **96/96 tests passed**, consisting of 14 focused lifetime cases
and all 82 parity tests (15 files). The final run uses the current v7 timing
expectations; exploratory runs against concurrently changing parity fixtures are not
acceptance results.

The focused cases prove:

- byId and string path A → B → A reads/writes, new identity, disposal, calculated
  state, context, and STATE.stream values;
- same explicit key plus changed target replaces lifetime, while a fresh equivalent
  inline byId helper retains identity;
- opaque inline read/write and read-only custom lenses retain mount-time behavior;
- missing selected record clears markup, including at the direct DOM root, and a
  later existing target renders normally;
- isolated component selection into a missing path follows normal creation-time
  seeding exactly once;
- HTTP request cancellation and rejection of a late completion;
- cancellation of delayed next timers and captured next callbacks, plus aborting the
  old EFFECT signal;
- descendant streams and nested Collections follow the new lifetime;
- direct Collection, Switchable (including hidden pages), and VirtualCollection
  bindings dispose old lifetimes even with overlapping item IDs;
- 100 selection changes produce exactly one DOM patch per change and leave exactly
  the root and current child alive.

These focused counts are not a claim that the full repository browser/heap/perf
gates have been run for this private candidate. Those gates belong to production
integration verification.

## Size and timing

[measurements.json](measurements.json), Node v24.14.0. Private builds use the same
Rollup ESM configuration and existing size-gate procedure. The only size-script
change is an exact package alias selecting the private ESM build. The kanban input
and gzip procedure are unchanged.

| Measurement | Current v7 default baseline | Semantic lifetime candidate | Delta |
|---|---:|---:|---:|
| Gated kanban gzip | 42,747 B | 42,852 B | +105 B |
| Default kanban gzip | 38,731 B | 38,846 B | +115 B |
| Core alone, minified | 49,858 B | 50,115 B | +257 B |
| Core alone, gzip | 18,566 B | 18,682 B | +116 B |
| Minimal selection fixture gzip | 40,366 B | 40,471 B | +105 B |

The candidate is **52 B over the prior 42,800 B limit**. After reviewing this
concrete result, the user approved a **42,900 B limit** and including the fix. Sharing the repeated Collection/VirtualCollection host
selector saved 2 B from the initial candidate. Further architectural registration to
make helper comparison optional would complicate duplicate-bundle behavior and is
not justified solely to save these bytes. Production integration is authorized under the new limit.

Five fresh benchmark processes per candidate; each task has 2,000 warmup operations
then 15,000 measured operations. Source is bundled with esbuild and no physical DOM
driver. Median elapsed times:

| Task | Baseline | Candidate |
|---|---:|---:|
| Unchanged inline helper | 32.290 ms | 34.287 ms |
| Selection switch | 34.106 ms | 65.939 ms |
| Nested edit, unchanged selection | 36.930 ms | 41.153 ms |

The baseline selection switch is deliberately stale; it keeps the old record and
performs no replacement. The candidate's additional work is disposal, instantiation
and fresh subscriptions, so this is not a comparison of equivalent work. The roughly
2.0 ms overhead over 15,000 unchanged-helper operations is small in absolute terms,
but these short runs are noisy and do not establish a general performance guarantee.

## Production integration

1. Applied the helper comparison and host-aware reconciliation patch plus root-null
   delivery normalization.
2. Replaced the obsolete runtime SYG454 known-target warning tests with v7 lifetime
   assertions. Keep historical checker warning behavior for installed 6.x, and
   suppress the no-longer-applicable known-target warning for installed 7.x.
3. Document disposal/reinitialization, explicit key interaction and the custom-lens
   limitation prominently in migration guidance and the current plan.
4. Run all library, checker, browser, example, type, documentation, count/heap and
   size gates against the complete production build.

Production focused run: **101/101 passed**, including 14 promoted lifetime cases,
5 updated diagnostics/application cases, and all 82 parity tests (16 files).

Broader production host/disposal verification: **224/224 passed** in 35 files,
covering parity, Collection/Switchable, VirtualCollection, nested disposal, async-driver
disposal, teardown, transition names and SSR virtual fixtures. These source suites
include the 101 focused/parity tests above rather than adding a disjoint 224 tests.

## Follow-up: deletion under an unchanged target

The final implementation also disposes a previously present known-bound lifetime
when its target disappears, including selected-record deletion without changing the
byId tuple. It preserves fresh missing-state bootstraps/seeding and prevents repeated
absence remounts. See [availability.md](availability.md) for isolated defaults, hidden
pages, null-rendering components, reinsertion semantics and the final **42,911 B**
candidate under the newly approved **42,950 B limit**. The size and 96-test tables
above describe the first semantic-target-change spike, before that follow-up.
