# PLAN-11 B-S1: State rebinding spike

Repository cleanup: temporary runners, prototype patches, duplicate repro fixtures and raw logs were archived outside the repository after implementation. Commands and filenames below describe the historical spike; maintained regressions live in `test/p11-*.test.js` and `sygnal-check/test/p11-*.vtest.js`. Summary reports and JSON measurements remain here.

Research completed 2026-10-18 (Pacific/Honolulu), baseline
`5e5205cbadd61865b787f6523c840489e074a28b`, Node v24.14.0, installed Vitest v4.1.11.
All prototype patches/builds ran against disposable source copies. Production files and dist
were not changed.

## Recommendation and decision gate

**Do not include automatic rebinding in production under the current acceptance criteria.**
Use B-2's keyed master-detail guidance and targeted diagnostics for this implementation cycle.
The blocking issue is lifetime/ownership, not the cost of reevaluating a lens. Generic rebinding
can make an old request or delayed action mutate the new entity. A helper-specific automatic
remount avoids the tested async hazards, but changes lifecycle and does not generalize to an
arbitrary get/set lens. It needs a separate contract decision rather than being silently shipped
as a rerender correction.

This is a no-go for the candidates under the plan's current gates, **not proof that every future
rebinding design is impossible**. A general forwarding-cell mechanism is small and useful. To
revive it, first decide how a component lifetime relates to its selected entity, stale requests,
timers, subscriptions, local state and initialization. Existing explicit keys already provide
that boundary without a new API.

## Reproduce

From the repository root (installed workspace dependencies required):

```sh
node dev-plans/research/state-rebinding/run.mjs
node dev-plans/research/state-rebinding/measure.mjs baseline generic metadata remount timing combined
```

The shared `harness` (archived spike artifact) copies source/tests to OS-temp directories. Runtime
changes are applied only there by `prototype.mjs` (archived spike artifact). Tests are copied into the
sandbox's normal test directory; no root test configuration change is needed. Reports retain
source diffs, test summaries/logs and raw measurement data. The measurement harness replaces
its temporary dist symlink with a private directory **before** building; it never writes through
that link into production dist. Other linked fixture/dependency directories are read only.

`run.mjs baseline generic metadata remount` executes the focused 16-fixture suite and all 82
existing parity tests: **98/98 pass in each of four configurations**, 15 files per configuration.
See [tests.json](tests.json) and the four `.log` files. Counterexample tests explicitly assert
unsafe/stale results, so a passing suite is not a safety approval. The broad acceptance gates
were not run after these demonstrated correctness failures.

## Candidates compared

| Candidate | Mechanics | Works | Limitation |
|---|---|---|---|
| Baseline | Binding fixed at creation; explicit key remount | Existing lifecycle and request ownership | Unkeyed selection remains on old record |
| Generic forwarding cell | Rebuild target binding/decorator and replace methods on the existing cell object at prop reconciliation | byId, custom lenses, primitive paths, calculated state, nested Collection reads/writes | Wrong-target replies/timers; descendant notification lag; lifecycle/seeding questions |
| Metadata-assisted forwarding | Same mechanism, skip replacing equivalent byId targets | Same synchronous fixes; fewer unnecessary cache resets | Same correctness hazards; metadata alone provides no lifetime boundary |
| Semantic byId remount | Dispose/recreate child only when helper field/ID/idKey changes | Follows selected record; tested fetch cancellation and timer teardown; equivalent fresh helper objects retain instance | New identity/local-state/initialization lifecycle; only recognized helper targets, not arbitrary lenses or hosts |

The candidate's enumerable `__p11` field is deliberately simple research instrumentation.
Any shipped metadata would need a private, non-enumerable representation and corresponding
byte measurements. Neither that name nor a new public lens field is proposed as API.

### Why a rerender alone does not fix this

`Inst.child()` creates the key/lens cell once. `Inst.setProps()` updates props but not that cell.
Its lens also memoizes by parent identity; a changed closure over the same parent object must
invalidate that memo. Descendants capture their parent's cell object, so replacing only the
parent's `cell` property strands those descendants on the old object.

The generic candidate keeps cell identity stable, replaces its implementation (including the
calculated/default decorator), and invalidates context versioning. This is enough for the tested
synchronous view and write paths. It is not enough for component lifetime or notification rules.

## Findings

### 1. Ordinary synchronous binding updates are feasible

Verified byId selection, custom get/set lens selection, primitive path selection, read-only
lenses, A -> B -> A changes, calculated fields, context, and a parent slice whose identity stays
unchanged while a new lens closure arrives. Nested Collection items write into the newly
selected project's array when the workspace cell identity is retained. Explicit key changes
still dispose/remount.

The props$ fixture queues a write on selection change and sees the newly installed binding.
That confirms binding installation must precede prop-triggered action processing. It does not
prove every synchronous observer callback is atomically coherent; production would need to
order props, context, state notification and child reconciliation deliberately.

### 2. Pending work crosses the entity boundary

Actual `makeFetchDriver` fixture:

1. Project A's editor sends `/project/1`, `ok: 'GOT'`, `latest: true`.
2. Selection switches to project B without another request.
3. A's response arrives with no entity ID in its body.
4. Generic rebinding applies GOT to B. The original request was not aborted.

The driver correctly routes to the same emitter instance; it does not know that the instance
now represents another entity. `latest: true` only helps when a later request supersedes the
first one. Replacing lens reads/writes cannot infer the intended response target.

A second fixture starts `next('GOT', 'for-1', 20)` on A, switches to B, then proves that delayed
action writes `for-1` into B. HTTP-specific cancellation therefore cannot solve the general case.
The semantic-remount prototype aborts the tested HTTP request and clears the pending timer,
matching the ownership boundary explicit keys already provide.

Other unverified asynchronous sources (custom driver streams, long-lived subscriptions and
application callbacks) make a universal internal cancellation scheme broader still. An entity
ID check in application data can solve particular cases using existing APIs, but requiring app
changes would not meet this spike's transparent-correction goal.

### 3. State streams and missing targets need additional semantics

A retained grandchild bound to `detail` renders B after generic rebinding, while its STATE.stream
still last emitted A. The flush's watcher notification preceded reconciliation of the changed
parent binding. Production could arrange another notification pass, but must prove no added
patches/loops, duplicate actions or partially reconciled observations.

Rebinding an isolated child from existing `a` to missing `b` shows its initial default while
`b` remains absent: creation-time seeding was not rerun. Whether to seed, defer seeding or treat
this as a new lifetime must be decided; automatically rerunning initialization can overwrite
state or restart effects.

A missing nonisolated byId target retains old markup under the current undefined-state render
rule even though the new readable state is undefined. Remounting instead leaves no child output.
Thus even disappearance behavior is observable, rather than merely a memoization fix.

### 4. More general hosts have the same mount-time boundary

Directly changing Collection `from` or Switchable `state` remains mount-bound in all these
ordinary-child prototypes; dedicated fixtures confirm both. Those hosts construct their own
array/page cells and have their own item/page identities, hidden-page work and subscriptions.
Rebinding an ordinary workspace correctly forwards its nested Collection's unchanged `from`,
but that does not establish that changing a Collection's own `from` is supported.

Generalizing the forwarding mechanism to the hosts looks structurally possible, but would not
solve pending-work ownership and would expand the lifecycle matrix. After reproducing the
fundamental ownership failure, the spike did not build an unsupported all-host implementation
or pretend the helper-specific prototype establishes general safety.

### 5. Automatic remounting is promising but is a contract change

For byId, semantic helper metadata avoids remounting on every fresh inline lens allocation and
allows implicit disposal on a real target change. This solves the tested examples without adding
a required user prop. However, it implicitly reruns intent/INITIALIZE/BOOTSTRAP, changes uid and
instance identity, clears local state, and tears down subscriptions. Existing mount-time-binding
semantics are documented and exercised by parity tests; a silent minor-release rebinding promise
would be misleading.

Arbitrary custom lenses have no canonical entity identity. Reference inequality is insufficient:
inline equivalent lenses are recreated during harmless renders, so remounting on every new lens
can reset state repeatedly or create bootstrap loops. Comparing get results also cannot reliably
infer identity, may invoke getters for side effects, and confuses normal record updates with
selection changes. A byId-only implicit remount remains a possible future major-release choice,
but should not be described as the general solution requested by B-S1.

## Measurements

Authoritative raw run:
[measurements-baseline-generic-metadata-remount-timing-combined.json](measurements-baseline-generic-metadata-remount-timing-combined.json).
Earlier `measurements.json` and `measurements-remount.json` retain exploratory repetitions.
The final six-mode run is used for the numbers below; the earlier generic unchanged-lens median
was +6.2%, while the final run was +3.2%, illustrating noise at these durations.

Private builds use the repository's Rollup ESM configuration, then the existing size-gate script
with only an exact core-package alias added to select that private build. Gzip and core-only
measurement methods are unchanged. The minimal fixture uses run/createElement/byId without JSX.

| Candidate | Gated kanban gzip | Delta | Default kanban gzip | Core-only min / gzip | Changing-binding fixture gzip |
|---|---:|---:|---:|---:|---:|
| Baseline | 42,495 B | — | 38,493 B | 49,430 / 18,350 B | 40,087 B |
| Generic | 42,577 B | +82 B | 38,565 B | 49,750 / 18,446 B | 40,170 B |
| Metadata forwarding | 42,611 B | +116 B | 38,600 B | 49,862 / 18,488 B | 40,213 B |
| byId remount | 42,533 B | +38 B | 38,531 B | 49,536 / 18,397 B | 40,137 B |
| Timing alone | 42,728 B | +233 B | 38,721 B | 49,994 / 18,595 B | 40,320 B |
| Timing + metadata forwarding | 42,841 B | +346 B | 38,831 B | 50,426 / 18,729 B | 40,444 B |

Binding-only candidates fit the provisional +256 B core/kanban thresholds and the unchanged
42,700 B total gate. The timing and combined prototypes do not fit the total gate. These numbers
exclude unfinished production plumbing and do not establish the size of a complete correct design.

Five fresh processes per candidate, 15,000 operations after warmup per task, source bundled with
esbuild, no physical DOM driver. Medians in ms, with min–max in parentheses:

| Candidate | Unchanged inline lens | Selection switch | Nested edit |
|---|---:|---:|---:|
| Baseline | 29.591 (28.779–29.969) | 29.769 (29.617–31.031) | 32.869 (32.808–33.593) |
| Generic | 30.549 (30.336–31.624) | 31.969 (31.396–33.038) | 33.841 (33.732–34.238) |
| Metadata forwarding | 30.319 (29.944–31.533) | 32.713 (32.185–32.909) | 32.443 (32.270–33.220) |
| byId remount | 30.620 (29.769–31.060) | 58.997 (56.928–60.309) | 35.686 (34.513–36.447) |

Baseline switches are intentionally not semantically equivalent: they still render the old
record. The table measures the cost of fixing/changing behavior, not a claim of equal work.
The extra remount cost is expected. These very small timings need interleaved, larger benchmarks
before any production performance claim. No retained-object/heap or full count-gate claim is made.
The nested-edit task retains a captured component ID and is meaningful for the forwarding cases;
it performs no selection switch within that task, so remount's target remains valid there too.

## Acceptance checklist

| B-S1 gate | Result |
|---|---|
| No new required public API/dependency | Candidate mechanisms need none; internal metadata design unfinished |
| Correct synchronous reads/writes | Pass for tested ordinary child cases |
| Coherent notifications / missing-target semantics | Fail / unresolved for forwarding |
| No wrong-target pending work | Fail for forwarding; tested fetch/timer cases pass for helper remount |
| General lenses/paths and relevant hosts | Partial: helper remount cannot infer arbitrary identity; direct hosts not generalized |
| Preserve identity/lifecycle guarantees | Fail for implicit remount as a transparent correction; requires contract/release decision |
| Binding-only byte limits | Pass for exploratory candidates, not a final correct implementation |
| Full functional/count/browser/heap/performance gates | Not run after correctness no-go; not claimed passing |
| Combined unchanged total size gate | Fail: +141 B over for timing + metadata forwarding prototype |
| Overall B-1 production inclusion | **No-go under current gates** |

## Suggested next work

1. Use explicit `key={selected.id}` for an editor that represents a selected entity and should
   cancel the previous entity's work. Explain both binding and lifetime consequences.
2. Add targeted dev-only diagnostics for changed semantic built-in bindings on retained children;
   do not warn just because a new equivalent lens object exists. Calibrate false positives.
3. Preserve the prototypes as evidence. If automatic support is revisited, choose explicitly
   between a new lifetime on entity selection and retained-instance rebinding with application
   responsibility for stale work. Do not silently mix those two contracts.
4. Classify a future automatic lifecycle change as major-release work unless compatibility
   evidence supports a narrower correction. This spike does not establish that evidence.
