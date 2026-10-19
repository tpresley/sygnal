# PLAN-11 Status Tracker

Tracks [PLAN-11.md](PLAN-11.md): reducer timing and fresh-app ergonomics.

**Created:** 2026-10-18 (Pacific/Honolulu).
**State:** M-10 F1–F8 complete. All release gates pass, including size (42,993 B / explicitly approved 43,000 B). Runtime built; both npm links refreshed and verified from a fresh consumer. M-8 resolved the combined-build limitation.
**Checkout:** Shared working tree; changes are uncommitted. Release metadata is prepared; nothing is published.
**IDs:** Plan-local P11-D decisions; R/C/B/T work items.

## Major-release work

The user superseded the minor-release strategy on 2026-10-18. See M-1…M-7 in the plan.

| Item | State |
|---|---|
| M-1 runtime default / metadata | Implemented; omitted-option/override coverage and explicit built-in contracts |
| M-2 templates / examples | Implemented; 7.x minimums, redundant options removed, packed TS flow passes |
| M-3 installed-version checker | Complete; 1,696 checker tests pass, 4 skipped after M-9 |
| M-4 binding-lifetime spike | Complete; target/presence lifetimes accepted, private 137/137 pass |
| M-5 production binding outcome | Complete; selected-target loss, isolated defaults, hidden pages and reinsertion; 260/260 source tests pass |
| M-6 migration / docs / changelog | Complete; prominent breaking changes, offline migration, docs/llms/skill and editor companion compatibility |
| M-7 integration | Complete; [v7 verification](research/plan11-v7-implementation.md) |
| M-8 Rollup lifecycle | Complete; standard build exits normally, unchanged artifacts, 44 regression tests pass; [evidence](research/rollup-build-lifecycle.md) |
| M-9 loading-guard feedback | Implemented SYG256 with installed-version/effective-timing proof, conservative exclusions, CLI/editor parity and updated guidance; [verification](research/plan11-loading-guard-assessment.md) |
| M-10 final prerelease review | Complete; all correctness/release gates pass. User approved 43,000 B; final 42,993 B. Runtime built, npm links refreshed, fresh consumer verified; [final evidence](research/plan11-f1-f8-implementation.md); [dedup and repros](research/plan11-final-review/README.md) |

The user first approved a 42,900 B gate for the 42,852 B known-target candidate, then approved
**42,950 B** for the **42,910 B** candidate including same-ID target disappearance/reinsertion.
Both decisions followed concrete test/size results. On 2026-10-19 the user additionally approved **43,000 B** for the coordinated M-10 lifetime fixes; final measurement **42,993 B** passes with 7 B headroom. No release was published.

M-7 combined verification (before follow-ups): final 24-config isolated build and types pass; checker 1,568 pass;
packed Git-first TS starter test/check/types/build passes using installed local dependencies;
all 14 example suites, 377 browser cases plus WebMCP/graph suites, performance/count/heap gates,
and all 117 docs demos in each of three engines pass. Library: **5,052 passed**, 33 skipped,
452 passing files; checker: **1,568 passed**, 4 skipped.
Final size: **42,911 B / 42,950 B**, default bundle **38,910 B**; settled heap **0.92 MB**.
Versions prepared: runtime 7.0.0, checker 0.11.0, starter 2.9.0, VS Code 0.8.0, Claude plugin 0.2.0.
VS Code installed-app smoke passes all four scenarios; extension unit/type/build and plugin tests pass.

M-9 verification: **1,696 checker tests pass**, 4 skipped; **52 runtime/docs tests pass**.
The targeted warning covers installed-version/timing contexts, source ranges, suppressions and
CLI/editor worker parity. Repository examples stay clean for SYG256. Candidate and existing
entries produce byte-identical kanban production JS; the linked runtime build was not replaced.

## Initial minor-candidate decisions and delivered behavior (superseded where noted)

- Framework default remains `before`; templates, examples and docs live runtime explicitly use
  `after`. App defaults are resolved independently per component. Explicit component and behavior
  declarations win; built-in behaviors declare their legacy `before` contract.
- Any after output schedules the composed STATE first, then outputs in original order with their
  own snapshots. All-before actions keep their order. Mixed `before` is a snapshot contract, not
  a guarantee to execute before STATE. Grouped EFFECT exception boundaries remain intact.
- `props.state` matches the reducer snapshot; `props.previousState` is the pre-action state.
  Provenance survives composition and PERSIST-to-EFFECT conversion. Definition schedules cache
  by effective default; behavior compilation can tree-shake from applications without behaviors.
- Automatic rebinding is deferred: pending work/lifetime correctness gates failed. Explicit keys
  remain the entity lifetime boundary. SYG454 warns once for a retained child's changed known
  path/byId binding; arbitrary custom lenses and direct Collection/Switchable bindings are not
  diagnosed at runtime. The static checker reports dynamic unkeyed byId cases conservatively.
- Git metadata and `.DS_Store` are preserved by scaffolding; other content is rejected. Package
  names derive from the resolved destination. Query string overloads support `<E extends Element>`
  while retaining default Element and typed-control inference.
- After scheduling/frame optimization reached **42,758 B**, the user explicitly approved raising
  the gate from **42,700 B to 42,800 B**. The final size gate passes with **42 B headroom**.

## Work items

| Item | Status | Evidence |
|---|---|---|
| R-S1 | Complete, reviewed | [Timing report](research/reducer-timing/README.md) |
| R-1 | Implemented | Runtime, public types, testing, HMR, Astro/Vike/element adapters; timing/provenance regressions |
| R-2 | Implemented | Explicit built-in contracts; migrated multi-sink examples; templates, docs, llms.txt, skill and checker |
| C-1 | Implemented | Packed CLI metadata-preservation and destination rejection tests; current-directory naming |
| B-S1 | Complete, reviewed | [Binding report](research/state-rebinding/README.md); correctness/lifetime failures rule out B-1 |
| B-1 | Deferred by accepted decision | No automatic lifetime changes |
| B-2 | Implemented | SYG454 runtime/static diagnostics, key guidance, keyed master-detail/persistence regression |
| T-1/T-2 | Implemented | Generic source/public queries, typed-control inference, invalid generics and timing declarations checked |
| Integration | Complete | [Production verification](research/plan11-implementation.md) |

## Initial production verification (historical)

- Full 24-config Rollup output and declaration build passed using one fresh process per existing
  config. The ordinary combined `npm run build` hit the Node heap limit, then failed to exit with
  a larger heap; no build configuration was changed to mask this. Guide copies were refreshed.
- Final size gate: **42,758 B / 42,800 B**; default native-globalThis bundle **38,741 B**.
  Baseline in the research report was 42,495 B: production increase **263 B**.
- Types, docs build/link/code-title checks, doc samples and skill validation pass.
- Docs samples: **847 clean**, 26 marker-skipped; no strict/a11y/pattern/parser findings.
- Performance/count/retention gate passes: one patch, one stream/item, two unmount timers,
  zero retained ScopeCheckers, settled heap delta **0.91 MB** (limit 1.00 MB).
- Keyed master-detail regression passes: switch/create, fake AI result, nested Collection edits,
  persistence/reload, and unchanged unselected record.
- Library: **5,024 passed**, 33 skipped, 449 passing files. Checker: **1,555 passed**, 4 skipped.
- All **14 example suites** pass. All **117 docs demos** pass in Chromium, Firefox and WebKit.
- Packed Git-first TypeScript starter: tests, strict checker, types and Vite build pass using the
  local matching toolchain. No registry dependency installation was performed.
- Final browser run: **377/377** core browser cases pass; WebMCP and all graph-page suites pass.
  Details and commands are recorded in [production verification](research/plan11-implementation.md).

## Initial release and compatibility notes (superseded by M-1…M-7)

This is an additive minor-release contract; the framework default and binding lifetimes remain
unchanged. Publish Sygnal runtime/types and the corresponding checker before publishing starter
templates that opt into `after`; set template minimum package versions at that coordinated release.
No version numbers are selected or packages published by this task. Existing package ranges are
unchanged. Static query generics assert types; they do not validate DOM element kinds.

## Assessment evidence (before implementation)

- Source review and isolated CLI probe reproduced `.git` rejection and `package.json` name `.`.
  CLI probe used a prompt stub, no installation or network calls, and temporary directories.
- Two temporary real-DOM tests reproduced old-record reads/writes without a changing key and
  selected-record reads/writes with one. Both passed; probe files were removed.
- Existing source/public query types and control-token inference reviewed.
- These checks establish current behavior only; they do not verify any proposed implementation.

## Research decisions to fill in

| Topic | Outcome | Evidence |
|---|---|---|
| R-S1 mixed handler ordering and provenance | Snapshot provenance feasible; ordering qualification required | [Report](research/reducer-timing/README.md), actual-runtime counterexamples and exhaustive 3-node ordering fixture |
| B-S1 selected mechanism and lifecycle contract | Recommend B-2; retain prototypes for possible future lifetime design | [Report](research/state-rebinding/README.md); forwarding and implicit-remount candidates |
| B-S1 size/performance/correctness acceptance | Binding-only byte gates pass; correctness/generalization/lifecycle gates do not | +82 B generic kanban, +116 B metadata forwarding, +38 B helper remount; wrong-target HTTP/next and lagging descendant streams reproduced |
| Binding release classification | Automatic lifetime changes require explicit compatibility/release decision | Existing mount-time behavior is documented; spike does not establish a safe transparent minor-release correction |

## Historical research verification log

Research was explicitly authorized after the plan was written. All candidate mutations and
builds used disposable copies through `research/plan11-harness.mjs`; no production file changed.

- Existing selected baseline: **178/178**, 20 files (parity, behaviors, forms, chat, compose, undo).
- Timing candidate, legacy default: **200/200**, 21 files (22 new research cases).
- Copied testing adapter after-default: **199/200**; one expected migration failure in an old
  unannotated next() data contract, retained in the raw log rather than hidden.
- After-default with that legacy fixture contract explicitly before: **200/200**, 21 files.
- Binding baseline/generic/metadata/remount: **98/98 each**, 15 files (16 research cases + 82 parity).
  Some passing cases deliberately assert unsafe outcomes; they demonstrate the no-go findings.
- Exhaustive ordering fixture: confirms the mixed B-after/H-before/historical-phase cycle.
- Private same-toolchain size builds: baseline gated kanban **42,495 B**; timing **42,728 B**
  (fails 42,700 B gate by 28 B); combined timing + metadata forwarding **42,841 B** (fails by 141 B).
  Raw numbers, five-run timings, source diffs and logs are retained beside each report.
- Full npm/browser/docs/count/heap/type/HMR/integration gates were not run for these rejected or
  unfinished research candidates and are not claimed passing. C/T were unimplemented at this
  research stage; production results above supersede that status.

## Original research recommendations (subsequently reviewed)

- R: keep the legacy default and explicit library snapshot contracts. For mixed actions, propose
  STATE first followed by outputs in original order, with each contributor's declared snapshot;
  explicitly qualify historical phase portability. Preserve grouped EFFECT exception semantics.
  Compile/cache schedules per app rather than scanning/allocating mode arrays each action.
- B: use B-2 now. Do not infer a new entity lifetime from arbitrary custom lens identity.
  A future helper-specific implicit remount would need an explicit lifecycle/release decision.
- Do not raise size gates. Optimize the timing candidate before any production acceptance.

The user subsequently accepted R/C/B-2/T and the qualified mixed-action contract. The original
42,700 B recommendation was superseded by explicit approval of 42,800 B after optimization.
