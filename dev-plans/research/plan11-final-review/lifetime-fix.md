# M-10 lifetime fixes: F1, F6, F7 and cleanup ownership

Production source fixes are complete. The coordinator owns the full combined build,
release gates, approved-budget decision and refreshed local links. No dist build or
link refresh was performed by this subtask.

## Adopted lifetime boundary

Known bindings are observed after each completed queued action, before delivery of
later actions. Owners of known-bound children/hosts reuse the existing app watcher
set. Their cached bound state is compared with the next state using the underlying
cell's `has()` where available, so isolated initialState defaults cannot hide actual
target loss. Undefined means absent; false, 0 and null remain valid present states.

A present-to-absent transition ends the old lifetime immediately, even under hidden
owners and even when the same ID is reinserted before any render. Later queued work
for its disposed subtree is skipped; the action causing deletion completes all its
outputs first. Normal edits/reordering and equivalent byId helpers preserve lifetime.
The known binding cache also observes an initially missing lifetime becoming present
and disappearing again between renders.

Old cleanup receives the latest owned snapshot, including edits completed before a
render. Before disposal, the removed scope's read cell is frozen to that snapshot
and its writes become inert. Descendant cleanup reads the same frozen ancestor data.
This lets cleanup release the correct resource without resurrecting a deleted path.
The new lifetime receives a new writable cell; its initialization, isolated defaults
and path seeding follow existing rules.

For hidden owners, disposal is immediate while replacement creation waits for that
owner's next reconciliation/show. This preserves the rule that hidden views are not
rendered. Showing a fresh missing scope runs normal INITIALIZE/BOOTSTRAP once; later
reinsertion uses that waiting lifetime. Forced reconciliation prevents stale DOM when
the parent's exact prior state object is restored.

Collection and VirtualCollection `from` bindings use their array cells. Lens array
cells retain raw presence separately from their empty-array rendering fallback, so a
missing byId-selected array cannot appear continuously present as `[]`. Both shown
and hidden Switchable pages dispose with the correct bound snapshot.

## Notification performance

The app records the last notified write version. Actual writes increment the version,
so distinct queued states still notify in order; unchanged pre-render/NOOP passes
skip a duplicate scan. Newly created STATE sources prime their initial value, and
binding owners capture initial state when registered. Owner-only watchers avoid raw
STATE-stream reads when they have no stream subscribers.

## Verification

- `Production focused tests` (archived spike artifact): **165/165 passed**, 21 files.
  Includes F1/F6/F7, all timing/parity cases, latest cleanup snapshots, inert disposal
  writes, array hosts using paths and byId, and false/0/null states.
- `Private final candidate` (archived spike artifact): **165/165 passed** before
  applying the notification-version optimization to production.
- `Related source suites` (archived spike artifact): **286/286 passed**, 40 files,
  before the final version-cache optimization and its two added regressions. These
  include host/virtual/SSR/teardown/disposal coverage; the coordinator reruns all
  release gates against final source.
- Independent reviewer controls confirmed latest cleanup state, hidden replacement
  timing, ordered STATE notifications, and Collection/VirtualCollection path/byId
  loss cancellation. Full final independent review remains with the coordinator.

## Measured cost

[Size data](lifetime-size.json) uses a private current-source Rollup ESM build with
only an exact package alias selecting that build in the existing gate. It never
writes through the root dist symlink.

| Measurement | Reviewed baseline | Final candidate |
|---|---:|---:|
| Gated kanban gzip | 42,911 B | **42,993 B** |
| Default kanban gzip | 38,910 B | 38,984 B |
| Core alone, minified / gzip | 50,267 / 18,739 B | 50,601 / 18,816 B |

The complete candidate is 43 B above the existing 42,950 B gate. Its extra size fixes
three demonstrated lifetime failures plus cleanup state and omitted host presence.
A one-field cached-state representation saved 12 B and one pointer per known binding
compared with a separate presence flag and snapshot. The gate was unchanged during the subtask. The user subsequently approved **43,000 B**; the coordinator’s normal final gate passes at **42,993 B** with 7 B headroom. See [final implementation acceptance](../plan11-f1-f8-implementation.md).

## Timing measurements

[Raw JSON](lifetime-performance.json), `process output` (archived spike artifact).
Seven fresh-process pairs in alternating order, each task 20,000 warmup operations
then **150,000 measured operations**, Node v24.14.0, source bundled with esbuild,
no physical DOM driver. These runs finished 23:54:03, before the separate docs build
began 23:54:32, and do not overlap that build.

| Task | Baseline median (range), ms | Candidate median (range), ms | Delta |
|---|---:|---:|---:|
| Unchanged inline helper | 268.401 (261.329–271.331) | 267.781 (264.968–286.208) | −0.23% |
| Nested edit, unchanged target | 308.938 (302.904–324.680) | 322.186 (315.083–327.618) | +4.29% |
| Selection switch | 415.999 (410.423–426.519) | 437.769 (434.985–452.108) | +5.23% |

The unchanged-binding cases meet the plan's 5% investigation threshold. Selection
switching deliberately does lifetime work; the coordinator accepted the measured
+5.23% there after investigation. Earlier short 15,000-operation runs were noisy;
these longer interleaved runs are the final comparison. Absolute timings are
machine-specific and do not replace the required browser count/heap gates.
