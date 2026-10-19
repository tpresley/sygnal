# PLAN-11 Sygnal 7 implementation verification

This supersedes the [minor-candidate record](plan11-implementation.md). The user authorized a
major release with after by default, installed-version tooling, and further binding research.
No packages were published and no Git commit was created.

## Delivered contract

- Sygnal **7.0.0** defaults to updated-state output sinks in run, renderComponent and adapters.
  Explicit before component/behavior contracts remain supported; built-in behaviors preserve
  their library contracts. Mixed actions run composed STATE first and preserve output order
  and snapshot provenance. Previous state is available as `props.previousState`.
- Templates/examples remove redundant after settings and retain the audited reducer migrations.
  Starters require runtime ^7.0.0 and checker ^0.11.0. Generator metadata is **2.9.0**.
- Checker **0.11.0** resolves installed Sygnal per source package, including workspace/nested/
  local/prerelease cases. 6.x does not support sinkState; 7.x defaults after. Unknown versions
  are not inferred from ranges. Legacy unkeyed byId warnings are suppressed for installed 7.
- Known path/byId target changes dispose/recreate ordinary child and Collection/VirtualCollection/
  Switchable lifetimes, including overlapping IDs and hidden pages. Equivalent targets retain
  instances (declared path text or the field/ID/idKey tuple compared with Object.is). Losing an existing known target ends its old lifetime even if its ID stays the same;
  fresh missing-state initialization/seeding/defaults work and old pending work cannot revive
  after reinsertion. Opaque lenses still require explicit keys/conditional rendering.
- Prominent changelog and [migration guide](../../docs/src/content/docs/guide/migrating-to-7.md),
  shipped offline too; current docs, llms, skill and diagnostics describe the v7 contract.
- Editor metadata **VS Code 0.8.0** / **Claude plugin 0.2.0**. Workspace launchers require checker
  0.11+; VS Code falls back to its bundle for older checkers, Claude gives upgrade guidance.
  The plugin refreshes the linked canonical skill; no old checker is loaded by its launcher.

## Research and size decisions

[Target-change spike](state-rebinding-v7/README.md),
[presence-loss follow-up](state-rebinding-v7/availability.md).

The target-change candidate measured 42,852 B; the user approved 42,900 B. Independent review
then reproduced deletion of a selected record with unchanged byId arguments retaining old UI.
The robust presence-loss candidate measured 42,910 B after optimization; the user explicitly
approved **42,950 B** and inclusion of that fix. The chosen production variant keeps the readable
sorted-helper optimization without three extra micro-optimizations: **42,911 B**, 39 B headroom.

Final `node scripts/size-gate.mjs`: gated **42,911 B**, default native-globalThis **38,910 B**;
core alone informational **50,267 B min / 18,738 B gzip**. The original 6.6 research baseline
was 42,495 B: complete production increase **416 B**. No fixture or measurement method was
changed to make the size result pass.

Private binding/timing/parity/diagnostic run: **137/137**. Related production lifetime/host/
disposal/virtual/SSR suites: **260/260**. Selection-churn regression maintains one DOM patch per
change and bounded live instances. Absolute microbenchmark timings and lifecycle costs are
recorded in the spike rather than treating stale-target retention as equivalent work.

## Final integration gates

| Gate | Result |
|---|---|
| All 24 Rollup configurations, declarations, guide copy | Pass via isolated config processes |
| Full library suite | 452 files / 5,052 tests pass; 6 files / 33 tests skipped |
| Examples | All 14 suites pass |
| Source + strict public types | Pass |
| Checker | 1,568 tests pass, 4 skipped |
| Browser | 377/377; WebMCP and all graph-page suites pass |
| Performance/count/retention | All pass; one patch, one stream/item, two unmount timers, zero retained checkers, settled heap 0.92 MB / 1.00 MB |
| Docs build/link/code-title | 112 pages built; 113-page link check clean; code titles clean |
| Docs live | All 117 demos pass in Chromium, Firefox and WebKit |
| Doc sample checker | 852 clean, 26 marker-skipped; zero strict/a11y/pattern/parser findings |
| Packed Git-first TS starter | Test, strict checker, tsc and Vite build pass using installed local toolchain; no registry install |
| VS Code | 18 unit tests, typecheck/build, installed-app bundled/workspace/features/graph smoke pass |
| Claude plugin | 12 tests pass |
| Sygnal skill validator, diff whitespace, llms copies | Pass |

The root/website public and built llms files are byte-identical. The offline guide registry keeps
its established order and appends the new migration page; its focused 26-test regression passes.
Final full library confirmation includes that adjustment and passes.

## Build/environment limitation (subsequently resolved)

The user’s follow-up investigation fixed the combined Rollup lifecycle. The standard build now
exits normally without heap flags or per-config subprocesses; see the
[follow-up evidence](rollup-build-lifecycle.md). The paragraph below records the earlier gate.

The previously recorded combined Rollup memory/process-lifetime issue remains: the normal
all-config process exhausted default heap or did not exit with a larger heap. Final verification
executes each unchanged configuration in a fresh process, then the ordinary declaration build
and copy script. All configured outputs are built; no budget/test/config is weakened.

Loopback/watch tests and installed Electron smoke required the approved execution context
outside the sandbox. Sandbox EPERM/SIGABRT attempts were rerun successfully, not counted as
passing. Editor smoke uses isolated temporary profiles, the installed VS Code, and no downloads.

Release metadata is prepared. Publishing remains a separate action; publish runtime/checker
and coordinated starter/editor/plugin artifacts together so no starter installs a 6.x runtime.
