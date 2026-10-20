# Follow-up: unchanged target disappearance

Repository cleanup: temporary runners, prototype patches, duplicate repro fixtures and raw logs were archived outside the repository after implementation. Commands and filenames below describe the historical spike; maintained regressions live in `test/p12-*.test.js` and `sygnal-check/test/p12-*.vtest.js`. Summary reports and JSON measurements remain here.

The first lifetime patch replaced changed binding identities but retained an old
component's markup when its selected record disappeared under the same identity.
`Inst.render()` intentionally retains its template for undefined state. An ordinary
rerender therefore does not clear this case, and would leave old async work alive.

The private `availability prototype` (archived spike artifact) tracks the previous availability
of known bindings at reconciliation. A transition from present to undefined disposes
the old lifetime and creates a fresh one, once. The fresh missing lifetime follows
normal mount-time rules: intent/INITIALIZE/BOOTSTRAP can wait for or initialize data,
and isolated initialState/default behavior remains intact. Repeated renders while
missing retain that new lifetime. Reinserting the same ID/path uses the fresh waiting
lifetime; the original entity's captured next, requests and timers remain disposed.

Presence is derived from the underlying cell's `has()` where available, rather than
its decorated/defaulted value. This is essential for isolated components: their
initialState can mask a missing underlying target. It adds a private reference to the
base cell plus one remembered availability value per known-bound instance. Switchable
uses its own bound cell, which also handles hidden or null-rendering pages. Collection
and VirtualCollection already dispose items when their underlying arrays become
missing/empty, so they need no extra reset behavior here.

Null is a present state value. Only undefined means unavailable. Arbitrary custom
lenses keep their existing mount-bound behavior; selection needs an explicit key and
absence may require conditional rendering by the parent.

The initial basic candidate measured 42,896 B but was rejected because decorated
state could conceal an isolated target's disappearance. The complete base.has design
measured 42,923 B. Safe reductions brought that to 42,916 B. A separate sorted schedule
helper brought it to 42,911 B; optional wrapHandler invocation, equivalent timing mask
normalization and includes-based timing validation together yielded **42,910 B**.

The final production candidate keeps only the readable sorted schedule helper,
measuring **42,911 B**. It avoids the three extra micro-optimizations that saved just
1 B together. After reviewing the concrete deletion case, the user approved a
**42,950 B limit** and including this follow-up fix. Production integration is applied.
The final private candidate passes **137/137 tests**, including 20 lifetime cases,
all reducer timing cases, diagnostics cases, and 82 parity tests (17 files).

Raw final private size/performance data:
[measurements-presence.json](measurements-presence.json). Test source is appended to
`fixtures.test.js` (archived spike artifact). Run with:

```sh
node dev-plans/research/state-rebinding-v7/run.mjs presence
node dev-plans/research/state-rebinding-v7/measure.mjs presence
```

Production source verification after promotion: **260/260 tests passed in 36 files**.
This covers all focused/parity/timing/diagnostics tests plus the related host,
VirtualCollection, nested disposal, async driver, teardown, transition and SSR suites.
See `production-final-tests.log` (archived spike artifact). The coordinator runs
complete build, size, browser, heap/count and documentation gates afterward.
