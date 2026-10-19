# PLAN-11: Reducer state timing and fresh-app ergonomics

**Created:** 2026-10-18 (Pacific/Honolulu).
**Status:** M-10 F1–F8 complete. All release gates pass, including 42,993 B against the explicitly approved 43,000 B limit. Runtime built; both npm links refreshed and verified from a fresh consumer. The combined-build limitation was fixed in [M-8](research/rollup-build-lifecycle.md). Major-release work below supersedes the initial minor-release/default and binding decisions.
**Tracker:** [PLAN-11-status.md](PLAN-11-status.md).

## Sygnal 7 revision — authorized 2026-10-18

The user chose a major release after reviewing the initial implementation. **Sygnal 7 defaults
to `after`**; 6.x retains its historical pre-action snapshots. This supersedes P11-D1's minor
release/default decision and reopens P11-D7's binding-lifetime compatibility restriction.
No package publishing is authorized by this implementation task.

| Item | Implementation steps | Compatibility / verification |
|---|---|---|
| M-1 after default | Change the central runtime fallback and public guidance; position package metadata at 7.0.0 | Explicit component/behavior before contracts still win; test omitted options, overrides, adapters, mixed actions, HMR and old fixtures with intentional before contracts |
| M-2 starters/examples | Remove redundant after options from entry points and matching tests/config; require 7.x runtime | Preserve reducer migrations already made; packed TS starter test/check/types/build and all examples pass |
| M-3 version-aware checker | Resolve installed Sygnal from each source's package context; distinguish 6, 7, prereleases and unknown versions | Use actual installed versions, including workspace/nested/local links; do not offer unsupported timing APIs on 6 or stale binding warnings on 7; CLI/editor share rule results |
| M-4 binding-lifetime spike | Revisit semantic target disposal/remount for ordinary children and related Collection/Switchable hosts | Known path/byId identity may change lifetime in a major release. Do not infer arbitrary custom-lens identity, redirect old pending work, or remount equivalent fresh helpers. Verify async replies/next, descendant streams, missing targets, init/disposal, explicit keys, host overlap IDs and size/perf |
| M-5 binding implementation | Adopt the spike's safe outcome if feasible within API/size/perf constraints; otherwise document the exact remaining limitation | Preserve explicit key control; specify precedence with semantic identity. Integrate runtime/static diagnostics and tests together |
| M-6 migration/docs | Prominent breaking-change changelog and v7 migration guide; update llms, skill and API/integration docs | Show old/new output examples, previousState and before escape hatch; qualify inherited old libraries and behavior contracts; describe actual binding lifetime outcome |
| M-7 final integration | Rebuild and run applicable library/checker/example/type/browser/docs/perf/size gates | Prior minor-candidate results remain historical. Final approved gate is 43,000 B; the concrete approval sequence is recorded below |

### M-8: Combined Rollup lifecycle follow-up — complete

The user requested investigation while testing the linked v7 build. The ordinary build now
uses a compiler host without filesystem watchers; program teardown cancels queued compiler
updates. Watch mode retains its compiler between output closes and releases it on shutdown.
The standard build and all 24 watch configurations exit naturally; 90 runtime artifacts are
byte-identical to the same-path baseline, and 44 focused regression tests pass. Root `dist`
was not changed while the user tests it. [Evidence](research/rollup-build-lifecycle.md).

### M-9: Loading-guard migration feedback — implemented

Confirmed a real checker gap with the installed 7.0.0 context. Added a tested loading/admission
example to the migration guide and llms/skill guidance. The user then authorized the targeted
warning: **SYG256** now proves a same-action literal STATE write contradicts an output guard
in an installed 7+ `after` context. Component overrides and reachable app defaults are resolved
independently for each child; unknown timing, behaviors, calculated state and ambiguous or
apparently mutated models/options are skipped. Source ranges relate the guard, STATE write
and timing context. CLI/editor diagnostics agree; suppressions work; no autofix or runtime
ABORT change. Diagnostic registry, explanations, generated reference, changelog, checker README
and offline guidance are updated. See [implementation and verification](research/plan11-loading-guard-assessment.md).

### M-10: Final prerelease review — implementation verification

The user requested a final review while testing the linked packages. Independent runtime,
binding and tooling audits plus fresh integration/packaging checks found the issues below.
No production changes were made during review. See [findings, reproductions and acceptance
criteria](research/plan11-final-review/README.md).

The user subsequently authorized F1–F8 implementation, explicitly coordinating lifetime fixes,
using subagents, retaining the 42,950 B budget (or consulting the user if it cannot fit), then
rerunning release gates and rebuilding/linking both packages. The coordinator owns docs and
integration; runtime lifetimes, mixed EFFECT/testing diagnostics, and checker proof fixes are
separate implementation assignments. No publication is authorized.

| Item | Finding / implementation step | Compatibility / verification |
|---|---|---|
| M-10-F1 / P1 | Process known-target presence loss for ordinary children and nested hosts during hidden-page sync | Old work cannot write into a same-ID replacement; preserve missing-target initialization, cached-DOM invalidation and host behavior; repeat size/count/heap gates within the subsequently approved 43,000 B |
| M-10-F2 / P2 | Preserve runtime-owned AbortSignal when restoring before props in mixed EFFECT groups | Both contributor orders see the lifetime signal; disposal aborts it; retain snapshot and exception contracts |
| M-10-F3 / P2 | Migrate tabs-close guide's ELEMENT neighbor calculation to previousState | Correct old-state prose and offline copy; verify real focus for first/middle/final closes |
| M-10-F4 / P2 | Retain supported STATE branch preconditions in SYG256 proof | Skip guards already rejecting pre-state; preserve original self-blocking warning and conservative exclusions |
| M-10-F5 / P3 | Reject prototype option declarations when proving inherited sink timing | Inherited getters cannot establish false after evidence; cover spread-origin cases |
| M-10-F6 / P2 | Stop queued work from a previously present subtree after an ancestor target disappears | New linked-project BUG-1; multi-hop PARENT plus EVENTS deletion must not invoke reducers against absent state or produce SYG216; retain fresh missing-state initialization and surviving data |
| M-10-F7 / P1 | End the old lifetime when delete/reinsert occurs between renders | New linked-project BUG-2; related to F1 but also affects visible components; cancel old delayed next/HTTP/effect work without treating ordinary immutable updates as new lifetimes; verify both DOM modes and existing size/perf gates |
| M-10-F8 / P3 | Explain real-DOM simulated-input serialization and improve queued-input timeout context | New testing friction; extend pending-input counts from settle to next/waitForState; distinguish native synchronous burst tests; eventWaitMs is not a quiet-window control; no runtime lost-update claim or new API |

The linked-project stress report was deduplicated against F1–F5: F6 is a new queue race; F7
shares the lifetime-invalidation class of F1 but adds a distinct between-renders trigger; F8 is
testing ergonomics. Coordinate F1/F6/F7 rather than fixing only rendered or hidden snapshots.
The source report and local reproductions are preserved with the review evidence.

F1–F8 are implemented, including coordinated owner notification at action boundaries, preserved cleanup snapshots and whole Collection/VirtualCollection source presence. Focused source coverage: 165 passing tests; the original review reproductions now pass 12/12. Final measured size is **42,993 B / 43,000 B**, passing with 7 B headroom. The user explicitly approved the 43,000 B limit on 2026-10-19 after the final measured overage was disclosed. See [implementation and acceptance evidence](research/plan11-f1-f8-implementation.md). All other release gates pass: library 5,099 tests; checker 1,723 tests; 14 example suites; types; 377 browser cases plus WebMCP/graph checks; retention/count gates (0.93 MB settled heap); 117 docs demos in each of three engines; all ten packed templates; editor/plugin gates. The build is complete. Both global npm module registrations are refreshed; a fresh consumer resolves runtime 7.0.0/checker 0.11.0 and executes the expected installed-version SYG256 diagnostic through its local CLI.

Release preparation also requires the dated changelog heading and a fresh VS Code bundled
checker artifact. Existing gates passing is insufficient to close M-10; regressions above must
be fixed and verified before recommending 7.0 release.

### Major-release decisions adopted during implementation

- M-1/M-2: runtime defaults to `after`; 7.0.0 runtime, 0.11.0 checker, 2.9.0 starter
  metadata position the coordinated release. Templates require ^7.0.0/^0.11.0 and remove
  redundant after options. Built-in behaviors explicitly retain before contracts where needed.
- M-3: per-source installed manifests determine supported timing APIs and byId guidance;
  dependency ranges alone do not establish the runtime version. Unknown stays qualified.
- M-4/M-5: [v7 binding spike](research/state-rebinding-v7/README.md) accepted: known path/byId
  target changes dispose/recreate ordinary children and Collection/VirtualCollection/Switchable
  hosts, even with the same explicit key. Equivalent targets retain lifetimes; opaque lenses
  require keys. Root undefined output is delivered as null to clear the DOM safely.
- The measured binding candidate was 42,852 B, 52 B over 42,800 B. The user explicitly approved
  **42,900 B** and inclusion of the fix. The presence-loss decision below subsequently superseded that gate.
- Independent review additionally reproduced stale markup on deleting a selected entity without
  changing its byId arguments. A bounded follow-up spike tested safe presence-loss disposal
  while preserving existing missing-path bootstrap/seeding behavior. The accepted follow-up
  disposes an existing known lifetime once on target loss, creates a fresh missing-state lifetime,
  and prevents old pending work from reviving after same-ID reinsertion. The combined candidate
  measured **42,910 B**; the user explicitly approved **42,950 B** and inclusion of this deletion
  fix. The readable production variant retains only the sorted-helper optimization and measures
  **42,911 B**, leaving 39 B headroom. See [presence-loss evidence](research/state-rebinding-v7/availability.md).

The user explicitly requested subagents. Work is split into runtime/templates, checker/version
resolution, and binding research, with the coordinator owning plan/docs/changelog and final
integration. Shared uncommitted changes from the first phase are retained.

## Goal and scope

Make state timing explicit and portable across apps, components and behaviors; remove three
verified points of friction in a fresh Sygnal app: scaffolding into a Git repository, changing
a child's selected state binding, and querying form controls in strict TypeScript tests.

Four workstreams:

| ID | Workstream | Deliverable |
|---|---|---|
| R | Reducer timing | Updated-state outputs by default in 7, explicit contracts and migration support |
| C | Scaffolding | Safe scaffolding into a directory containing Git metadata; correct `.` naming |
| B | State bindings | Spike, then automatic binding updates if the acceptance gates pass; otherwise guidance and targeted diagnostics |
| T | Test queries | Generic selector overloads, consistent declarations and TypeScript examples |

This document was originally created as a plan-only task. The user subsequently authorized
R-S1 and B-S1, with findings and recommendations required before production changes. Those
spikes are complete; reports are linked below. The user then authorized production implementation
of all four workstreams, then the v7 revision above authorized the framework default flip and
known-target lifetime changes. Publishing, new dependencies and general scaffold overwrite
behavior remain outside this implementation.

Use plan-local decision IDs `P11-D*` and item IDs below; do not claim another plan's reserved
global D/G number block. Record later findings and decisions in the tracker.

## Research results (2026-10-18)

- [R-S1 report](research/reducer-timing/README.md): snapshot provenance works; mixed actions cannot
  preserve every historical execution-phase promise. Review the proposed snapshot-only meaning
  of `before` in mixed actions before R-1. Unoptimized timing exceeds the size gate by 28 B.
- [B-S1 report](research/state-rebinding/README.md): small synchronous rebinding mechanisms work,
  but pending requests/timers can update the wrong entity. Helper-specific remount fixes the
  tested async cases while changing lifecycle and not generalizing to custom lenses/hosts.
  **B-1 does not meet the current acceptance gates; B-2 is recommended.**
- The user reviewed and accepted the recommendations before production implementation.
  See the accepted decisions below and the tracker for implementation evidence.

## Initial minor-candidate implementation decisions (superseded by v7 above)

The user accepted the spike recommendations after review:
- All-before actions keep legacy order. If any output is after, STATE runs first; outputs retain
  their order and each contributor receives its declared snapshot. Before is a snapshot choice,
  not a pre-STATE execution guarantee in mixed actions. Grouped EFFECT exception scope is kept.
- B-1 is deferred. Use explicit entity keys and B-2 diagnostics for changed retained bindings.
- Templates and examples explicitly opt into after; the framework default remains before.
- Update llms.txt, the Sygnal skill, shipped docs and sygnal-check together.
- Optimize against the existing 42,700 B gate, then consult the user if it cannot fit. After
  optimization measured 42,758 B, the user explicitly approved a **42,800 B** gate. The script
  now records that decision; the final measurement leaves 42 B headroom.

## 1. Original evidence and compatibility decisions (historical)

The feedback came from an agent building a fresh app with Sygnal 6.6.0, create-sygnal-app 2.8.0,
sygnal-check 0.10.0 and the Vite TypeScript template. It describes one integration, not a broad
audit. Assessment on the current checkout confirmed:

- `src/core/actions.ts` captures one pre-action state for all handlers; state writes themselves
  are synchronous. `src/core/runtime.ts` queues nested dispatches rather than running them nested.
- `chat()` and `form()` share transition calculations between STATE and output handlers and
  depend on the pre-action input. Changing every handler's input globally would break them.
- `create-sygnal-app/index.js` rejects any nonempty directory. An isolated CLI reproduction
  rejected a directory containing only `.git`; an empty-directory run with `.` produced the
  package name `.`. The noninteractive probe used a prompt-module stub and performed no install.
- `src/core/instance.ts` constructs a child's binding at creation and retains it on prop updates.
  Two temporary real-DOM tests verified that changing an unkeyed `byId()` selection keeps reading
  and writing the old record; changing the key follows the selected record. The probes were removed.
- String test queries return `Element`; typed control tokens already infer element types.

| Decision | Contract |
|---|---|
| P11-D1 | Introduce `sinkState: 'before' \| 'after'`; preserve `'before'` as the framework default in this release. A future default change requires a major release and a separate decision. |
| P11-D2 | A component's explicit `sinkState` wins over the `run()` default. Resolve each child independently; a parent's declaration does not cascade. The app setting never forcibly overrides an explicit library contract. |
| P11-D3 | Behaviors declare their own timing and retain it after model composition. Library declarations must travel with their handlers, rather than inheriting arbitrary host defaults. |
| P11-D4 | Provide `props.previousState`; keep `props.state` consistent with the handler's effective timing. Preserve the existing reducer argument positions. |
| P11-D5 | Allow `.git` and `.DS_Store` as pre-existing destination entries, preserve them, and reject ordinary nonempty destinations. No merge/overwrite option. |
| P11-D6 | Add generic string-query overloads while retaining `Element` defaults and typed-control inference. Generics assert a type; they do not validate the DOM. |
| P11-D7 | Explore automatic rebinding before settling for a key requirement. Include production rebinding without another approval step in the later implementation run if all B-S1 gates pass. If they fail, ship the fallback and report why; do not quietly broaden the API or size budget. |

P11-D7 reflects the user's conditional preference. The numeric spike thresholds below are
planning guardrails, not previously measured results or user-supplied budgets.

## 2. R — Reducer state timing

### R-S1: Specify and prototype composition before production changes

1. Write an executable semantics matrix covering component/app defaults, behavior declarations,
   host overrides of behavior actions, and mixed timing within a normalized action.
2. Explore attaching timing metadata to normalized handlers and preserving provenance through
   `defineBehavior`/model merging, built-in transforms, hooks and definition caches. Avoid mutating
   shared component functions or cached definitions to install an app's default.
3. Preserve unchanged legacy execution when an action resolves entirely to `'before'`: original
   model order, pre-action snapshot, error behavior, dispatch queue and synchronous effects.
4. For actions using `'after'`, finish their single composed STATE transition before their
   updated-state outputs. A behavior STATE + HOST + host STATE chain still executes once, with
   the current composition rules. Capture committed state through the cell, not the raw return.
5. Resolve mixed ordering explicitly. A `'before'` declaration selects a snapshot; it cannot by
   itself guarantee every historical cross-handler execution order inside an `'after'` host.
   Test behaviors whose EFFECT precedes STATE and host EFFECTs chained with behavior EFFECTs.
   Prefer retaining legacy-before-STATE handlers in their original phase when compatible with
   running every `'after'` handler after STATE. Document the chosen ordering with examples.
   If arbitrary mixed composition cannot preserve the advertised contracts, stop R production
   work and report the concrete conflict; do not claim library portability from snapshots alone.
6. Audit wrappers that call STATE handlers directly (undo, behavior HOST, form, chat, compose,
   persist and diagnostics/devtools hooks). Ensure a reducer is never evaluated twice to obtain
   old/new snapshots. Specify what hooks observe and when wrappers capture each snapshot.

Output: `dev-plans/research/reducer-timing/README.md`, runnable fixtures, ordering tables,
compatibility findings and a recommended implementation. The spike report and runnable research fixtures now exist.

### R-1: Runtime and public configuration

Implement after R-S1 resolves composition:

```js
Editor.sinkState = 'after'
LegacyWidget.sinkState = 'before'
run(App, drivers, { sinkState: 'after' })
```

- Resolution: explicit component/behavior contract, then app default, then framework `'before'`.
  For a behavior-owned handler, the behavior declaration is authoritative; host-authored handlers
  use the host component's resolution. Preserve provenance when both contribute one EFFECT.
- STATE consumes its existing transition input. All `'after'` output handlers of an action
  receive one post-transition snapshot, including calculated fields; all `'before'` handlers
  receive its pre-transition snapshot. Do not re-read current state independently for each sink.
- In ordinary component handlers, `props.previousState` is the pre-action component state.
  Behavior first arguments remain slices and `props.state` remains host state, as today;
  `props.previousState` is the corresponding pre-action host state. Document this distinction.
  Within composed STATE handlers, retain their sequential input contract.
- Build/cache props separately by timing as necessary. `'after'` props context must reflect the
  committed state; preserve existing legacy context behavior and test ancestor context too.
- ABORT/same-reference returns mean no state change, not action cancellation. Other sinks run.
  A failed STATE reducer leaves state unchanged and other handlers continue as today. Test
  failures during the commit/calculated/lens path separately; avoid claiming transactional rollback.
- Actions without STATE still run; their before/after snapshots coincide. Include undefined
  state, primitive state, calculated-field write rejection and Collection item removal.
- Effects remain synchronous in the action; DOM patching remains deferred. Reentrant dispatches
  remain FIFO, and no timers or extra flushes are introduced to implement timing.
- Validate invalid timing values through the existing diagnostics conventions.
- Add options/declarations to source and published types, `defineComponent`/behavior types,
  `StartOptions`, `RunOptions` and `renderComponent` options. Audit SSR, hydration, Vike, Astro,
  custom elements and other direct `start()` callers for consistent configuration forwarding.
- HMR retains the app default while respecting replacement component declarations. Two apps
  using the same component function with different defaults must not leak configuration.

### R-2: Libraries and migration

- Explicitly pin existing built-in behaviors to `'before'` initially; adapt any that cannot
  preserve correct execution under the mixed-order design. Test real outputs, not only metadata.
- Add an explicit timing declaration to library-author guidance/templates. Explain the gap:
  undeclared older libraries inherit an app default and cannot be auto-detected safely.
- New app templates may explicitly opt into `'after'` only after their full generated apps and
  built-ins pass. Keep existing app behavior unchanged when no option is supplied.
- Update model, EFFECT, behaviors, HTTP, AI chat, custom drivers, ELEMENT, API and migration docs,
  plus agent guides and generated guide copies. Show which mode each example assumes. Replace
  unqualified claims that every sink always receives pre-action state.
- Test old-value use cases (deletion, cancellation, toggles) using `previousState`; explain that
  `'after'` does not imply a successful state change or a completed DOM patch.
- Audit static checker assumptions, completions and model graph serializers. Recognize the new
  declarations without treating them as model sinks or misspelled component/behavior options.

### R verification

- Cross-product: implicit/explicit before/after app, component and behavior settings; imported
  library components, host action overrides, mixed EFFECT chains and multiple concurrent apps.
- Reverse source key order (EFFECT/HTTP before STATE); after outputs are correct regardless.
- One STATE invocation, correct output count and ordering, calculated fields and props snapshots.
- ABORT, same reference, thrown reducer, no STATE, queued synchronous driver reply and PARENT
  dispatch; chained behavior/HOST reducers, undo/redo, forms, chat SEND/REPLY/STOP, compose, persist.
- Root/key/path/lens/local/Collection cells; deleted item last-state semantics must be explicit.
- HMR and each supported startup/testing adapter agree. Existing all-before parity remains green.
- Type tests cover declarations, options and `previousState`; runtime and public types agree.

## 3. C — Scaffolding into an existing Git directory

### C-1: Destination validation and naming

1. Replace the raw entry-count check with a narrow allowlist for `.git` and `.DS_Store`; accept
   `.git` as a directory or file (Git worktrees). Preserve its content exactly.
2. Do not traverse/remove Git metadata, broadly ignore all dotfiles, or overwrite project files.
   Keep existing interactive and noninteractive rejection behavior for other content.
3. Derive the package name from `basename(targetDir)`, not `basename(projectName)`. Apply valid
   npm naming normalization/validation consistently to `.` and named/absolute/trailing-slash
   destinations. Specify predictable handling of spaces/capitals or an invalid resulting name.
4. Keep `--no-install` free of installation/network activity. Update CLI docs with the Git-first
   and current-directory workflows.

### C verification

Use the real packed CLI and temporary destinations, extending the existing template gate:
empty directory; `.git` directory; `.git` file; `.DS_Store`; both allowed entries; ordinary source
file; existing `package.json`; unrelated hidden file; destination that is a regular file.
Assert metadata bytes survive, rejected destinations stay untouched, `.` gets a valid name based
on the destination, and every template still scaffolds with its expected guide/config files.

## 4. B — Changing selected state bindings

### B-S1: Spike for robust binding updates (required before choosing the shipped contract)

Question: can existing `state={byId(...)}` and general state bindings follow changing parent
props correctly, including writes, without forcing remounts, adding public API or excessive bytes?
A forced rerender alone is insufficient: the captured binding must read and write the new target.

Compare:

1. Retain mount-time binding + explicit identity/key (baseline and fallback).
2. A stable per-instance forwarding cell whose target binding is updated during reconciliation.
3. Updating/replacing the binding behind existing calculated/default cell decorators, with
   explicit memo/context invalidation. Avoid retaining subscriptions or closures to the old cell.
4. Internal semantic metadata for built-in `byId()` lenses, compared with general support for
   arbitrary get/set lenses and string/path bindings. Helper-specific handling is a candidate,
   not permission to silently leave other supported cases inconsistent.

Investigate:

- Same helper target with a new lens object each render; changed ID/field/idKey; changed string
  path; custom lenses with changed closures; switching binding kinds and read-only lenses.
- Same parent state identity with changed lens: current memoization keys on parent identity;
  updating only a getter or forcing the view will not invalidate that cache automatically.
- Atomic installation before child reads, props emissions or intent-triggered writes. Reads and
  writes must never disagree about the selected record. Include rapid A → B → A transitions.
- Parent/ancestor writes, nested writable Collections, reordered/removed/replaced records, no
  selected record, primitive slices, calculated fields, defaults and custom lens exceptions.
- Context caches, dirty checking, STATE.stream/watch/select, existing intent subscriptions,
  statics/resources, pending replies, effect signals, timers, PARENT and devtools state reads.
  Determine whether callbacks capture old values or cells; old asynchronous work must not
  silently apply an old-record result to a newly selected record. Compare with ordinary prop
  changes and existing reply ownership; do not invent automatic cancellation without evidence.
- `isolatedState`, initial-state seeding and `resetState`: rebinding must not overwrite a target's
  existing state or unexpectedly rerun INITIALIZE/BOOTSTRAP. Define missing-target handling.
- Explicit key changes must continue to remount and dispose exactly as today. Binding changes
  alone must not accidentally reset local state, identity, uid or lifecycle.
- Collection `from`, Switchable bindings and composed record lenses: identify the generalization
  boundary and test relevant existing hosts. No divergent accidental binding rules.
- Legacy apps that relied on mount-time binding. Search examples, docs, generated templates and
  tests; describe the behavior change and whether it is safely a bug fix or needs a major release.

Output: `dev-plans/research/state-rebinding/README.md`, reproducible fixtures/prototypes, a
comparison table, correctness/lifecycle findings, compatibility classification and raw metrics.

#### B-S1 acceptance gates

Include B-1 automatically in the later implementation run only when all gates pass:

- Existing `state`, `byId()`, lens get/set, key, Collection and component APIs suffice. No new
  required prop, public lens field, lifecycle callback, option or dependency.
- The tests above demonstrate correct reads **and writes**, coherent state/context notifications,
  preserved explicit-key lifecycle, and no newly unresolved wrong-target asynchronous writes.
  A special-case-only prototype must clearly identify unsupported cases and cannot claim the
  general contract; unresolved correctness cases mean this gate fails.
- Existing functional and count/performance gates pass. No extra DOM patch, per-instance stream
  or timer on the unchanged-binding path; no retained disposed instances or abandoned bindings.
- Size is measured against the same baseline/toolchain using the existing size script. Report
  core minified + gzip, gated/default kanban gzip, and a minimal changing-binding fixture.
  Provisional incremental binding-work ceiling: **256 B gzip core and 256 B gzip gated kanban**;
  the total kanban gate is **42,800 B**, explicitly approved after the optimized timing implementation measured 42,758 B. Separate R costs from B
  costs with isolated comparisons, then verify the combined result. No raising gates to pass.
- Repeat timing measurements against baseline (at least five runs, report median and range) for
  unchanged-lens rerenders, switching selection and nested edits. Investigate a repeatable >5%
  median slowdown on the unchanged-binding path; unresolved regression fails acceptance.
- Compatibility is documented and acceptable without silently invalidating established lifecycle
  guarantees. If a major is necessary, record that and sequence release accordingly; do not ship
  it as an invisible minor change. A new migration API would fail the current API constraint.

These are engineering acceptance criteria, not a claim that every possible custom lens can be
proven safe. Report limitations concretely. If correctness passes but a size/performance gate
fails, record the smallest correct candidate and defer production rebinding unless the user
later changes that constraint. Other workstreams remain independent.

### B-1: Production rebinding, conditional on B-S1

Port the accepted minimal mechanism, preserve behavior outside the documented correction, and
add regressions from the spike to the permanent suites. Update state/byId/key/master-detail
docs, agent guidance and changelog to distinguish updating a binding from requesting a remount.
Keep the keyed example for cases where a new entity should have a fresh component lifecycle.
Verify interaction with both reducer timing modes and behavior state slices.

### B-2: Fallback when B-S1 fails

- Document mount-time binding prominently in state, byId and master-detail examples. Show
  `key={selected.id}` and explain lifecycle/subscription/local-state consequences.
- Add a development diagnostic for retained components with semantically changed built-in
  bindings, using internal field/ID/idKey metadata if needed. No warnings merely because a
  fresh equivalent lens object was allocated; never call arbitrary lens getters to infer identity.
- Consider a narrow static rule only where a changing byId argument and absent/different key
  can be established reliably. Calibrate on examples/docs; don't promise general detection.
- Follow diagnostic registration/explanation/docs generation conventions. Keep diagnostic-only
  work in dev entries where possible and measure any helper/runtime metadata bytes.
- If rebinding succeeds, do not ship warnings that tell users the newly supported pattern is
  incorrect. Retain diagnostics only for genuinely unsupported, demonstrable binding changes.

## 5. T — Typed test queries

### T-1: Additive declarations

Add `<E extends Element = Element>(selector: string): E | null` for `query` and the corresponding
`E[]` overload for `queryAll`. Preserve typed-control overloads/inference and existing callers.
Update `src/extra/testing.ts`, `src/index.d.ts`, generated declarations through the normal build,
and any duplicated public signatures. No runtime DOM type checks or query behavior changes.

### T-2: Examples and verification

Show `t.query<HTMLInputElement>('.project-title')?.value`, generic `queryAll` over Collection
descendants, typed control tokens, and explicit null handling in strict TypeScript examples.
Explain generics are assertions and mock elements are read-only snapshots, not real native
elements. Do not recommend `instanceof HTMLInputElement` as a cross-mode narrowing helper.

Type tests: default Element results; explicit input/button/select types; nullable single query;
typed arrays; invalid generic rejection; unchanged control-token inference and invalid component
token rejection. Compile representative examples under the generated TS template's strict setup.
Existing mock and real-DOM query suites verify runtime behavior remains unchanged.

## 6. Implementation sequence and release boundaries

1. Capture clean baseline revision, toolchain, functional/count gates and bundle sizes.
2. Run R-S1 and B-S1; write their reports and record decisions before production core edits.
   C and T are independent and may be completed while research is pending.
3. Implement C-1 and T-1/T-2; validate their package/template/type gates independently.
4. Implement R-1/R-2 only after its composition contract is resolved. Pin existing built-ins;
   then enable after-mode templates and rewrite applicable examples.
5. Implement B-1 if every spike gate passes; otherwise B-2 with recorded evidence. This choice
   does not block R/C/T. Verify the selected binding contract under both timing modes.
6. Complete documentation/agent context, full integration gates, combined size/performance
   measurements and release notes. No automatic runtime default flip.

Release classification: scaffolder fixes are eligible for a create-sygnal-app patch; additive
query types and opt-in timing for a Sygnal minor after compatibility validation. Diagnostic
tooling/templates may require their own package releases. B-S1 determines rebinding's release
classification. Do not commit exact version numbers until integration/release planning.

## 7. Final verification and definition of done

Run the repository's applicable established gates (build before dist consumers):

- `npm run build`, then `npm test` (library, example, type, browser and count/performance gates).
- `npm --prefix sygnal-check test` for checker/declaration/diagnostic changes; editor tests when
  their shipped behavior or completion metadata changes.
- `node scripts/check-doc-samples.mjs`, `npm --prefix docs run build`; changed live examples
  verified with the docs live gate on Chromium, Firefox and WebKit.
- `node scripts/size-gate.mjs` with its normal budget; repeat relevant timing/performance reports
  for R/B and archive baseline/candidate commands and measurements.
- Fresh packed CLI scaffolds into Git-first and empty destinations; generated TS app passes
  its test/check/build commands without casts added solely to work around query declarations.
- A focused end-to-end master-detail fixture switches, creates, applies a fake AI result, edits
  nested Collections and persists/reloads the selected project's data. No real inference or
  external service is required for this regression. Assert the unselected record is unchanged.

Done means all four workstreams have their specified outcomes, research decisions and evidence;
the binding outcome is explicitly either accepted B-1 or justified B-2, not an unfinished spike.
New defaults, library migration caveats, lifecycle semantics and remaining limitations must be
accurate in docs, shipped guides and the tracker. Record failures honestly; do not weaken gates
or label an unrun check as passing. Research prototypes remain separate from the production implementation and its verification evidence.
